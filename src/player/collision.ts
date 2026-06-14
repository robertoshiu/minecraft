/**
 * Swept AABB voxel collision for a Minecraft-clone player.
 *
 * Conventions:
 *  - A solid voxel at integer block coords (bx, by, bz) occupies the world-space
 *    box [bx, bx+1] x [by, by+1] x [bz, bz+1].
 *  - "feet" is the player's reference point: centered on x/z, with y at the
 *    bottom of the AABB. So a player standing on top of the block at by=63
 *    (which spans world Y [63, 64]) has feet.y === 64.
 */

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Is the voxel at integer block coords solid (collidable)? */
export type SolidQuery = (bx: number, by: number, bz: number) => boolean;

export const PLAYER_SIZE = { width: 0.6, height: 1.8, depth: 0.6 } as const;

/** Max distance a single sub-step may move on any axis, to prevent tunneling. */
const MAX_SUBSTEP = 0.2;

/** Tiny epsilon used to keep the AABB from being exactly flush (avoids
 *  re-detecting the just-touched face on the next axis/step). */
const EPSILON = 1e-7;

/** Build the player AABB from a feet position (center x/z, y = bottom). */
export function aabbFromFeet(feet: Vec3): AABB {
  const hw = PLAYER_SIZE.width / 2;
  const hd = PLAYER_SIZE.depth / 2;
  return {
    minX: feet.x - hw,
    minY: feet.y,
    minZ: feet.z - hd,
    maxX: feet.x + hw,
    maxY: feet.y + PLAYER_SIZE.height,
    maxZ: feet.z + hd,
  };
}

function floorInt(v: number): number {
  return Math.floor(v);
}

/**
 * Largest integer block cell index touched by the half-open span [min, max).
 * For a box face at exactly an integer boundary `max`, the cell `max` is NOT
 * overlapped (the box ends where that cell begins), so we walk to ceil(max)-1.
 */
function cellRange(min: number, max: number): { lo: number; hi: number } {
  const lo = floorInt(min);
  // If max sits exactly on an integer boundary, the cell starting at `max`
  // is not overlapped; otherwise it is.
  let hi = Math.ceil(max) - 1;
  if (hi < lo) hi = lo;
  return { lo, hi };
}

/**
 * Resolve motion along a single axis using the swept-AABB approach:
 * expand the box by the motion, iterate the integer cells overlapped on the two
 * perpendicular axes, and find the nearest blocking face along the moving axis.
 *
 * Returns the (possibly clamped) signed displacement actually allowed, and
 * whether a blocking face was hit.
 */
function resolveAxis(
  box: AABB,
  axis: "x" | "y" | "z",
  delta: number,
  isSolid: SolidQuery,
): { moved: number; collided: boolean } {
  if (delta === 0) return { moved: 0, collided: false };

  // Perpendicular cell ranges (constant during this axis move).
  let pRange1: { lo: number; hi: number };
  let pRange2: { lo: number; hi: number };
  // Leading face position before the move, and the swept span along the axis.
  let leadFace: number;
  let minA: number;
  let maxA: number;

  if (axis === "x") {
    minA = box.minX;
    maxA = box.maxX;
    pRange1 = cellRange(box.minY, box.maxY);
    pRange2 = cellRange(box.minZ, box.maxZ);
  } else if (axis === "y") {
    minA = box.minY;
    maxA = box.maxY;
    pRange1 = cellRange(box.minX, box.maxX);
    pRange2 = cellRange(box.minZ, box.maxZ);
  } else {
    minA = box.minZ;
    maxA = box.maxZ;
    pRange1 = cellRange(box.minX, box.maxX);
    pRange2 = cellRange(box.minY, box.maxY);
  }

  const positive = delta > 0;
  leadFace = positive ? maxA : minA;
  const sweptLeadFace = leadFace + delta;

  // Range of cells (along the moving axis) the leading face sweeps through.
  const sweepLo = positive ? floorInt(leadFace) : floorInt(sweptLeadFace);
  const sweepHi = positive ? floorInt(sweptLeadFace) : floorInt(leadFace);

  let best = delta; // best (signed) allowed displacement so far
  let collided = false;

  // Helper to test a solid cell given moving-axis index `a` and the two
  // perpendicular indices.
  const cellSolid = (a: number, p1: number, p2: number): boolean => {
    if (axis === "x") return isSolid(a, p1, p2);
    if (axis === "y") return isSolid(p1, a, p2);
    return isSolid(p1, p2, a);
  };

  for (let a = sweepLo; a <= sweepHi; a++) {
    for (let p1 = pRange1.lo; p1 <= pRange1.hi; p1++) {
      for (let p2 = pRange2.lo; p2 <= pRange2.hi; p2++) {
        if (!cellSolid(a, p1, p2)) continue;

        // Distance from the leading face to this cell's blocking face.
        let allowed: number;
        if (positive) {
          // Block face we hit is its min side (a). Stop just before it.
          allowed = a - leadFace - EPSILON;
          if (allowed < 0) allowed = 0;
          if (allowed < best) {
            best = allowed;
            collided = true;
          }
        } else {
          // Moving negative: block face is its max side (a+1). Stop just after.
          allowed = a + 1 - leadFace + EPSILON;
          if (allowed > 0) allowed = 0;
          if (allowed > best) {
            best = allowed;
            collided = true;
          }
        }
      }
    }
  }

  return { moved: best, collided };
}

