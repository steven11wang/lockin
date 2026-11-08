import type { AxisBinding, Settings } from '../settings';
import { applyDeadzone } from '../sim/rates';
import type { Sticks } from '../sim/quad';

export type Action = 'reset' | 'camera' | 'mode' | 'pause' | 'tiltUp' | 'tiltDown';
export type InputSource = 'keyboard' | 'gamepad' | 'touch';

interface TouchStick {
  el: HTMLElement;
  knob: HTMLElement;
  pointerId: number | null;
  cx: number;
  cy: number;
  x: number;
  y: number;
}

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const approach = (cur: number, target: number, rate: number, dt: number) => {
  const d = target - cur;
  const step = rate * dt;
  return Math.abs(d) <= step ? target : cur + Math.sign(d) * step;
};

export function readAxis(pad: Gamepad, binding: AxisBinding, deadzone: number): number {
  const raw = pad.axes[binding.axis] ?? 0;
  const v = binding.invert ? -raw : raw;
  return applyDeadzone(clamp(v), deadzone);
}

/**
 * Merges keyboard + mouse, gamepads / USB RC transmitters and on-screen touch
 * sticks into one set of pilot sticks, using whichever device moved last.
 */
export class InputManager {
  readonly sticks: Sticks = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  source: InputSource = 'keyboard';
  gamepadName = '';

