import { Quaternion, Vector3 } from 'three';
import type { Settings } from '../settings';
import { actualRate, throttleToThrust, thrustToThrottle } from './rates';

export const GRAVITY = 9.81;
const DEG = Math.PI / 180;

export interface Sticks {
  /** 0..1 */
  throttle: number;
  /** -1..1, right positive */
  yaw: number;
  /** -1..1, forward (nose down) positive */
  pitch: number;
  /** -1..1, right positive */
  roll: number;
}

export const NEUTRAL_STICKS: Sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };

const _v1 = new Vector3();
const _v2 = new Vector3();
const _q1 = new Quaternion();
const UP = new Vector3(0, 1, 0);

/**
 * Rigid-body quadcopter. Body frame follows three.js conventions:
 * +X right, +Y up (thrust axis), -Z forward (camera direction).
 * Angular velocity `omega` is expressed in the body frame (rad/s).
 */
export class Quad {
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly quat = new Quaternion();
  readonly omega = new Vector3();
  /** Current motor thrust, newtons. */
  thrust = 0;
  /** Commanded throttle after the flight controller, 0..1. */
  throttleOut = 0;
  readonly radius = 0.14;
  mass = 0.65;
  thrustToWeight = 5;
  /** Quadratic drag coefficients in body axes (x side, y vertical, z forward). */
  readonly drag = new Vector3(0.028, 0.045, 0.02);
  motorTau = 0.03;
  rateTau = 0.035;

  get maxThrust(): number {
    return this.mass * GRAVITY * this.thrustToWeight;
  }

  up(target = new Vector3()): Vector3 {
    return target.set(0, 1, 0).applyQuaternion(this.quat);
  }

  forward(target = new Vector3()): Vector3 {
    return target.set(0, 0, -1).applyQuaternion(this.quat);
  }

  /** Heading in radians around world Y; 0 means facing -Z. */
  heading(): number {
    const f = this.forward(_v1);
    // When pointing straight up/down, fall back to the body up vector's horizontal direction.
    if (f.x * f.x + f.z * f.z < 1e-4) {
      const u = this.up(_v2).multiplyScalar(-Math.sign(f.y));
      return Math.atan2(-u.x, -u.z);
    }
    return Math.atan2(-f.x, -f.z);
  }

  reset(position: Vector3, yaw: number): void {
    this.pos.copy(position);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.quat.setFromAxisAngle(UP, yaw);
    this.thrust = 0;
    this.throttleOut = 0;
  }

  /** Integrate one fixed physics step. `rateTarget` is body rates in rad/s. */
  step(dt: number, throttle: number, rateTarget: Vector3): void {
    this.throttleOut = Math.max(0, Math.min(1, throttle));

    // Motors spool towards the commanded thrust.
    const targetThrust = throttleToThrust(this.throttleOut) * this.maxThrust;
    this.thrust += (targetThrust - this.thrust) * (1 - Math.exp(-dt / this.motorTau));

    // The rate PID loop is modeled as a fast first-order response.
    const k = 1 - Math.exp(-dt / this.rateTau);
    this.omega.x += (rateTarget.x - this.omega.x) * k;
    this.omega.y += (rateTarget.y - this.omega.y) * k;
    this.omega.z += (rateTarget.z - this.omega.z) * k;

    // Orientation: q = q * exp(omega * dt) (body-frame rotation).
    const w = this.omega.length();
    if (w > 1e-6) {
      _q1.setFromAxisAngle(_v1.copy(this.omega).divideScalar(w), w * dt);
      this.quat.multiply(_q1).normalize();
    }

    // Forces.
    const up = this.up(_v1);
    // Props lose thrust as inflow speed along the thrust axis rises.
    const axial = this.vel.dot(up);
    const inflowLoss = Math.max(0.35, 1 - Math.max(0, axial) / 55);
    const force = _v2.copy(up).multiplyScalar(this.thrust * inflowLoss);
    force.y -= this.mass * GRAVITY;

    // Quadratic drag computed in body frame.
    const speed = this.vel.length();
    if (speed > 1e-4) {
      _q1.copy(this.quat).invert();
      const vb = up.copy(this.vel).applyQuaternion(_q1);
      vb.set(-this.drag.x * vb.x * speed, -this.drag.y * vb.y * speed, -this.drag.z * vb.z * speed);
      force.add(vb.applyQuaternion(this.quat));
    }

    this.vel.addScaledVector(force, dt / this.mass);
    this.pos.addScaledVector(this.vel, dt);
  }
}

