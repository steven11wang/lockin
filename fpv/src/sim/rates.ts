import type { RateProfile } from '../settings';

/**
 * Betaflight "Actual" rates: stick deflection (-1..1) -> rotation rate in deg/s.
 * Linear `center` slope near center, curving up to `max` at full deflection.
 */
export function actualRate(stick: number, profile: RateProfile): number {
  const x = Math.max(-1, Math.min(1, stick));
  const ax = Math.abs(x);
  const expo = Math.max(0, Math.min(1, profile.expo));
  const curve = ax * (x ** 5 * expo + x * (1 - expo));
  const movement = Math.max(0, profile.max - profile.center);
  return x * profile.center + movement * curve;
}

export function applyDeadzone(value: number, deadzone: number): number {
  const a = Math.abs(value);
  if (a <= deadzone) return 0;
  return (Math.sign(value) * (a - deadzone)) / (1 - deadzone);
}

/** Map throttle stick (0..1) to a thrust fraction with a mild curve and motor idle. */
export function throttleToThrust(throttle: number): number {
  const t = Math.max(0, Math.min(1, throttle));
  return 0.02 + 0.98 * (0.45 * t * t + 0.55 * t);
}

export function thrustToThrottle(fraction: number): number {
  const f = Math.max(0, Math.min(1, (fraction - 0.02) / 0.98));
  // invert 0.45 t^2 + 0.55 t = f
  return (-0.55 + Math.sqrt(0.55 * 0.55 + 4 * 0.45 * f)) / (2 * 0.45);
}
