export type GateResult = 'ignored' | 'start' | 'gate' | 'lap' | 'finish';

/**
 * Lap timing for an ordered gate sequence. Gate 0 is the start/finish gate:
 * the clock starts the first time it is crossed, and every return to it after
 * all other gates closes a lap.
 */
export class RaceTracker {
  next = 0;
  started = false;
  finished = false;
  /** Seconds since the start gate was first crossed. */
  time = 0;
  lapStart = 0;
  readonly laps: number[] = [];
  lastPassed = -1;

  constructor(
    readonly gateCount: number,
    /** null = endless practice laps */
    readonly totalLaps: number | null,
  ) {}

  get currentLap(): number {
    return this.laps.length + 1;
  }

  get currentLapTime(): number {
    return this.started ? this.time - this.lapStart : 0;
  }

  get bestLap(): number | null {
    return this.laps.length ? Math.min(...this.laps) : null;
  }

  tick(dt: number): void {
    if (this.started && !this.finished) this.time += dt;
  }

  passGate(index: number): GateResult {
    if (this.finished || index !== this.next) return 'ignored';
    this.lastPassed = index;
    this.next = (index + 1) % this.gateCount;
    if (index !== 0) return 'gate';
    if (!this.started) {
      this.started = true;
      this.time = 0;
      this.lapStart = 0;
      return 'start';
    }
    this.laps.push(this.time - this.lapStart);
    this.lapStart = this.time;
    if (this.totalLaps !== null && this.laps.length >= this.totalLaps) {
      this.finished = true;
      return 'finish';
    }
    return 'lap';
  }
}

export function formatTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--.--';
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
}
