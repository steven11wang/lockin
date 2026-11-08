import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/** Small deterministic PRNG so the world looks the same every run. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat = 1): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

export function grassTexture(): Texture {
  const [c, ctx] = canvas(512);
  const r = rng(11);
  ctx.fillStyle = '#4c7a35';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const g = 90 + r() * 70;
    ctx.fillStyle = `rgba(${40 + r() * 40},${g},${30 + r() * 25},${0.25 + r() * 0.4})`;
    ctx.fillRect(r() * 512, r() * 512, 1 + r() * 2, 2 + r() * 4);
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${90 + r() * 40},${85 + r() * 30},${50},${0.08 + r() * 0.1})`;
    ctx.beginPath();
    ctx.arc(r() * 512, r() * 512, 10 + r() * 40, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c, 90);
}

export function dirtTexture(): Texture {
  const [c, ctx] = canvas(256);
  const r = rng(5);
  ctx.fillStyle = '#7a6145';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const v = 80 + r() * 80;
    ctx.fillStyle = `rgba(${v + 30},${v},${v - 30},${0.3 + r() * 0.4})`;
    ctx.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  return finish(c, 1);
}

export function concreteTexture(graffiti: boolean, seed = 3): Texture {
  const [c, ctx] = canvas(512);
  const r = rng(seed);
  ctx.fillStyle = '#8d8c87';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 12000; i++) {
    const v = 110 + r() * 60;
    ctx.fillStyle = `rgba(${v},${v},${v - 5},${0.15 + r() * 0.25})`;
    ctx.fillRect(r() * 512, r() * 512, 1 + r() * 3, 1 + r() * 3);
  }
  // Stains running down from the top.
  for (let i = 0; i < 18; i++) {
    const x = r() * 512;
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, 'rgba(40,40,35,0.35)');
    grad.addColorStop(1, 'rgba(40,40,35,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 4 + r() * 18, 120 + r() * 380);
  }
  // Form-work lines.
  ctx.strokeStyle = 'rgba(60,60,55,0.35)';
  ctx.lineWidth = 2;
  for (let y = 128; y < 512; y += 128) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  if (graffiti) {
    const colors = ['#ff2d6f', '#28e0ff', '#ffe02d', '#7cff4f', '#b34dff', '#ff8a1f'];
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = colors[Math.floor(r() * colors.length)];
      ctx.lineWidth = 6 + r() * 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      let x = 40 + r() * 400;
      let y = 260 + r() * 200;
      ctx.moveTo(x, y);
      for (let k = 0; k < 7; k++) {
        x += -40 + r() * 90;
        y += -50 + r() * 100;
        ctx.quadraticCurveTo(x + r() * 40, y - 40 * r(), x, y);
      }
      ctx.stroke();
    }
    ctx.font = 'bold 72px Impact, sans-serif';
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 5;
    const tag = ['FPV', 'SEND IT', 'BANDO', 'RIP', 'ACRO'][Math.floor(r() * 5)];
    const tx = 30 + r() * 200;
    const ty = 330 + r() * 120;
    ctx.strokeText(tag, tx, ty);
    ctx.fillText(tag, tx, ty);
  }
  return finish(c, 1);
}

export function containerTexture(color: string): Texture {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 16) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, 0, 6, 256);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x + 8, 0, 3, 256);
  }
  const r = rng(color.length * 7);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(90,50,20,${r() * 0.25})`;
    ctx.fillRect(r() * 256, r() * 256, 2 + r() * 6, 1 + r() * 3);
  }
  return finish(c, 1);
}

export function checkerTexture(a: string, b: string, cells = 8): Texture {
  const [c, ctx] = canvas(128);
  const s = 128 / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 ? a : b;
      ctx.fillRect(x * s, y * s, s, s);
    }
  }
  return finish(c, 1);
}

export function labelTexture(text: string, fg: string, bg: string): Texture {
  const [c, ctx] = canvas(256);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = fg;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.font = 'bold 130px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 138);
  return finish(c, 1);
}

export function bannerTexture(text: string, bg: string, fg = '#ffffff'): Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = fg;
  ctx.font = 'bold 60px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 52);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function barkTexture(): Texture {
  const [c, ctx] = canvas(128);
  const r = rng(21);
  ctx.fillStyle = '#5a3d27';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(30,18,10,${0.2 + r() * 0.4})`;
    ctx.fillRect(r() * 128, 0, 1 + r() * 3, 128);
  }
  return finish(c, 1);
}

export function foliageTexture(): Texture {
  const [c, ctx] = canvas(256);
  const r = rng(31);
  ctx.fillStyle = '#2f5a26';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    const g = 70 + r() * 80;
    ctx.fillStyle = `rgba(${25 + r() * 30},${g},${20 + r() * 20},0.6)`;
    ctx.beginPath();
    ctx.arc(r() * 256, r() * 256, 2 + r() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(c, 1);
}
