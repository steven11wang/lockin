import type { Vector3 } from 'three';

export interface TrickEvent {
  name: string;
  points: number;
}

export interface FreestyleSample {
  dt: number;
  /** Body rates, rad/s. */
  omega: Vector3;
  altitude: number;
  speed: number;
  verticalSpeed: number;
  /** World up component of the body up vector (-1 inverted .. 1 level). */
  upY: number;
  /** Distance to nearest obstacle surface, metres. */
  proximity: number;
}

const TWO_PI = Math.PI * 2;
const COMBO_WINDOW = 3;

/**
 * Freestyle trick detection and combo scoring. Rotations are integrated per body
 * axis while airborne; full 360s score. Points collect into a combo that banks
 * after a quiet spell and is lost on a crash.
 */
export class FreestyleScorer {
  score = 0;
  combo = 0;
  comboCount = 0;
  comboTimer = 0;
  bestCombo = 0;
  readonly feed: { text: string; age: number }[] = [];

  private roll = 0;
  private flip = 0;
  private spin = 0;
  private quiet = { roll: 0, flip: 0, spin: 0 };
  private inverted = 0;
  private proximityAcc = 0;
  private proximityShown = 0;
  private peakAlt = 0;
  private peakAge = 0;
  private gapCooldown = new Map<string, number>();

  get multiplier(): number {
    return Math.min(4, 1 + Math.max(0, this.comboCount - 1) * 0.5);
  }

  private award(name: string, points: number): void {
    this.combo += points;
    this.comboCount += 1;
    this.comboTimer = COMBO_WINDOW;
    this.feed.unshift({ text: `${name} +${Math.round(points)}`, age: 0 });
    if (this.feed.length > 6) this.feed.pop();
  }

  private bank(): void {
    if (this.combo <= 0) return;
    const total = Math.round(this.combo * this.multiplier);
    this.score += total;
    this.bestCombo = Math.max(this.bestCombo, total);
    if (this.comboCount > 1) this.feed.unshift({ text: `连招 x${this.multiplier} = ${total}`, age: 0 });
    this.combo = 0;
    this.comboCount = 0;
  }

  gap(name: string): void {
    if ((this.gapCooldown.get(name) ?? 0) > 0) return;
    this.gapCooldown.set(name, 2.5);
    this.award(`穿越 ${name}`, 250);
  }

  crash(): void {
    if (this.combo > 0) this.feed.unshift({ text: '炸机！连招丢失', age: 0 });
    this.combo = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.roll = this.flip = this.spin = 0;
    this.inverted = 0;
    this.peakAlt = 0;
  }

  update(s: FreestyleSample): TrickEvent[] {
    const events: TrickEvent[] = [];
    const emit = (name: string, points: number) => {
      this.award(name, points);
      events.push({ name, points });
    };

    for (const item of this.feed) item.age += s.dt;
    while (this.feed.length && this.feed[this.feed.length - 1].age > 4) this.feed.pop();
    for (const [k, v] of this.gapCooldown) this.gapCooldown.set(k, v - s.dt);

    const airborne = s.altitude > 0.8;
    if (airborne) {
      this.roll += s.omega.z * s.dt;
      this.flip += s.omega.x * s.dt;
      this.spin += s.omega.y * s.dt;
    }

    const decay = (axisRate: number, key: 'roll' | 'flip' | 'spin') => {
      if (Math.abs(axisRate) < 1.2 || !airborne) this.quiet[key] += s.dt;
      else this.quiet[key] = 0;
      if (this.quiet[key] > 0.7) this[key] = 0;
    };
    decay(s.omega.z, 'roll');
    decay(s.omega.x, 'flip');
    decay(s.omega.y, 'spin');

    if (Math.abs(this.roll) >= TWO_PI) {
      this.roll -= Math.sign(this.roll) * TWO_PI;
      emit('横滚 Roll', 100);
    }
    if (Math.abs(this.flip) >= TWO_PI) {
      const backward = this.flip > 0;
      this.flip -= Math.sign(this.flip) * TWO_PI;
      emit(backward ? '后空翻 Backflip' : '前空翻 Frontflip', 120);
    }
    if (Math.abs(this.spin) >= TWO_PI) {
      this.spin -= Math.sign(this.spin) * TWO_PI;
      emit('自旋 Yaw Spin', 60);
    }

    // Inverted hang time.
    if (airborne && s.upY < -0.6) {
      this.inverted += s.dt;
      if (this.inverted >= 1) {
        this.inverted -= 1;
        emit('倒飞 Inverted', 50);
      }
    } else {
      this.inverted = 0;
    }

    // Proximity: fast and close to structures.
    if (s.speed > 12 && s.proximity < 2.2) {
      const gain = s.dt * 120 * (s.speed / 12) * (1 - s.proximity / 2.2 + 0.3);
      this.proximityAcc += gain;
      this.combo += gain;
      this.comboTimer = Math.max(this.comboTimer, 1.5);
      if (this.proximityShown <= 0) {
        this.comboCount += 1;
        this.feed.unshift({ text: '贴近 Proximity', age: 0 });
        this.proximityShown = 2;
      }
    }
    this.proximityShown -= s.dt;

    // Dive: big altitude drop then a pull-out.
    if (s.altitude > this.peakAlt || s.verticalSpeed > 1) {
      if (s.verticalSpeed > 1 && this.peakAlt - s.altitude >= 15 && this.peakAge < 5) {
        const drop = this.peakAlt - s.altitude;
        emit(`俯冲 Dive ${Math.round(drop)}m`, 150 + drop * 5);
      }
      this.peakAlt = s.altitude;
      this.peakAge = 0;
    } else {
      this.peakAge += s.dt;
    }

    if (this.combo > 0) {
      this.comboTimer -= s.dt;
      if (this.comboTimer <= 0) this.bank();
    }
    return events;
  }

  /** Bank anything pending, e.g. when the session ends. */
  finish(): void {
    this.bank();
  }
}