  private keys = new Set<string>();
  private actions = new Set<Action>();
  private kb = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  private mouse = { pitch: 0, roll: 0 };
  private prevButtons: boolean[] = [];
  private prevAxes: number[] = [];
  private touchLeft: TouchStick | null = null;
  private touchRight: TouchStick | null = null;
  private touchThrottle = 0;
  /** True when the throttle should spring to center (altitude assist). */
  private springThrottle = true;
  enabled = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getSettings: () => Settings,
  ) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => this.onMouse(e));
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  requestPointerLock(): void {
    if (!this.getSettings().mouseControl || this.source === 'touch') return;
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // Not supported in this context.
    }
  }

  exitPointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    const flightKeys = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'];
    if (flightKeys.includes(e.code)) e.preventDefault();
    if (down) {
      if (!this.keys.has(e.code)) {
        const map: Record<string, Action> = {
          KeyR: 'reset',
          KeyC: 'camera',
          KeyM: 'mode',
          Escape: 'pause',
          KeyP: 'pause',
          BracketRight: 'tiltUp',
          BracketLeft: 'tiltDown',
        };
        const action = map[e.code];
        if (action) this.actions.add(action);
      }
      this.keys.add(e.code);
      if (!['Escape', 'KeyP'].includes(e.code)) this.source = 'keyboard';
    } else {
      this.keys.delete(e.code);
    }
  }

  private onMouse(e: MouseEvent): void {
    if (!this.pointerLocked || !this.getSettings().mouseControl) return;
    const k = 0.006 * this.getSettings().mouseSensitivity;
    this.mouse.roll = clamp(this.mouse.roll + e.movementX * k);
    this.mouse.pitch = clamp(this.mouse.pitch - e.movementY * k);
    this.source = 'keyboard';
  }

  consumeActions(): Set<Action> {
    const out = this.actions;
    this.actions = new Set();
    return out;
  }

  pushAction(action: Action): void {
    this.actions.add(action);
  }

  /** Reset stateful throttle (e.g. on respawn). */
  resetThrottle(spring: boolean, hover = 0): void {
    this.springThrottle = spring;
    this.kb.throttle = spring ? 0.5 : hover;
    this.touchThrottle = spring ? 0.5 : hover;
  }

  setSpringThrottle(spring: boolean): void {
    if (spring !== this.springThrottle) this.resetThrottle(spring);
  }

  connectedGamepad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  update(dt: number): Sticks {
    const s = this.getSettings();
    this.pollGamepad(s);
    if (this.source === 'gamepad') return this.sticks;
    if (this.source === 'touch') {
      this.readTouch();
      return this.sticks;
    }

    // Keyboard axes with smoothing.
    const has = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    const amp = s.keyboardStick;
    const axis = (pos: boolean, neg: boolean) => (pos === neg ? 0 : pos ? amp : -amp);
    const slew = 5;
    this.kb.pitch = approach(this.kb.pitch, axis(has('ArrowUp', 'KeyI'), has('ArrowDown', 'KeyK')), slew, dt);
    this.kb.roll = approach(this.kb.roll, axis(has('ArrowRight', 'KeyL'), has('ArrowLeft', 'KeyJ')), slew, dt);
    this.kb.yaw = approach(this.kb.yaw, axis(has('KeyD'), has('KeyA')), slew, dt);

    const up = has('KeyW', 'ShiftLeft');
    const down = has('KeyS', 'ControlLeft');
    if (this.springThrottle) {
      const target = up === down ? 0.5 : up ? 1 : 0;
      this.kb.throttle = approach(this.kb.throttle, target, 3, dt);
    } else {
      if (up) this.kb.throttle += 0.55 * dt;
      if (down) this.kb.throttle -= 0.7 * dt;
      if (has('KeyX')) this.kb.throttle = 0;
      this.kb.throttle = clamp(this.kb.throttle, 0, 1);
    }

    // Mouse acts as a spring-centered stick.
    const decay = Math.exp(-dt / 0.14);
    this.mouse.roll *= decay;
    this.mouse.pitch *= decay;

    this.sticks.throttle = has('Space') ? 1 : this.kb.throttle;
    this.sticks.yaw = this.kb.yaw;
    this.sticks.pitch = clamp(this.kb.pitch + this.mouse.pitch);
    this.sticks.roll = clamp(this.kb.roll + this.mouse.roll);
    if (!this.enabled) this.sticks.pitch = this.sticks.roll = this.sticks.yaw = 0;
    return this.sticks;
  }

  private pollGamepad(s: Settings): void {
    const pad = this.connectedGamepad();
    if (!pad) {
      if (this.source === 'gamepad') this.source = 'keyboard';
      this.gamepadName = '';
      return;
    }
    this.gamepadName = pad.id;
    const g = s.gamepad;

    // Detect activity to switch source.
    let active = false;
    pad.axes.forEach((v, i) => {
      if (Math.abs(v - (this.prevAxes[i] ?? v)) > 0.15) active = true;
      this.prevAxes[i] = v;
    });
    pad.buttons.forEach((b, i) => {
      const pressed = b.pressed;
      if (pressed && !this.prevButtons[i]) {
        active = true;
        if (i === g.resetButton) this.actions.add('reset');
        if (i === g.cameraButton) this.actions.add('camera');
        if (i === g.modeButton) this.actions.add('mode');
        if (i === g.pauseButton) this.actions.add('pause');
      }
      this.prevButtons[i] = pressed;
    });
    if (active) this.source = 'gamepad';
    if (this.source !== 'gamepad') return;

    // Throttle: full range of the bound axis, -1..1 -> 0..1 (no deadzone at ends).
    const rawT = pad.axes[g.throttle.axis] ?? -1;
    this.sticks.throttle = clamp(((g.throttle.invert ? -rawT : rawT) + 1) / 2, 0, 1);
    this.sticks.yaw = readAxis(pad, g.yaw, g.deadzone);
    this.sticks.pitch = readAxis(pad, g.pitch, g.deadzone);
    this.sticks.roll = readAxis(pad, g.roll, g.deadzone);
  }

  // ---------- Touch sticks ----------

  mountTouch(container: HTMLElement): void {
    const make = (side: 'left' | 'right'): TouchStick => {
      const el = document.createElement('div');
      el.className = `touch-stick touch-${side}`;
      const knob = document.createElement('div');
      knob.className = 'touch-knob';
      el.appendChild(knob);
      container.appendChild(el);
      const stick: TouchStick = { el, knob, pointerId: null, cx: 0, cy: 0, x: 0, y: 0 };
      const radius = () => el.clientWidth / 2;
      const move = (e: PointerEvent) => {
        const r = radius();
        stick.x = clamp((e.clientX - stick.cx) / r);
        stick.y = clamp((e.clientY - stick.cy) / r);
        if (side === 'left' && !this.springThrottle) this.touchThrottle = clamp(0.5 - stick.y / 2, 0, 1);
        this.drawKnob(stick, side);
      };
      el.addEventListener('pointerdown', (e) => {
        if (stick.pointerId !== null) return;
        e.preventDefault();
        stick.pointerId = e.pointerId;
        el.setPointerCapture(e.pointerId);
        const rect = el.getBoundingClientRect();
        stick.cx = rect.left + rect.width / 2;
        stick.cy = rect.top + rect.height / 2;
        this.source = 'touch';
        move(e);
      });
      el.addEventListener('pointermove', (e) => {
        if (e.pointerId === stick.pointerId) move(e);
      });
      const release = (e: PointerEvent) => {
        if (e.pointerId !== stick.pointerId) return;
        stick.pointerId = null;
        stick.x = 0;
        if (side === 'right' || this.springThrottle) stick.y = 0;
        this.drawKnob(stick, side);
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      return stick;
    };
    this.touchLeft = make('left');
    this.touchRight = make('right');
    const bar = document.createElement('div');
    bar.className = 'touch-bar';
    const buttons: [Action, string][] = [
      ['reset', '复位'],
      ['camera', '视角'],
      ['mode', '模式'],
      ['pause', '暂停'],
    ];
    for (const [action, label] of buttons) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.actions.add(action);
      });
      bar.appendChild(btn);
    }
    container.appendChild(bar);
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') container.classList.add('touch-active');
    });
  }

  private drawKnob(stick: TouchStick, side: 'left' | 'right'): void {
    let y = stick.y;
    if (side === 'left' && !this.springThrottle && stick.pointerId === null) y = (0.5 - this.touchThrottle) * 2;
    stick.knob.style.transform = `translate(${stick.x * 50}%, ${y * 50}%)`;
  }

  private readTouch(): void {
    const l = this.touchLeft;
    const r = this.touchRight;
    if (!l || !r) return;
    this.sticks.throttle = this.springThrottle ? clamp(0.5 - l.y / 2, 0, 1) : this.touchThrottle;
    this.sticks.yaw = applyDeadzone(l.x, 0.08);
    this.sticks.roll = applyDeadzone(r.x, 0.05);
    this.sticks.pitch = applyDeadzone(-r.y, 0.05);
  }
}
