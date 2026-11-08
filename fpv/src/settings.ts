export type FlightMode = 'angle' | 'acro';
export type Quality = 'low' | 'medium' | 'high';

export interface RateProfile {
  /** Center sensitivity, deg/s at small stick deflection (Betaflight "Actual" rates). */
  center: number;
  /** Max rate at full stick, deg/s. */
  max: number;
  /** Expo 0..1. */
  expo: number;
}

export interface AxisBinding {
  axis: number;
  invert: boolean;
}

export interface GamepadBindings {
  throttle: AxisBinding;
  yaw: AxisBinding;
  pitch: AxisBinding;
  roll: AxisBinding;
  deadzone: number;
  resetButton: number;
  cameraButton: number;
  modeButton: number;
  pauseButton: number;
}

export interface Settings {
  flightMode: FlightMode;
  altitudeAssist: boolean;
  rollPitchRates: RateProfile;
  yawRates: RateProfile;
  maxAngle: number;
  thrustToWeight: number;
  crashSpeed: number;
  cameraTilt: number;
  fov: number;
  quality: Quality;
  showHorizon: boolean;
  analogEffect: boolean;
  keyboardStick: number;
  mouseControl: boolean;
  mouseSensitivity: number;
  gamepad: GamepadBindings;
  volume: number;
  laps: number;
}

export const DEFAULT_SETTINGS: Settings = {
  flightMode: 'angle',
  altitudeAssist: true,
  rollPitchRates: { center: 200, max: 670, expo: 0.54 },
  yawRates: { center: 180, max: 450, expo: 0.4 },
  maxAngle: 55,
  thrustToWeight: 5,
  crashSpeed: 8,
  cameraTilt: 25,
  fov: 95,
  quality: 'medium',
  showHorizon: true,
  analogEffect: true,
  keyboardStick: 0.65,
  mouseControl: true,
  mouseSensitivity: 1,
  gamepad: {
    throttle: { axis: 1, invert: true },
    yaw: { axis: 0, invert: false },
    pitch: { axis: 3, invert: true },
    roll: { axis: 2, invert: false },
    deadzone: 0.04,
    resetButton: 0,
    cameraButton: 1,
    modeButton: 3,
    pauseButton: 9,
  },
  volume: 0.6,
  laps: 3,
};

const STORAGE_KEY = 'fpv-rush-settings-v1';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merge stored values onto defaults, keeping only keys whose type matches. */
export function mergeSettings<T>(defaults: T, stored: unknown): T {
  if (!isObject(defaults) || !isObject(stored)) return structuredClone(defaults);
  const result: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(defaults)) {
    const value = stored[key];
    if (isObject(def)) result[key] = mergeSettings(def, value);
    else if (typeof value === typeof def) result[key] = value;
    else result[key] = def;
  }
  return result as T;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return mergeSettings(DEFAULT_SETTINGS, raw ? JSON.parse(raw) : null);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private mode); settings then last for this visit only.
  }
}

export function loadRecord(key: string): number | null {
  try {
    const raw = localStorage.getItem(`fpv-rush-${key}`);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveRecord(key: string, value: number): void {
  try {
    localStorage.setItem(`fpv-rush-${key}`, String(value));
  } catch {
    // ignore
  }
}
