import {
  BackSide,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Quality } from '../settings';
import { boxCollider, CollisionWorld } from '../sim/collision';
import { makePortal, rotationFacing, type GateShape, type Portal } from '../sim/gates';
import { Builder } from './builder';
import {
  bannerTexture,
  barkTexture,
  checkerTexture,
  concreteTexture,
  containerTexture,
  foliageTexture,
  grassTexture,
  labelTexture,
  rng,
} from './textures';

export interface GateObject {
  index: number;
  portal: Portal;
  material: MeshStandardMaterial;
  label: Sprite;
  root: Group;
}

export interface GapZone {
  name: string;
  portal: Portal;
}

export interface World {
  scene: Scene;
  collision: CollisionWorld;
  gates: GateObject[];
  gaps: GapZone[];
  spawn: { pos: Vector3; yaw: number };
  sun: DirectionalLight;
  pilotPosition: Vector3;
  highlightGates(next: number | null): void;
  update(time: number, focus: Vector3): void;
}

const GATE_COLORS = {
  idle: new Color('#ff6a1a'),
  next: new Color('#30ff7a'),
  after: new Color('#ffd21f'),
  free: new Color('#ff6a1a'),
};

interface GateSpec {
  pos: [number, number, number];
  w: number;
  h: number;
  shape?: GateShape;
  /** Explicit pass direction; otherwise the track tangent is used. */
  dir?: [number, number, number];
  kind?: 'standard' | 'ring' | 'dive' | 'flags' | 'stacked' | 'start' | 'window';
}

/** Track: start gate first; the lap closes when gate 0 is crossed again. */
const TRACK: GateSpec[] = [
  { pos: [0, 2.2, 30], w: 5, h: 3.2, dir: [0, 0, -1], kind: 'start' },
  { pos: [10, 2.4, -15], w: 3.6, h: 3 },
  { pos: [45, 2.8, -45], w: 3.6, h: 3.2 },
  { pos: [80, 9, -95], w: 5, h: 4.5, dir: [0, 0, -1] },
  { pos: [40, 11, -128], w: 6, h: 6, shape: 'ring', kind: 'ring' },
  { pos: [-16, 6.75, -110], w: 4, h: 3, dir: [-1, 0, 0], kind: 'window' },
  { pos: [-44, 6.75, -110], w: 4, h: 3, dir: [-1, 0, 0], kind: 'window' },
  { pos: [-85, 15, -93.5], w: 4.4, h: 4.4, dir: [0, -1, 0], kind: 'dive' },
  { pos: [-102, 2.4, -40], w: 3.6, h: 3, dir: [0.15, 0, 1] },
  { pos: [-85, 2.6, 20], w: 5, h: 3.4, dir: [0, 0, 1] },
  { pos: [-60, 3, 65], w: 5, h: 6, kind: 'flags' },
  { pos: [-20, 6.2, 85], w: 3.6, h: 3.6, dir: [1, 0, 0], kind: 'stacked' },
  { pos: [18, 2.6, 68], w: 3.6, h: 3 },
];

export const BANDO = { x0: -44, x1: -16, z0: -117, z1: -103, floor: 4.5, floors: 3 };

function skyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new Color('#2f6fd6') },
      horizon: { value: new Color('#cfe3f2') },
      bottom: { value: new Color('#9fb6a2') },
      sunDir: { value: new Vector3(0.45, 0.6, -0.65).normalize() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.4));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.9, 0.7) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

function cloudTexture(): SpriteMaterial {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const r = rng(77);
    for (let i = 0; i < 14; i++) {
      const x = 30 + r() * 68;
      const y = 50 + r() * 30;
      const rad = 18 + r() * 22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,255,255,0.75)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
  }
  const map = new CanvasTexture(c);
  map.colorSpace = SRGBColorSpace;
  return new SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false });
}

