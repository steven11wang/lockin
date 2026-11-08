import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../settings';
import { boxCollider, CollisionWorld, cylinderCollider, type Contact } from './collision';
import { crossesPortal, makePortal, rotationFacing } from './gates';
import { FlightController, GRAVITY, Quad, type Sticks } from './quad';
import { actualRate, applyDeadzone, throttleToThrust, thrustToThrottle } from './rates';

const settings = (patch: Partial<Settings> = {}): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), ...patch });

function fly(quad: Quad, s: Settings, sticks: Sticks, seconds: number) {
  const fc = new FlightController();
  const dt = 1 / 240;
  for (let t = 0; t < seconds; t += dt) {
    const out = fc.compute(sticks, s, quad, dt);
    quad.step(dt, out.throttle, out.rates);
  }
}

describe('rates', () => {
  it('maps full stick to max rate and center slope to center sensitivity', () => {
    const p = { center: 200, max: 670, expo: 0.54 };
    expect(actualRate(1, p)).toBeCloseTo(670);
    expect(actualRate(-1, p)).toBeCloseTo(-670);
    expect(actualRate(0, p)).toBe(0);
    expect(actualRate(0.001, p) / 0.001).toBeCloseTo(200, 0);
  });

  it('applies a rescaled deadzone', () => {
    expect(applyDeadzone(0.03, 0.05)).toBe(0);
    expect(applyDeadzone(1, 0.05)).toBeCloseTo(1);
    expect(applyDeadzone(-0.525, 0.05)).toBeCloseTo(-0.5);
  });

  it('inverts the throttle curve', () => {
    for (const t of [0, 0.2, 0.5, 0.9, 1]) expect(thrustToThrottle(throttleToThrust(t))).toBeCloseTo(t, 5);
  });
});

describe('quad physics', () => {
  it('hovers at the hover throttle in acro mode', () => {
    const q = new Quad();
    q.reset(new Vector3(0, 10, 0), 0);
    q.thrust = q.mass * GRAVITY; // motors already spooled
    const hover = thrustToThrottle(1 / q.thrustToWeight);
    fly(q, settings({ flightMode: 'acro' }), { throttle: hover, yaw: 0, pitch: 0, roll: 0 }, 2);
    expect(Math.abs(q.vel.y)).toBeLessThan(0.3);
    expect(q.pos.y).toBeGreaterThan(9.5);
  });

  it('falls with zero throttle', () => {
    const q = new Quad();
    q.reset(new Vector3(0, 50, 0), 0);
    fly(q, settings({ flightMode: 'acro' }), { throttle: 0, yaw: 0, pitch: 0, roll: 0 }, 1);
    expect(q.vel.y).toBeLessThan(-GRAVITY * 0.7);
  });

  it('acro full right roll stick rolls right at the max rate', () => {
    const q = new Quad();
    q.reset(new Vector3(0, 50, 0), 0);
    fly(q, settings({ flightMode: 'acro' }), { throttle: 0.3, yaw: 0, pitch: 0, roll: 1 }, 0.1);
    // Right side dips first: body +X points below the horizon.
    expect(new Vector3(1, 0, 0).applyQuaternion(q.quat).y).toBeLessThan(-0.3);
    fly(q, settings({ flightMode: 'acro' }), { throttle: 0.3, yaw: 0, pitch: 0, roll: 1 }, 0.2);
    expect(q.omega.z).toBeCloseTo((-670 * Math.PI) / 180, 1);
  });

  it('angle mode holds the commanded tilt and self-levels on release', () => {
    const s = settings({ flightMode: 'angle', altitudeAssist: true });
    const q = new Quad();
    q.reset(new Vector3(0, 20, 0), 0);
    fly(q, s, { throttle: 0.5, yaw: 0, pitch: 1, roll: 0 }, 1.5);
    const up = q.up();
    const tilt = Math.acos(up.y) * (180 / Math.PI);
    expect(tilt).toBeGreaterThan(45);
    expect(tilt).toBeLessThan(60);
    expect(up.z).toBeLessThan(0); // leaning forward
    expect(q.vel.z).toBeLessThan(-5); // flying forward (-Z)
    fly(q, s, { throttle: 0.5, yaw: 0, pitch: 0, roll: 0 }, 1.5);
    expect(q.up().y).toBeGreaterThan(0.99);
    expect(Math.abs(q.pos.y - 20)).toBeLessThan(1); // altitude assist held height
  });

  it('angle mode recovers from inverted', () => {
    const s = settings({ flightMode: 'angle' });
    const q = new Quad();
    q.reset(new Vector3(0, 80, 0), 0);
    q.quat.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI - 0.01);
    fly(q, s, { throttle: 0.5, yaw: 0, pitch: 0, roll: 0 }, 2);
    expect(q.up().y).toBeGreaterThan(0.95);
  });

  it('yaw right turns the nose right', () => {
    const q = new Quad();
    q.reset(new Vector3(0, 50, 0), 0);
    fly(q, settings({ flightMode: 'angle' }), { throttle: 0.5, yaw: 1, pitch: 0, roll: 0 }, 0.2);
    expect(q.forward().x).toBeGreaterThan(0.3);
  });
});