export interface ControlOutput {
  throttle: number;
  rates: Vector3;
}

/**
 * Flight controller: turns pilot sticks into a throttle and body-rate target.
 * - Acro: sticks command rotation rates (Betaflight Actual rates).
 * - Angle: roll/pitch sticks command a tilt angle, the craft self-levels;
 *   optional altitude assist turns the throttle stick into a climb-rate command.
 */
export class FlightController {
  private readonly out: ControlOutput = { throttle: 0, rates: new Vector3() };
  private readonly desiredUp = new Vector3();
  private readonly levelQuat = new Quaternion();
  private readonly tmp = new Vector3();
  private vzIntegral = 0;

  reset(): void {
    this.vzIntegral = 0;
  }

  compute(sticks: Sticks, settings: Settings, quad: Quad, dt: number): ControlOutput {
    const rates = this.out.rates;
    const yawRate = -actualRate(sticks.yaw, settings.yawRates) * DEG;

    if (settings.flightMode === 'acro') {
      this.vzIntegral = 0;
      rates.set(
        -actualRate(sticks.pitch, settings.rollPitchRates) * DEG,
        yawRate,
        -actualRate(sticks.roll, settings.rollPitchRates) * DEG,
      );
      this.out.throttle = sticks.throttle;
      return this.out;
    }

    // Angle mode: desired up vector from stick angles in the heading frame.
    const maxAngle = settings.maxAngle * DEG;
    const pitchAngle = sticks.pitch * maxAngle;
    const rollAngle = sticks.roll * maxAngle;
    const heading = quad.heading();
    this.levelQuat.setFromAxisAngle(UP, heading);
    this.desiredUp
      .set(Math.sin(rollAngle) * Math.cos(pitchAngle), Math.cos(rollAngle) * Math.cos(pitchAngle), -Math.sin(pitchAngle))
      .normalize()
      .applyQuaternion(this.levelQuat);

    const currentUp = quad.up(this.tmp);
    // Rotation error (world) -> body frame.
    const error = currentUp.clone().cross(this.desiredUp);
    // If fully inverted the cross product vanishes; pick roll axis to recover.
    if (currentUp.dot(this.desiredUp) < -0.95 && error.lengthSq() < 0.01) {
      error.copy(quad.forward(new Vector3()));
    }
    _q1.copy(quad.quat).invert();
    error.applyQuaternion(_q1);
    const gain = 9;
    const limit = 8; // rad/s
    rates.set(
      Math.max(-limit, Math.min(limit, error.x * gain)),
      yawRate,
      Math.max(-limit, Math.min(limit, error.z * gain)),
    );

    if (!settings.altitudeAssist) {
      this.vzIntegral = 0;
      this.out.throttle = sticks.throttle;
      return this.out;
    }

    // Altitude assist: stick center holds altitude, up/down sets climb rate.
    const stick = (sticks.throttle - 0.5) * 2;
    const deadband = 0.06;
    const shaped = Math.abs(stick) < deadband ? 0 : (stick - Math.sign(stick) * deadband) / (1 - deadband);
    const targetVz = shaped * (shaped > 0 ? 9 : 7);
    const upY = Math.max(0.35, quad.up(this.tmp).y);
    const err = targetVz - quad.vel.y;
    // Integrate only near the setpoint so sitting on the ground does not wind up.
    if (Math.abs(err) < 3) this.vzIntegral = Math.max(-4, Math.min(4, this.vzIntegral + err * dt));
    const accel = GRAVITY + err * 5 + this.vzIntegral * 3;
    const needed = (quad.mass * accel) / upY / quad.maxThrust;
    this.out.throttle = thrustToThrottle(Math.max(0, Math.min(1, needed)));
    return this.out;
  }
}
