import { Quaternion, Vector3 } from 'three';

export type GateShape = 'rect' | 'ring';

/** A pass-through plane. Local frame: opening in XY, pass direction is local -Z. */
export interface Portal {
  center: Vector3;
  rot: Quaternion;
  invRot: Quaternion;
  width: number;
  height: number;
  shape: GateShape;
  /** When true, crossing in either direction counts. */
  bidirectional: boolean;
}

export function makePortal(
  center: Vector3,
  rot: Quaternion,
  width: number,
  height: number,
  shape: GateShape = 'rect',
  bidirectional = false,
): Portal {
  return { center: center.clone(), rot: rot.clone(), invRot: rot.clone().invert(), width, height, shape, bidirectional };
}

/** Rotation whose local -Z points along `dir`. */
export function rotationFacing(dir: Vector3): Quaternion {
  const d = dir.clone().normalize();
  const yaw = Math.atan2(-d.x, -d.z);
  const horiz = Math.hypot(d.x, d.z);
  const pitch = Math.atan2(d.y, horiz);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch));
  return q;
}

const _a = new Vector3();
const _b = new Vector3();

/** Did the segment prev -> cur pass through the portal's opening? */
export function crossesPortal(portal: Portal, prev: Vector3, cur: Vector3): boolean {
  const a = _a.copy(prev).sub(portal.center).applyQuaternion(portal.invRot);
  const b = _b.copy(cur).sub(portal.center).applyQuaternion(portal.invRot);
  const forward = a.z > 0 && b.z <= 0;
  const backward = portal.bidirectional && a.z < 0 && b.z >= 0;
  if (!forward && !backward) return false;
  const t = a.z / (a.z - b.z);
  const x = a.x + (b.x - a.x) * t;
  const y = a.y + (b.y - a.y) * t;
  if (portal.shape === 'ring') {
    const r = portal.width / 2;
    return x * x + y * y <= r * r;
  }
  return Math.abs(x) <= portal.width / 2 && Math.abs(y) <= portal.height / 2;
}

/** Pass direction of a portal in world space. */
export function portalDirection(portal: Portal, target = new Vector3()): Vector3 {
  return target.set(0, 0, -1).applyQuaternion(portal.rot);
}