describe('gates', () => {
  const portal = makePortal(new Vector3(0, 2, 0), rotationFacing(new Vector3(0, 0, -1)), 3, 3);

  it('detects a forward pass through the opening', () => {
    expect(crossesPortal(portal, new Vector3(0, 2, 1), new Vector3(0.5, 2.5, -1))).toBe(true);
  });

  it('ignores passes outside the opening or backwards', () => {
    expect(crossesPortal(portal, new Vector3(2, 2, 1), new Vector3(2, 2, -1))).toBe(false);
    expect(crossesPortal(portal, new Vector3(0, 2, -1), new Vector3(0, 2, 1))).toBe(false);
  });

  it('supports dive gates facing down and bidirectional gaps', () => {
    const dive = makePortal(new Vector3(0, 15, 0), rotationFacing(new Vector3(0, -1, 0)), 4, 4);
    expect(crossesPortal(dive, new Vector3(1, 16, 1), new Vector3(1, 14, 1))).toBe(true);
    expect(crossesPortal(dive, new Vector3(1, 14, 1), new Vector3(1, 16, 1))).toBe(false);
    const gap = makePortal(new Vector3(0, 2, 0), new Quaternion(), 3, 3, 'rect', true);
    expect(crossesPortal(gap, new Vector3(0, 2, -1), new Vector3(0, 2, 1))).toBe(true);
  });

  it('checks ring gates radially', () => {
    const ring = makePortal(new Vector3(), new Quaternion(), 4, 4, 'ring');
    expect(crossesPortal(ring, new Vector3(1.9, 0, 1), new Vector3(1.9, 0, -1))).toBe(true);
    expect(crossesPortal(ring, new Vector3(1.9, 1.9, 1), new Vector3(1.9, 1.9, -1))).toBe(false);
  });
});

describe('collision', () => {
  const world = new CollisionWorld();
  world.add(boxCollider(new Vector3(0, 1, 0), new Vector3(2, 2, 2), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4)));
  world.add(cylinderCollider(new Vector3(10, 0, 0), 1, 5));
  const c: Contact = { normal: new Vector3(), depth: 0, collider: null };

  it('reports ground contact', () => {
    expect(world.contact(new Vector3(50, 0.05, 50), 0.15, c)).toBe(true);
    expect(c.normal.y).toBe(1);
    expect(c.depth).toBeCloseTo(0.1);
  });

  it('hits a rotated box from the side', () => {
    // Rotated 45°, the corner sticks out to x = sqrt(2).
    expect(world.contact(new Vector3(1.5, 1, 0), 0.15, c)).toBe(true);
    expect(c.normal.x).toBeGreaterThan(0.5);
    expect(world.contact(new Vector3(1.7, 1, 0), 0.15, c)).toBe(false);
  });

  it('hits cylinders and measures proximity', () => {
    expect(world.contact(new Vector3(11.1, 2, 0), 0.15, c)).toBe(true);
    expect(c.normal.x).toBeCloseTo(1);
    expect(world.nearest(new Vector3(12, 2, 0), 3)).toBeCloseTo(1);
  });
});

describe('settings merge', () => {
  it('keeps defaults for missing or mistyped keys', () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { fov: 120, laps: 'x', gamepad: { deadzone: 0.1 } });
    expect(merged.fov).toBe(120);
    expect(merged.laps).toBe(DEFAULT_SETTINGS.laps);
    expect(merged.gamepad.deadzone).toBe(0.1);
    expect(merged.gamepad.throttle).toEqual(DEFAULT_SETTINGS.gamepad.throttle);
  });
});
