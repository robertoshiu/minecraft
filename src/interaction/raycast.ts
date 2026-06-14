/**
 * raycast.ts — Amanatides–Woo voxel DDA for block selection.
 *
 * Casts a ray through a voxel grid and returns the first non-AIR voxel it
 * enters, along with the face the ray passed through and the empty voxel just
 * in front of that face (where a placed block would go).
 *
 * The world is treated as an infinite grid of unit cubes: voxel (bx,by,bz)
 * occupies the axis-aligned box [bx, bx+1) × [by, by+1) × [bz, bz+1).
 */

import { Blocks, type BlockId } from "../rules/mc-1.20";
import type { FaceDir } from "../chunk/data";

/** A 3D vector / point in world space. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Look up the block id stored at integer voxel coordinates (bx,by,bz). */
export type BlockQuery = (bx: number, by: number, bz: number) => BlockId;

/** Result of a successful voxel raycast. */
export interface RaycastHit {
  /** The hit voxel's integer coordinates. */
  block: { x: number; y: number; z: number };
  /**
   * Which face of {@link block} the ray entered through — the side facing the
   * camera. Moving along +axis enters through that axis's negative face.
   */
  face: FaceDir;
  /**
   * The empty voxel adjacent to {@link block} across {@link face}: the last
   * empty cell the ray occupied before the hit, and where a placed block goes.
   */
  previous: { x: number; y: number; z: number };
}

/** The axis along which a voxel boundary was last crossed. */
type Axis = "x" | "y" | "z";

/**
 * Map the crossing axis + the sign of the ray's direction on that axis to the
 * FaceDir of the entered face.
 *
 * Entering a voxel while travelling in the +axis direction means crossing the
 * voxel's low (negative) boundary, so you hit its negative face:
 *   +x → 'nx'   -x → 'px'
 *   +y → 'ny'   -y → 'py'
 *   +z → 'nz'   -z → 'pz'
 */
function faceFor(axis: Axis, positiveDir: boolean): FaceDir {
  switch (axis) {
    case "x":
      return positiveDir ? "nx" : "px";
    case "y":
      return positiveDir ? "ny" : "py";
    case "z":
      return positiveDir ? "nz" : "pz";
  }
}

/**
 * Cast a ray and return the first non-AIR voxel within `maxDistance`, or null.
 *
 * `dir` need not be normalized; it is normalized internally. AIR is treated as
 * empty / pass-through and every other block id is a hittable target.
 */
export function raycastVoxel(
  origin: Vec3,
  dir: Vec3,
  maxDistance: number,
  getBlock: BlockQuery,
): RaycastHit | null {
  // Normalize the direction so `tMax`/`tDelta` are measured in world units and
  // can be compared directly against `maxDistance`.
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len === 0 || maxDistance <= 0) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  const dz = dir.z / len;

  // Current voxel containing the origin.
  let bx = Math.floor(origin.x);
  let by = Math.floor(origin.y);
  let bz = Math.floor(origin.z);

  // Step direction per axis (+1 / -1; 0 if the ray is parallel to that axis).
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  // Distance (in t, world units) to cross a full voxel along each axis.
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
  const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);

  // Distance (in t) from the origin to the first voxel boundary on each axis.
  const tMaxFor = (start: number, b: number, step: number, delta: number): number => {
    if (step === 0) return Infinity;
    // Boundary we head toward: the upper edge when stepping +, lower when -.
    const next = step > 0 ? b + 1 : b;
    const distToBoundary = step > 0 ? next - start : start - next;
    return distToBoundary * delta;
  };
  let tMaxX = tMaxFor(origin.x, bx, stepX, tDeltaX);
  let tMaxY = tMaxFor(origin.y, by, stepY, tDeltaY);
  let tMaxZ = tMaxFor(origin.z, bz, stepZ, tDeltaZ);

  // The origin voxel itself: if it is already solid, the ray "enters" it at the
  // origin with no boundary crossing. There is no well-defined entry face, so
  // fall back to the dominant direction axis. `previous` is one step back along
  // that axis (the cell the camera is effectively looking from).
  if (getBlock(bx, by, bz) !== Blocks.AIR) {
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const adz = Math.abs(dz);
    let axis: Axis = "x";
    let step = stepX;
    if (ady >= adx && ady >= adz) {
      axis = "y";
      step = stepY;
    } else if (adz >= adx && adz >= ady) {
      axis = "z";
      step = stepZ;
    }
    const face = faceFor(axis, step > 0);
    const prev = { x: bx, y: by, z: bz };
    if (axis === "x") prev.x -= step;
    else if (axis === "y") prev.y -= step;
    else prev.z -= step;
    return { block: { x: bx, y: by, z: bz }, face, previous: prev };
  }

  // March voxel-by-voxel. Each iteration crosses exactly one boundary.
  for (;;) {
    let axis: Axis;
    let step: number;
    let t: number;
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
      axis = "x";
      step = stepX;
      t = tMaxX;
      bx += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxY <= tMaxZ) {
      axis = "y";
      step = stepY;
      t = tMaxY;
      by += stepY;
      tMaxY += tDeltaY;
    } else {
      axis = "z";
      step = stepZ;
      t = tMaxZ;
      bz += stepZ;
      tMaxZ += tDeltaZ;
    }

    // The crossing happened at distance `t`; if that is already past the limit
    // there is nothing more to test.
    if (t > maxDistance) return null;

    if (getBlock(bx, by, bz) !== Blocks.AIR) {
      const face = faceFor(axis, step > 0);
      const previous = {
        x: axis === "x" ? bx - step : bx,
        y: axis === "y" ? by - step : by,
        z: axis === "z" ? bz - step : bz,
      };
      return { block: { x: bx, y: by, z: bz }, face, previous };
    }
  }
}
