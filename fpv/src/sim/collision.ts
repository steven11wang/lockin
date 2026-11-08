import { Quaternion, Vector3 } from 'three';

export interface BoxCollider {
  kind: 'box';
  center: Vector3;
  half: Vector3;
  rot: Quaternion;
  invRot: Quaternion;
  bound: number;
  tag?: string;
}

export interface CylinderCollider {
  kind: 'cyl';
  center: Vector3; // base center
  radius: number;
  height: number;
  bound: number;
  boundCenter: Vector3;
  tag?: string;
}

export type Collider = BoxCollider | CylinderCollider;

export interface Contact {
  normal: Vector3;
  depth: number;
  collider: Collider | null;
}

export function boxCollider(center: Vector3, size: Vector3, rot = new Quaternion(), tag?: string): BoxCollider {
  const half = size.clone().multiplyScalar(0.5);
  return {
    kind: 'box',
    center: center.clone(),
    half,
    rot: rot.clone(),
    invRot: rot.clone().invert(),
    bound: half.length(),
    tag,
  };
}

export function cylinderCollider(base: Vector3, radius: number, height: number, tag?: string): CylinderCollider {
  return {
    kind: 'cyl',
    center: base.clone(),
    radius,
    height,
    bound: Math.hypot(radius, height / 2),
    boundCenter: base.clone().add(new Vector3(0, height / 2, 0)),
    tag,
  };
}

const _local = new Vector3();
const _clamped = new Vector3();

/**
 * Signed distance from point to collider surface (negative inside) and outward normal.
 * Returns Infinity when the bounding sphere is farther than `maxDist`.
 */
export function distanceTo(c: Collider, p: Vector3, maxDist: number, normalOut: Vector3): number {
  if (c.kind === 'box') {
    const dx = p.x - c.center.x;
    const dy = p.y - c.center.y;
    const dz = p.z - c.center.z;
    if (dx * dx + dy * dy + dz * dz > (c.bound + maxDist) ** 2) return Infinity;
    _local.set(dx, dy, dz).applyQuaternion(c.invRot);
    const h = c.half;
    _clamped.set(
      Math.max(-h.x, Math.min(h.x, _local.x)),
      Math.max(-h.y, Math.min(h.y, _local.y)),
      Math.max(-h.z, Math.min(h.z, _local.z)),
    );
    const ox = _local.x - _clamped.x;
    const oy = _local.y - _clamped.y;
    const oz = _local.z - _clamped.z;
    const outside = ox * ox + oy * oy + oz * oz;
    if (outside > 1e-12) {
      const d = Math.sqrt(outside);
      normalOut.set(ox / d, oy / d, oz / d).applyQuaternion(c.rot);
      return d;
    }
    // Inside: push out through the nearest face.
    const px = h.x - Math.abs(_local.x);
    const py = h.y - Math.abs(_local.y);
    const pz = h.z - Math.abs(_local.z);
    if (px <= py && px <= pz) normalOut.set(Math.sign(_local.x) || 1, 0, 0);
    else if (py <= pz) normalOut.set(0, Math.sign(_local.y) || 1, 0);
    else normalOut.set(0, 0, Math.sign(_local.z) || 1);
    normalOut.applyQuaternion(c.rot);
    return -Math.min(px, py, pz);
  }

  const bc = c.boundCenter;
  const bx = p.x - bc.x;
  const by = p.y - bc.y;
  const bz = p.z - bc.z;
  if (bx * bx + by * by + bz * bz > (c.bound + maxDist) ** 2) return Infinity;
  const dx = p.x - c.center.x;
  const dz = p.z - c.center.z;
  const radial = Math.hypot(dx, dz);
  const y0 = c.center.y;
  const y1 = c.center.y + c.height;
  const outR = radial - c.radius;
  const below = y0 - p.y;
  const above = p.y - y1;
  const outY = Math.max(below, above);
  if (outR > 0 || outY > 0) {
    const rx = outR > 0 ? (dx / radial) * outR : 0;
    const rz = outR > 0 ? (dz / radial) * outR : 0;
    const ry = outY > 0 ? (below > 0 ? -below : above) : 0;
    const d = Math.hypot(rx, ry, rz);
    normalOut.set(rx / d, ry / d, rz / d);
    return d;
  }
  // Inside the cylinder.
  if (-outR < -outY) {
    if (radial < 1e-6) normalOut.set(1, 0, 0);
    else normalOut.set(dx / radial, 0, dz / radial);
    return outR;
  }
  normalOut.set(0, below > above ? -1 : 1, 0);
  return outY;
}

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private readonly n = new Vector3();

  add(c: Collider): void {
    this.colliders.push(c);
  }

  /** Deepest contact for a sphere, including the ground plane at y = 0. */
  contact(p: Vector3, radius: number, out: Contact): boolean {
    let best = 0;
    out.collider = null;
    if (p.y < radius) {
      best = radius - p.y;
      out.normal.set(0, 1, 0);
    }
    for (const c of this.colliders) {
      const d = distanceTo(c, p, radius, this.n);
      if (d < radius) {
        const depth = radius - d;
        if (depth > best) {
          best = depth;
          out.normal.copy(this.n);
          out.collider = c;
        }
      }
    }
    out.depth = best;
    return best > 0;
  }

  /** Nearest obstacle surface distance (excluding ground) up to maxDist. */
  nearest(p: Vector3, maxDist: number): number {
    let best = maxDist;
    for (const c of this.colliders) {
      const d = distanceTo(c, p, best, this.n);
      if (d < best) best = d;
    }
    return best;
  }
}
