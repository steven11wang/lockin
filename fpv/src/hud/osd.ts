export interface ScreenPoint {
  /** Normalized device coords, -1..1. */
  x: number;
  y: number;
  behind: boolean;
}

export interface OsdState {
  mode: 'ANGLE' | 'ACRO';
  assist: boolean;
  throttle: number;
  speed: number;
  altitude: number;
  voltage: number;
  flightTime: number;
  horizon: [ScreenPoint, ScreenPoint] | null;
  topLeft: string[];
  topRight: string[];
  nextGate: (ScreenPoint & { distance: number; label: string }) | null;
  center: { title: string; subtitle?: string; color?: string } | null;
  feed: { text: string; age: number }[];
  combo: string | null;
  hint: string | null;
  fpv: boolean;
}

const FONT = '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace';

/** Betaflight-style on-screen display drawn on a 2D canvas over the 3D view. */
export class Osd {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number): void {
    this.w = width;
    this.h = height;
    this.dpr = Math.min(dpr, 2);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  private text(s: string, x: number, y: number, size: number, align: CanvasTextAlign = 'left', color = '#ffffff'): void {
    const ctx = this.ctx;
    ctx.font = `700 ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.lineWidth = Math.max(2, size / 5);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  }

  private toPx(p: ScreenPoint): [number, number] {
    return [((p.x + 1) / 2) * this.w, ((1 - p.y) / 2) * this.h];
  }

  draw(s: OsdState | null): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!s) return;
    const { w, h } = this;
    const base = Math.max(12, Math.min(18, Math.round(Math.min(w, h) / 40)));
    const pad = Math.max(14, base);
    ctx.textBaseline = 'middle';

    // Crosshair.
    if (s.fpv) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      const cx = w / 2;
      const cy = h / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 18, cy);
      ctx.lineTo(cx - 6, cy);
      ctx.moveTo(cx + 6, cy);
      ctx.lineTo(cx + 18, cy);
      ctx.moveTo(cx, cy - 6);
      ctx.lineTo(cx, cy - 12);
      ctx.stroke();
    }

    // Artificial horizon.
    if (s.horizon && s.fpv) {
      const [a, b] = s.horizon;
      if (!a.behind && !b.behind) {
        const [ax, ay] = this.toPx(a);
        const [bx, by] = this.toPx(b);
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const ang = Math.atan2(by - ay, bx - ax);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(ang);
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(-w * 0.16, 0);
        ctx.lineTo(w * 0.16, 0);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }

    // Next gate marker.
    if (s.nextGate) {
      const g = s.nextGate;
      let [x, y] = this.toPx(g);
      const margin = 50;
      const onScreen = !g.behind && x > margin && x < w - margin && y > margin && y < h - margin;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#3dff7a';
      ctx.fillStyle = '#3dff7a';
      if (onScreen) {
        const r = Math.max(14, Math.min(60, 900 / Math.max(1, g.distance)));
        const c = r * 0.45;
        ctx.beginPath();
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          ctx.moveTo(x + sx * r, y + sy * (r - c));
          ctx.lineTo(x + sx * r, y + sy * r);
          ctx.lineTo(x + sx * (r - c), y + sy * r);
        }
        ctx.stroke();
        this.text(`${g.label} ${Math.round(g.distance)}m`, x, y + r + base, base * 0.85, 'center', '#3dff7a');
      } else {
        // Clamp to an ellipse around the screen edge and point outward.
        let dx = x - w / 2;
        let dy = y - h / 2;
        if (g.behind) {
          dx = -dx;
          dy = -dy;
          if (Math.abs(dx) + Math.abs(dy) < 1) dy = h;
        }
        const ang = Math.atan2(dy, dx);
        const rx = w / 2 - margin;
        const ry = h / 2 - margin;
        x = w / 2 + Math.cos(ang) * rx;
        y = h / 2 + Math.sin(ang) * ry;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(18, 0);
        ctx.lineTo(-10, -13);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-10, 13);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        this.text(`${g.label} ${Math.round(g.distance)}m`, x - Math.cos(ang) * 40, y - Math.sin(ang) * 30, base * 0.8, 'center', '#3dff7a');
      }
    }

    // Corners.
    s.topLeft.forEach((line, i) => this.text(line, pad, pad + base * 0.6 + i * base * 1.35, base));
    s.topRight.forEach((line, i) => this.text(line, w - pad, pad + base * 0.6 + i * base * 1.35, base, 'right'));

    const bottom = h - pad - base * 0.6;
    const volt = s.voltage;
    this.text(`${volt.toFixed(1)}V`, pad, bottom - base * 1.35, base, 'left', volt < 14 ? '#ff4d4d' : '#ffffff');
    this.text(`${s.mode}${s.assist && s.mode === 'ANGLE' ? '+ALT' : ''}`, pad, bottom, base);
    this.text(`THR ${String(Math.round(s.throttle * 100)).padStart(3, ' ')}%`, w / 2, bottom, base, 'center');
    this.text(`${Math.round(s.speed * 3.6)} km/h`, w / 2, bottom - base * 1.35, base, 'center');
    this.text(`ALT ${s.altitude.toFixed(1)}m`, w - pad, bottom - base * 1.35, base, 'right');
    const ft = Math.floor(s.flightTime);
    this.text(`FLY ${Math.floor(ft / 60)}:${String(ft % 60).padStart(2, '0')}`, w - pad, bottom, base, 'right');

    // Throttle bar.
    const barH = Math.min(140, h * 0.22);
    const bx = pad + 2;
    const by = h / 2 - barH / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, 8, barH);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(bx + 2, by + barH - (barH - 4) * s.throttle - 2, 4, (barH - 4) * s.throttle);

    // Trick feed and combo.
    s.feed.forEach((item, i) => {
      const alpha = Math.max(0, 1 - item.age / 4);
      ctx.globalAlpha = alpha;
      this.text(item.text, w - pad, h * 0.32 + i * base * 1.4, base * 0.95, 'right', i === 0 ? '#ffe14d' : '#ffffff');
    });
    ctx.globalAlpha = 1;
    if (s.combo) this.text(s.combo, w - pad, h * 0.32 - base * 1.6, base * 1.1, 'right', '#ff8a3d');

    if (s.center) {
      this.text(s.center.title, w / 2, h * 0.36, base * 3, 'center', s.center.color ?? '#ffffff');
      if (s.center.subtitle) this.text(s.center.subtitle, w / 2, h * 0.36 + base * 2.6, base * 1.1, 'center');
    }
    if (s.hint) this.text(s.hint, w / 2, h * 0.62, base * 0.95, 'center', '#cfe8ff');
  }
}
