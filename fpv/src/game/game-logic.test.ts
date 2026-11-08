import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FreestyleScorer, type FreestyleSample } from './freestyle';
import { formatTime, RaceTracker } from './race';

describe('RaceTracker', () => {
  it('starts on gate 0, requires gates in order, and finishes after N laps', () => {
    const r = new RaceTracker(3, 2);
    expect(r.passGate(1)).toBe('ignored');
    expect(r.passGate(0)).toBe('start');
    r.tick(5);
    expect(r.passGate(2)).toBe('ignored');
    expect(r.passGate(1)).toBe('gate');
    expect(r.passGate(2)).toBe('gate');
    r.tick(5);
    expect(r.passGate(0)).toBe('lap');
    expect(r.laps).toEqual([10]);
    r.passGate(1);
    r.passGate(2);
    r.tick(8);
    expect(r.passGate(0)).toBe('finish');
    expect(r.laps).toEqual([10, 8]);
    expect(r.bestLap).toBe(8);
    expect(r.finished).toBe(true);
    r.tick(5);
    expect(r.time).toBe(18);
  });

  it('formats times', () => {
    expect(formatTime(83.456)).toBe('01:23.46');
    expect(formatTime(null)).toBe('--:--.--');
  });
});

describe('FreestyleScorer', () => {
  const sample = (patch: Partial<FreestyleSample>): FreestyleSample => ({
    dt: 1 / 60,
    omega: new Vector3(),
    altitude: 10,
    speed: 5,
    verticalSpeed: 0,
    upY: 1,
    proximity: 99,
    ...patch,
  });

  it('scores a full roll and banks the combo after a pause', () => {
    const s = new FreestyleScorer();
    const names: string[] = [];
    for (let i = 0; i < 60; i++) names.push(...s.update(sample({ omega: new Vector3(0, 0, -7) })).map((e) => e.name));
    expect(names.some((n) => n.includes('Roll'))).toBe(true);
    expect(s.score).toBe(0);
    for (let i = 0; i < 240; i++) s.update(sample({}));
    expect(s.score).toBeGreaterThanOrEqual(100);
  });

  it('loses the pending combo on a crash', () => {
    const s = new FreestyleScorer();
    s.gap('桥下');
    s.crash();
    for (let i = 0; i < 300; i++) s.update(sample({}));
    expect(s.score).toBe(0);
  });

  it('awards multiplied combos', () => {
    const s = new FreestyleScorer();
    s.gap('A');
    s.gap('B');
    s.gap('C');
    s.finish();
    expect(s.score).toBe(Math.round(750 * 2));
  });
});
