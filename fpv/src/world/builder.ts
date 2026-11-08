import {
  BoxGeometry,
  type BufferGeometry,
  Euler,
  type Material,
  Mesh,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { boxCollider, cylinderCollider, type CollisionWorld } from '../sim/collision';

/** Box geometry whose UVs repeat every `tile` metres instead of stretching. */
export function tiledBox(sx: number, sy: number, sz: number, tile = 4): BufferGeometry {
  const g = new BoxGeometry(sx, sy, sz);
  const uv = g.getAttribute('uv');
  // Face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const dims: [number, number][] = [
    [sz, sy],
    [sz, sy],
    [sx, sz],
    [sx, sz],
    [sx, sy],
    [sx, sy],
  ];
  for (let face = 0; face < 6; face++) {
    const [du, dv] = dims[face];
    for (let i = 0; i < 4; i++) {
      const idx = face * 4 + i;
      uv.setXY(idx, (uv.getX(idx) * du) / tile, (uv.getY(idx) * dv) / tile);
    }
  }
  uv.needsUpdate = true;
  return g;
}

export interface BoxOptions {
  rot?: Quaternion;
  collide?: boolean;
  shadow?: boolean;
  tile?: number;
  tag?: string;
}

export class Builder {
  constructor(
    readonly root: Object3D,
    readonly collision: CollisionWorld,
    readonly shadows: boolean,
  ) {}

  box(center: Vector3, size: Vector3, material: Material, opts: BoxOptions = {}): Mesh {
    const mesh = new Mesh(tiledBox(size.x, size.y, size.z, opts.tile ?? 4), material);
    mesh.position.copy(center);
    if (opts.rot) mesh.quaternion.copy(opts.rot);
    const shadow = (opts.shadow ?? true) && this.shadows;
    mesh.castShadow = shadow;
    mesh.receiveShadow = this.shadows;
    this.root.add(mesh);
    if (opts.collide ?? true) this.collision.add(boxCollider(center, size, opts.rot, opts.tag));
    return mesh;
  }

  /** Box between two points (a beam), with square cross-section `thickness`. */
  beam(a: Vector3, b: Vector3, thickness: number, material: Material, collide = true): Mesh {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const center = a.clone().add(b).multiplyScalar(0.5);
    const rot = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    return this.box(center, new Vector3(thickness, len, thickness), material, { rot, collide, tile: 2 });
  }

  cylinderCollider(base: Vector3, radius: number, height: number, tag?: string): void {
    this.collision.add(cylinderCollider(base, radius, height, tag));
  }

  /**
   * A straight wall with rectangular openings. The wall starts at `origin`, runs
   * along `dir` (unit, horizontal) for `length`, and rises `height`.
   * Openings are [u0, u1, v0, v1] in metres along the wall / above its base.
   */
  wall(
    origin: Vector3,
    dir: Vector3,
    length: number,
    height: number,
    thickness: number,
    openings: [number, number, number, number][],
    material: Material,
  ): void {
    const yaw = Math.atan2(-dir.z, dir.x);
    const rot = new Quaternion().setFromEuler(new Euler(0, yaw, 0));
    const piece = (u0: number, u1: number, v0: number, v1: number) => {
      if (u1 - u0 < 0.01 || v1 - v0 < 0.01) return;
      const center = origin
        .clone()
        .addScaledVector(dir, (u0 + u1) / 2)
        .add(new Vector3(0, (v0 + v1) / 2, 0));
      this.box(center, new Vector3(u1 - u0, v1 - v0, thickness), material, { rot });
    };
    const sorted = [...openings].sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const [u0, u1, v0, v1] of sorted) {
      piece(cursor, u0, 0, height);
      piece(u0, u1, 0, v0);
      piece(u0, u1, v1, height);
      cursor = u1;
    }
    piece(cursor, length, 0, height);
  }

  /** Horizontal slab spanning [x0,x1]x[z0,z1] at height y with an optional hole. */
  slab(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    y: number,
    thickness: number,
    material: Material,
    hole?: [number, number, number, number],
  ): void {
    const part = (ax: number, bx: number, az: number, bz: number) => {
      if (bx - ax < 0.01 || bz - az < 0.01) return;
      this.box(
        new Vector3((ax + bx) / 2, y - thickness / 2, (az + bz) / 2),
        new Vector3(bx - ax, thickness, bz - az),
        material,
      );
    };
    if (!hole) {
      part(x0, x1, z0, z1);
      return;
    }
    const [hx0, hx1, hz0, hz1] = hole;
    part(x0, hx0, z0, z1);
    part(hx1, x1, z0, z1);
    part(hx0, hx1, z0, hz0);
    part(hx0, hx1, hz1, z1);
  }
}