export function buildWorld(quality: Quality): World {
  const scene = new Scene();
  const collision = new CollisionWorld();
  const shadows = quality !== 'low';
  const b = new Builder(scene, collision, shadows);

  scene.background = new Color('#cfe3f2');
  scene.fog = new Fog('#cfe3f2', 160, 950);

  // ---------- Sky & light ----------
  const sky = new Mesh(new SphereGeometry(1500, 32, 16), skyMaterial());
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  scene.add(new HemisphereLight('#d8ecff', '#4a5a3a', 1.6));
  const sun = new DirectionalLight('#fff3dc', 2.8);
  sun.position.set(45, 60, -65);
  sun.castShadow = shadows;
  if (shadows) {
    const size = quality === 'high' ? 2048 : 1024;
    sun.shadow.mapSize.set(size, size);
    const cam = sun.shadow.camera;
    cam.left = -70;
    cam.right = 70;
    cam.top = 70;
    cam.bottom = -70;
    cam.near = 1;
    cam.far = 260;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(sun);
  scene.add(sun.target);

  const cloudMat = cloudTexture();
  const cr = rng(99);
  for (let i = 0; i < 26; i++) {
    const s = new Sprite(cloudMat);
    const a = cr() * Math.PI * 2;
    const d = 250 + cr() * 650;
    s.position.set(Math.cos(a) * d, 140 + cr() * 120, Math.sin(a) * d);
    const sc = 120 + cr() * 160;
    s.scale.set(sc * 1.8, sc, 1);
    scene.add(s);
  }

  // ---------- Ground ----------
  const ground = new Mesh(
    new PlaneGeometry(2400, 2400),
    new MeshLambertMaterial({ map: grassTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = shadows;
  scene.add(ground);

  // Distant mountains for a horizon.
  const mountainMat = new MeshLambertMaterial({ color: '#6f8a78', flatShading: true });
  const mr = rng(4);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2 + mr() * 0.1;
    const d = 700 + mr() * 250;
    const h = 90 + mr() * 160;
    const m = new Mesh(new ConeGeometry(120 + mr() * 120, h, 6 + Math.floor(mr() * 3)), mountainMat);
    m.position.set(Math.cos(a) * d, h / 2 - 5, Math.sin(a) * d);
    m.rotation.y = mr() * Math.PI;
    scene.add(m);
  }

  // ---------- Materials ----------
  const concrete = new MeshStandardMaterial({ map: concreteTexture(false), roughness: 0.95 });
  const concreteGraffiti = new MeshStandardMaterial({ map: concreteTexture(true, 8), roughness: 0.9 });
  const steel = new MeshStandardMaterial({ color: '#8b9097', metalness: 0.6, roughness: 0.45 });
  const darkSteel = new MeshStandardMaterial({ color: '#3d4148', metalness: 0.5, roughness: 0.6 });
  const red = new MeshStandardMaterial({ color: '#c8322b', roughness: 0.6 });
  const asphalt = new MeshStandardMaterial({ color: '#3b3d40', roughness: 0.95 });
  const white = new MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.7 });

  // ---------- Start area ----------
  b.box(new Vector3(0, 0.03, 48), new Vector3(4, 0.06, 4), new MeshStandardMaterial({ map: checkerTexture('#111', '#eee', 8) }), {
    collide: false,
    shadow: false,
  });
  // Pilot tent.
  const tentMat = new MeshStandardMaterial({ color: '#1f6feb', roughness: 0.8, side: DoubleSide });
  for (const [x, z] of [
    [-22, 49],
    [-22, 55],
    [-16, 49],
    [-16, 55],
  ]) {
    b.box(new Vector3(x, 1.25, z), new Vector3(0.12, 2.5, 0.12), steel);
  }
  b.box(new Vector3(-19, 2.6, 52), new Vector3(6.4, 0.2, 6.4), tentMat);
  b.box(new Vector3(-19, 0.45, 51), new Vector3(3, 0.9, 1), white);
  const pilotPosition = new Vector3(-17, 1.7, 50);

  // ---------- Bando (abandoned concrete building) ----------
  {
    const { x0, x1, z0, z1, floor, floors } = BANDO;
    const t = 0.4;
    for (let f = 0; f < floors; f++) {
      const y = f * floor;
      const longOpenings: [number, number, number, number][] = [];
      for (let u = 2.2; u < x1 - x0 - 2; u += 4.8) longOpenings.push([u, u + 2.6, 1.1, 3.4]);
      const shortOpening: [number, number, number, number][] =
        f === 0 ? [[4.5, 9.5, 0, 3.6]] : [[5, 9, 0.75, 3.75]];
      const matA = f === 0 ? concreteGraffiti : concrete;
      // North (z0) and south (z1) walls run along +x.
      b.wall(new Vector3(x0, y, z0), new Vector3(1, 0, 0), x1 - x0, floor, t, longOpenings, matA);
      b.wall(new Vector3(x0, y, z1), new Vector3(1, 0, 0), x1 - x0, floor, t, longOpenings, matA);
      // West (x0) and east (x1) walls run along +z.
      b.wall(new Vector3(x0, y, z0), new Vector3(0, 0, 1), z1 - z0, floor, t, shortOpening, matA);
      b.wall(new Vector3(x1, y, z0), new Vector3(0, 0, 1), z1 - z0, floor, t, shortOpening, matA);
      // Interior columns away from the centre corridor.
      for (const cx of [-23, -30, -37]) {
        for (const cz of [-113.8, -106.2]) {
          b.box(new Vector3(cx, y + floor / 2, cz), new Vector3(0.6, floor, 0.6), concrete);
        }
      }
    }
    b.slab(x0, x1, z0, z1, floor, 0.35, concrete, [-28, -24, -114, -109]);
    b.slab(x0, x1, z0, z1, floor * 2, 0.35, concrete, [-38, -33, -112, -107]);
    b.slab(x0, x1, z0, z1, floor * 3, 0.35, concrete, [-30, -20, -115, -105]);
    // Rubble.
    b.box(new Vector3(-26, 0.5, -112), new Vector3(2.2, 1, 1.6), concrete);
    b.box(new Vector3(-35, 0.35, -106), new Vector3(1.4, 0.7, 2), concrete);
  }

  // ---------- Dive tower (scaffold) ----------
  {
    const cx = -85;
    const cz = -101;
    const half = 2.5;
    const top = 18;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.box(new Vector3(cx + sx * half, top / 2, cz + sz * half), new Vector3(0.3, top, 0.3), red);
      }
    }
    for (let y = 4.5; y < top; y += 4.5) {
      b.box(new Vector3(cx, y, cz - half), new Vector3(half * 2, 0.2, 0.2), red);
      b.box(new Vector3(cx, y, cz + half), new Vector3(half * 2, 0.2, 0.2), red);
      b.box(new Vector3(cx - half, y, cz), new Vector3(0.2, 0.2, half * 2), red);
      b.box(new Vector3(cx + half, y, cz), new Vector3(0.2, 0.2, half * 2), red);
    }
    b.box(new Vector3(cx, top, cz), new Vector3(half * 2 + 0.6, 0.3, half * 2 + 0.6), darkSteel);
    // Arm holding the dive gate.
    b.box(new Vector3(cx, 15, cz + 3.6), new Vector3(0.25, 0.25, 2.4), darkSteel);
  }

  // ---------- Bridge ----------
  {
    const z = 20;
    b.box(new Vector3(-85, 6.4, z), new Vector3(50, 0.8, 8), asphalt, { tile: 6 });
    // Railings.
    for (const side of [-1, 1]) {
      b.box(new Vector3(-85, 7.3, z + side * 3.9), new Vector3(50, 0.1, 0.1), steel);
      for (let x = -109; x <= -61; x += 4) {
        b.box(new Vector3(x, 7.0, z + side * 3.9), new Vector3(0.1, 1, 0.1), steel, { collide: false });
      }
    }
    for (const x of [-104, -94, -76, -66]) {
      b.box(new Vector3(x, 3, z), new Vector3(1.4, 6, 6.5), concrete);
    }
    // Ramps down at both ends.
    const rampLen = 22;
    const angle = Math.atan2(6.8, rampLen);
    const rampLength = Math.hypot(6.8, rampLen);
    for (const side of [-1, 1]) {
      const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -side * angle);
      const cx = -85 + side * (25 + rampLen / 2);
      b.box(new Vector3(cx, 3.4 - 0.2, z), new Vector3(rampLength, 0.6, 8), asphalt, { rot, tile: 6 });
    }
  }

  // ---------- Container yard ----------
  const containerMats = ['#b8442f', '#2f6db8', '#3e8f4a', '#d39a2a', '#7d7f86'].map(
    (c) => new MeshStandardMaterial({ map: containerTexture(c), roughness: 0.7, metalness: 0.2 }),
  );
  {
    const dir = new Vector3(70, 0, -80).normalize();
    const side = new Vector3(-dir.z, 0, dir.x);
    const yaw = Math.atan2(-dir.z, dir.x);
    const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    const center = new Vector3(45, 0, -45);
    const size = new Vector3(12.2, 2.6, 2.44);
    let k = 0;
    for (const s of [-1, 1]) {
      for (const along of [-13, 0, 13]) {
        const stack = along === 0 ? 3 : 2;
        for (let lvl = 0; lvl < stack; lvl++) {
          const p = center
            .clone()
            .addScaledVector(dir, along)
            .addScaledVector(side, s * (3.9 + lvl * 0.2))
            .setY(1.3 + lvl * 2.6);
          b.box(p, size, containerMats[k++ % containerMats.length], { rot });
        }
      }
    }
    // A container arch for freestyle.
    const archRot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3);
    const archC = new Vector3(85, 0, -40);
    const archSide = new Vector3(Math.cos(0.3), 0, -Math.sin(0.3));
    for (const s of [-1, 1]) {
      for (let lvl = 0; lvl < 2; lvl++) {
        const p = archC.clone().addScaledVector(archSide, s * 5).setY(1.3 + lvl * 2.6);
        b.box(p, new Vector3(2.44, 2.6, 12.2), containerMats[(k++ + lvl) % 5], { rot: archRot });
      }
    }
    b.box(archC.clone().setY(6.5), new Vector3(12.2, 2.6, 2.44), containerMats[1], { rot: archRot });
  }

  // ---------- Power pylons ----------
  const pylon = (x: number, z: number) => {
    const h = 26;
    const baseHalf = 3;
    const topHalf = 0.8;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.beam(
          new Vector3(x + sx * baseHalf, 0, z + sz * baseHalf),
          new Vector3(x + sx * topHalf, h, z + sz * topHalf),
          0.3,
          steel,
        );
      }
    }
    for (let y = 5; y < h; y += 5) {
      const w = baseHalf + (topHalf - baseHalf) * (y / h);
      b.box(new Vector3(x, y, z - w), new Vector3(w * 2, 0.15, 0.15), steel, { collide: false });
      b.box(new Vector3(x, y, z + w), new Vector3(w * 2, 0.15, 0.15), steel, { collide: false });
      b.box(new Vector3(x - w, y, z), new Vector3(0.15, 0.15, w * 2), steel, { collide: false });
      b.box(new Vector3(x + w, y, z), new Vector3(0.15, 0.15, w * 2), steel, { collide: false });
    }
    b.box(new Vector3(x, 21, z), new Vector3(1, 0.4, 12), steel);
    b.box(new Vector3(x, 25, z), new Vector3(1, 0.4, 8), steel);
  };
  pylon(60, -95);
  pylon(100, -95);
  for (const [y, zOff] of [
    [20.6, -5.6],
    [20.6, 5.6],
    [24.6, -3.6],
    [24.6, 3.6],
  ]) {
    b.beam(new Vector3(60, y, -95 + zOff), new Vector3(100, y, -95 + zOff), 0.06, darkSteel);
    b.beam(new Vector3(100, y, -95 + zOff), new Vector3(170, y - 4, -95 + zOff * 1.2), 0.06, darkSteel, false);
    b.beam(new Vector3(60, y, -95 + zOff), new Vector3(-10, y - 4, -95 + zOff * 1.2), 0.06, darkSteel, false);
  }

  // ---------- Gates ----------
  const gates: GateObject[] = [];
  const gaps: GapZone[] = [];
  const labelCache = new Map<number, SpriteMaterial>();

  TRACK.forEach((spec, index) => {
    const pos = new Vector3(...spec.pos);
    let dir: Vector3;
    if (spec.dir) dir = new Vector3(...spec.dir).normalize();
    else {
      const prev = new Vector3(...TRACK[(index - 1 + TRACK.length) % TRACK.length].pos);
      const next = new Vector3(...TRACK[(index + 1) % TRACK.length].pos);
      dir = next.sub(prev).setY(0).normalize();
    }
    const rot = rotationFacing(dir);
    const portal = makePortal(pos, rot, spec.w, spec.h, spec.shape ?? 'rect');
    const material = new MeshStandardMaterial({
      color: GATE_COLORS.idle,
      emissive: GATE_COLORS.idle,
      emissiveIntensity: 0.35,
      roughness: 0.5,
    });
    const root = new Group();
    scene.add(root);
    const gb = new Builder(root, collision, shadows);
    const t = 0.28;
    const kind = spec.kind ?? 'standard';
    const local = (x: number, y: number, z = 0) => new Vector3(x, y, z).applyQuaternion(rot).add(pos);

    if (kind === 'ring') {
      const r = spec.w / 2 + t / 2;
      const torus = new Mesh(new TorusGeometry(r, t / 2, 10, 40), material);
      torus.position.copy(pos);
      torus.quaternion.copy(rot);
      torus.castShadow = shadows;
      root.add(torus);
      const segs = 16;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const c = local(Math.cos(a) * r, Math.sin(a) * r);
        const segRot = rot.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), a));
        collision.add(boxCollider(c, new Vector3(t, (2 * Math.PI * r) / segs + 0.05, t), segRot));
      }
      gb.box(new Vector3(pos.x, (pos.y - r) / 2, pos.z), new Vector3(0.25, pos.y - r, 0.25), steel);
    } else if (kind === 'flags') {
      const flagMat = new MeshStandardMaterial({ color: '#ff2d55', side: DoubleSide, roughness: 0.7 });
      for (const s of [-1, 1]) {
        const base = local(s * (spec.w / 2 + 0.1), 0);
        base.y = 0;
        gb.box(base.clone().setY(3.6), new Vector3(0.12, 7.2, 0.12), white);
        const flag = new Mesh(new PlaneGeometry(1.2, 4.2), s < 0 ? material : flagMat);
        flag.position.copy(local(s * (spec.w / 2 + 0.75), 2.2));
        flag.quaternion.copy(rot);
        flag.castShadow = shadows;
        root.add(flag);
      }
    } else if (kind === 'window') {
      // The window itself is the gate; add a glowing frame on the wall face.
      const strip = (x: number, y: number, w: number, h: number) =>
        gb.box(local(x, y, 0.25), new Vector3(w, h, 0.08), material, { collide: false, shadow: false });
      strip(0, spec.h / 2 + 0.06, spec.w, 0.12);
      strip(0, -spec.h / 2 - 0.06, spec.w, 0.12);
      strip(-spec.w / 2 - 0.06, 0, 0.12, spec.h);
      strip(spec.w / 2 + 0.06, 0, 0.12, spec.h);
    } else {
      const hw = spec.w / 2;
      const hh = spec.h / 2;
      const bar = (x: number, y: number, w: number, h: number) =>
        gb.box(local(x, y), new Vector3(w, h, t), material, { rot });
      bar(-hw - t / 2, 0, t, spec.h + 2 * t);
      bar(hw + t / 2, 0, t, spec.h + 2 * t);
      bar(0, hh + t / 2, spec.w, t);
      bar(0, -hh - t / 2, spec.w, t);
      if (kind === 'stacked') {
        // Lower gate below the scored opening.
        const lowerTop = -hh - t;
        const lowerH = pos.y + lowerTop - 0.4;
        bar(-hw - t / 2, lowerTop - lowerH / 2, t, lowerH);
        bar(hw + t / 2, lowerTop - lowerH / 2, t, lowerH);
        bar(0, lowerTop - lowerH - t / 2, spec.w, t);
      }
      if (kind !== 'dive' && kind !== 'stacked') {
        const bottom = pos.y - hh - t;
        if (bottom > 0.3) {
          for (const s of [-1, 1]) {
            const p = local(s * (hw + t / 2), 0);
            gb.box(new Vector3(p.x, bottom / 2, p.z), new Vector3(0.18, bottom, 0.18), steel);
          }
        }
      }
      if (kind === 'start') {
        const banner = new Mesh(
          new PlaneGeometry(spec.w + 2 * t, 1.1),
          new MeshBasicMaterial({ map: bannerTexture('START · FINISH', '#111111'), side: DoubleSide }),
        );
        banner.position.copy(local(0, hh + t + 0.6));
        banner.quaternion.copy(rot);
        root.add(banner);
        const check = new MeshStandardMaterial({ map: checkerTexture('#111', '#fff', 6) });
        gb.box(local(0, hh + t + 0.03, 0), new Vector3(spec.w + 2 * t, 0.06, 0.06), check, { rot, collide: false });
      }
    }

    // Floating gate number.
    let mat = labelCache.get(index);
    if (!mat) {
      mat = new SpriteMaterial({
        map: labelTexture(index === 0 ? 'S' : String(index), '#ffffff', 'rgba(20,20,24,0.85)'),
        depthWrite: false,
        fog: false,
      });
      labelCache.set(index, mat);
    }
    const label = new Sprite(mat);
    const labelPos = kind === 'dive' ? pos.clone().add(new Vector3(0, 2.5, 0)) : local(0, spec.h / 2 + 2.2);
    label.position.copy(labelPos);
    label.scale.setScalar(1.6);
    root.add(label);

    gates.push({ index, portal, material, label, root });
  });

  // ---------- Freestyle gaps ----------
  const addGap = (name: string, center: Vector3, dir: Vector3, w: number, h: number) =>
    gaps.push({ name, portal: makePortal(center, rotationFacing(dir), w, h, 'rect', true) });
  {
    const { x0, x1, z0, z1, floor, floors } = BANDO;
    for (let f = 0; f < floors; f++) {
      const y = f * floor;
      for (let u = 2.2; u < x1 - x0 - 2; u += 4.8) {
        for (const z of [z0, z1]) addGap('Bando 窗口', new Vector3(x0 + u + 1.3, y + 2.25, z), new Vector3(0, 0, 1), 2.6, 2.3);
      }
      const v = f === 0 ? [0, 3.6] : [0.75, 3.75];
      for (const x of [x0, x1]) {
        addGap('Bando 窗口', new Vector3(x, y + (v[0] + v[1]) / 2, z0 + 7), new Vector3(1, 0, 0), 4, v[1] - v[0]);
      }
    }
    addGap('楼板洞', new Vector3(-26, BANDO.floor - 0.2, -111.5), new Vector3(0, 1, 0), 4, 5);
    addGap('楼板洞', new Vector3(-35.5, BANDO.floor * 2 - 0.2, -109.5), new Vector3(0, 1, 0), 5, 5);
    addGap('天台破洞', new Vector3(-25, BANDO.floor * 3 - 0.2, -110), new Vector3(0, 1, 0), 10, 10);
    addGap('桥下', new Vector3(-85, 3, 20), new Vector3(0, 0, 1), 16, 6);
    addGap('电塔线下', new Vector3(80, 10, -95), new Vector3(0, 0, 1), 38, 20);
    addGap('电线之间', new Vector3(80, 22.6, -95), new Vector3(0, 0, 1), 38, 3.6);
    addGap('塔架', new Vector3(-85, 9, -101), new Vector3(1, 0, 0), 4.6, 17);
    addGap('塔架', new Vector3(-85, 9, -101), new Vector3(0, 0, 1), 4.6, 17);
    addGap('集装箱拱门', new Vector3(85, 2.6, -40), new Vector3(Math.sin(0.3), 0, Math.cos(0.3)), 7.4, 5.2);
  }

  // ---------- Trees ----------
  const treeCount = quality === 'low' ? 160 : quality === 'medium' ? 280 : 420;
  const trunkGeo = new CylinderGeometry(0.18, 0.28, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new ConeGeometry(1, 1, 8);
  crownGeo.translate(0, 0.5, 0);
  const bushGeo = new IcosahedronGeometry(1, 1);
  const trunks = new InstancedMesh(trunkGeo, new MeshLambertMaterial({ map: barkTexture() }), treeCount);
  const crowns = new InstancedMesh(crownGeo, new MeshLambertMaterial({ map: foliageTexture() }), treeCount * 2);
  const bushes = new InstancedMesh(bushGeo, new MeshLambertMaterial({ map: foliageTexture(), flatShading: true }), 80);
  trunks.castShadow = crowns.castShadow = bushes.castShadow = shadows;
  scene.add(trunks, crowns, bushes);

  const keepOut: [number, number, number, number][] = [
    [BANDO.x0 - 6, BANDO.x1 + 6, BANDO.z0 - 6, BANDO.z1 + 6],
    [-95, -75, -110, -85],
    [-115, -50, 10, 30],
    [20, 70, -70, -20],
    [50, 110, -105, -85],
    [70, 100, -55, -25],
    [-26, 6, 36, 60],
  ];
  const segDist = (px: number, pz: number, a: Vector3, c: Vector3) => {
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / len2));
    return Math.hypot(px - (a.x + dx * t), pz - (a.z + dz * t));
  };
  const trackPts = TRACK.map((g) => new Vector3(...g.pos));
  const ok = (x: number, z: number, clearance: number) => {
    for (const [ax, bx, az, bz] of keepOut) if (x > ax && x < bx && z > az && z < bz) return false;
    for (let i = 0; i < trackPts.length; i++) {
      if (segDist(x, z, trackPts[i], trackPts[(i + 1) % trackPts.length]) < clearance) return false;
    }
    if (Math.hypot(x, z - 48) < 12) return false;
    return true;
  };

  const tr = rng(2024);
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const pTmp = new Vector3();
  let placed = 0;
  let crownIdx = 0;
  const placeTree = (x: number, z: number, height: number) => {
    const trunkH = height * 0.35;
    const radius = height * (0.2 + tr() * 0.08);
    q.setFromAxisAngle(new Vector3(0, 1, 0), tr() * Math.PI * 2);
    m.compose(pTmp.set(x, 0, z), q, s.set(height * 0.06 + 0.4, trunkH + 0.4, height * 0.06 + 0.4));
    trunks.setMatrixAt(placed, m);
    for (let k = 0; k < 2; k++) {
      const ch = height * (k === 0 ? 0.6 : 0.42);
      const cy = trunkH * 0.7 + k * height * 0.3;
      const rr = radius * (k === 0 ? 1 : 0.7);
      m.compose(pTmp.set(x, cy, z), q, s.set(rr, ch, rr));
      crowns.setMatrixAt(crownIdx++, m);
    }
    collision.add({
      kind: 'cyl',
      center: new Vector3(x, 0, z),
      radius: 0.35,
      height: trunkH + 0.5,
      bound: trunkH,
      boundCenter: new Vector3(x, (trunkH + 0.5) / 2, z),
    });
    // Foliage as a slimmer cylinder (cones are hard to fly through anyway).
    const fy = trunkH * 0.7;
    const fh = height - fy;
    collision.add({
      kind: 'cyl',
      center: new Vector3(x, fy, z),
      radius: radius * 0.6,
      height: fh * 0.8,
      bound: Math.hypot(radius, fh / 2),
      boundCenter: new Vector3(x, fy + fh * 0.4, z),
    });
    placed++;
  };

  // Grove for freestyle weaving.
  for (let i = 0; i < 40 && placed < treeCount; i++) {
    const x = 50 + (tr() - 0.5) * 50;
    const z = 15 + (tr() - 0.5) * 45;
    if (ok(x, z, 10)) placeTree(x, z, 9 + tr() * 7);
  }
  let guard = 0;
  while (placed < treeCount && guard++ < 20000) {
    const a = tr() * Math.PI * 2;
    const d = 30 + Math.sqrt(tr()) * 260;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (ok(x, z, 11)) placeTree(x, z, 8 + tr() * 10);
  }
  trunks.count = placed;
  crowns.count = crownIdx;
  let bushCount = 0;
  guard = 0;
  while (bushCount < 80 && guard++ < 5000) {
    const x = (tr() - 0.5) * 400;
    const z = (tr() - 0.5) * 400;
    if (!ok(x, z, 7)) continue;
    const r = 0.6 + tr() * 1.1;
    m.compose(pTmp.set(x, r * 0.5, z), q.identity(), s.set(r * 1.3, r, r * 1.3));
    bushes.setMatrixAt(bushCount++, m);
  }
  bushes.count = bushCount;

  // ---------- Behaviour ----------
  let highlighted: number | null = -1;
  const highlightGates = (next: number | null) => {
    if (next === highlighted) return;
    highlighted = next;
    for (const g of gates) {
      let c = GATE_COLORS.free;
      let glow = 0.35;
      if (next !== null) {
        const after = (next + 1) % gates.length;
        if (g.index === next) {
          c = GATE_COLORS.next;
          glow = 1.1;
        } else if (g.index === after) {
          c = GATE_COLORS.after;
          glow = 0.6;
        } else {
          c = GATE_COLORS.idle;
          glow = 0.25;
        }
      }
      g.material.color.copy(c);
      g.material.emissive.copy(c);
      g.material.emissiveIntensity = glow;
      g.label.visible = next !== null;
    }
  };

  const sunOffset = new Vector3(45, 60, -65);
  const update = (time: number, focus: Vector3) => {
    if (highlighted !== null && highlighted >= 0) {
      const g = gates[highlighted];
      g.material.emissiveIntensity = 0.9 + Math.sin(time * 6) * 0.35;
      g.label.scale.setScalar(1.6 + Math.sin(time * 6) * 0.15);
    }
    // Keep the shadow frustum centred on the action.
    sun.position.copy(focus).add(sunOffset);
    sun.target.position.copy(focus);
  };

  return {
    scene,
    collision,
    gates,
    gaps,
    spawn: { pos: new Vector3(0, 0.15, 48), yaw: 0 },
    sun,
    pilotPosition,
    highlightGates,
    update,
  };
}