/**
 * Probe for a solid block flush beneath the feet (resting contact), used to
 * report onGround even when there is no downward motion this tick. Checks a
 * razor-thin slab just below the feet over the player's x/z footprint.
 */
function restingOnGround(feet: Vec3, isSolid: SolidQuery): boolean {
  const box = aabbFromFeet(feet);
  const probeY = box.minY - 2 * EPSILON;
  const by = floorInt(probeY);
  const xr = cellRange(box.minX, box.maxX);
  const zr = cellRange(box.minZ, box.maxZ);
  for (let bx = xr.lo; bx <= xr.hi; bx++) {
    for (let bz = zr.lo; bz <= zr.hi; bz++) {
      if (isSolid(bx, by, bz)) return true;
    }
  }
  return false;
}

/** Apply a displacement along one axis to a feet vector (returns new feet). */
function applyAxis(feet: Vec3, axis: "x" | "y" | "z", moved: number): Vec3 {
  if (axis === "x") return { x: feet.x + moved, y: feet.y, z: feet.z };
  if (axis === "y") return { x: feet.x, y: feet.y + moved, z: feet.z };
  return { x: feet.x, y: feet.y, z: feet.z + moved };
}

/**
 * Axis-separated swept move with sub-stepping. Moves X, then Y, then Z,
 * resolving against solid voxels on each axis. onGround is true iff the player
 * was moving down (velocity.y < 0) and Y motion was blocked.
 */
export function sweepMove(
  feet: Vec3,
  velocity: Vec3,
  isSolid: SolidQuery,
): { feet: Vec3; collided: { x: boolean; y: boolean; z: boolean }; onGround: boolean } {
  // Determine sub-step count so no axis exceeds MAX_SUBSTEP per step.
  const maxComponent = Math.max(
    Math.abs(velocity.x),
    Math.abs(velocity.y),
    Math.abs(velocity.z),
  );
  const steps = Math.max(1, Math.ceil(maxComponent / MAX_SUBSTEP));

  const stepVel: Vec3 = {
    x: velocity.x / steps,
    y: velocity.y / steps,
    z: velocity.z / steps,
  };

  let current: Vec3 = { x: feet.x, y: feet.y, z: feet.z };
  const collided = { x: false, y: false, z: false };
  let yBlocked = false;

  for (let s = 0; s < steps; s++) {
    // X axis
    {
      const box = aabbFromFeet(current);
      const r = resolveAxis(box, "x", stepVel.x, isSolid);
      if (r.collided) collided.x = true;
      current = applyAxis(current, "x", r.moved);
    }
    // Y axis
    {
      const box = aabbFromFeet(current);
      const r = resolveAxis(box, "y", stepVel.y, isSolid);
      if (r.collided) {
        collided.y = true;
        yBlocked = true;
      }
      current = applyAxis(current, "y", r.moved);
    }
    // Z axis
    {
      const box = aabbFromFeet(current);
      const r = resolveAxis(box, "z", stepVel.z, isSolid);
      if (r.collided) collided.z = true;
      current = applyAxis(current, "z", r.moved);
    }
  }

  // onGround when downward motion was blocked this tick, OR when resting flush
  // on a solid block (handles the zero/non-downward-velocity standing case).
  const onGround = (velocity.y < 0 && yBlocked) || restingOnGround(current, isSolid);

  return { feet: current, collided, onGround };
}
