/** Synthesized motor whine plus UI beeps, all generated with WebAudio. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private motorGain: GainNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private noiseGain: GainNode | null = null;
  private volume = 0.6;
  private muted = false;

  /** Must be called from a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 2400;
    this.motorGain.connect(lowpass).connect(this.master);

    this.oscA = ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator();
    this.oscB.type = 'square';
    const gb = ctx.createGain();
    gb.gain.value = 0.25;
    this.oscA.connect(this.motorGain);
    this.oscB.connect(gb).connect(this.motorGain);
    this.oscA.start();
    this.oscB.start();

    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.Q.value = 0.8;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    noise.start();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.setVolume(this.volume);
    return this.muted;
  }

  /** throttle 0..1 (motor output), speed m/s. */
  motor(throttle: number, speed: number, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.oscA || !this.oscB || !this.motorGain || !this.noiseGain || !this.noiseFilter) return;
    const t = ctx.currentTime;
    const rpm = active ? Math.sqrt(Math.max(0, throttle)) : 0;
    const f = 70 + rpm * 520;
    this.oscA.frequency.setTargetAtTime(f, t, 0.03);
    this.oscB.frequency.setTargetAtTime(f * 1.505, t, 0.03);
    this.motorGain.gain.setTargetAtTime(active ? 0.03 + rpm * 0.11 : 0, t, 0.05);
    this.noiseFilter.frequency.setTargetAtTime(500 + rpm * 2500 + speed * 25, t, 0.05);
    this.noiseGain.gain.setTargetAtTime(active ? 0.02 + rpm * 0.08 + Math.min(0.12, speed * 0.003) : 0, t, 0.05);
  }

  beep(freq: number, duration = 0.09, type: OscillatorType = 'sine', gain = 0.25, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  gate(): void {
    this.beep(1046, 0.09, 'triangle', 0.22);
    this.beep(1568, 0.12, 'triangle', 0.18, 0.06);
  }

  lap(): void {
    [784, 988, 1175, 1568].forEach((f, i) => this.beep(f, 0.14, 'square', 0.12, i * 0.09));
  }

  trick(): void {
    this.beep(660, 0.08, 'triangle', 0.15);
    this.beep(990, 0.1, 'triangle', 0.12, 0.05);
  }

  crash(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const len = 0.5;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.value = 0.6;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }
}
