/**
 * physics.ts — size-aware swept-AABB physics for mobs.
 *
 * This is SEPARATE from player collision (src/player/collision.ts), which is
 * hardwired to PLAYER_SIZE. Mobs vary in width/height, so collision here is
 * parameterized by each mob's own hitbox via MOB_STATS.
 *
 * Conventions match the player:
 *  - Solid voxel at (bx,by,bz) occupies [bx,bx+1] x [by,by+1] x [bz,bz+1].
 *  - `feet` is center-x/z, bottom-y. Standing on block by=63 → feet.y === 64.
 *  - Velocity is in blocks/tick. Gravity/drag/jump come from PHYSICS.
 */

import { PHYSICS } from "../rules/mc-1.20";
import { MOB_STATS } from "../rules/mob-stats";
import type { Mob, Vec3 } from "./entity";

/** Is the voxel at integer block coords solid (collidable)? */
export type SolidQuery = (bx: number, by: number, bz: number) => boolean;

/** Max distance a single sub-step may move on any axis (prevents tunneling). */
const MAX_SUBSTEP = 0.2;

/** Tiny epsilon to keep the AABB from sitting exactly flush against a face. */
const EPSILON = 1e-7;

interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Build a mob's AABB from a feet position and its half-width/height. */
function boxFromFeet(feet: Vec3, hw: number, height: number): Box {
  return {
    minX: feet.x - hw,
    minY: feet.y,
    minZ: feet.z - hw,
    maxX: feet.x + hw,
    maxY: feet.y + height,
    maxZ: feet.z + hw,
  };
}

/**
 * Inclusive integer cell range overlapped by the half-open span [min, max).
 * A face exactly on an integer boundary `max` does not overlap cell `max`.
 */
function cellRange(min: number, max: number): { lo: number; hi: number } {
  const lo = Math.floor(min);
  let hi = Math.ceil(max) - 1;
  if (hi < lo) hi = lo;
  return { lo, hi };
}

/**
 * Resolve motion along one axis via swept AABB: walk the cells the leading face
 * sweeps through, find the nearest blocking face, and clamp the displacement.
 */
function resolveAxis(
  box: Box,
  axis: "x" | "y" | "z",
  delta: number,
  isSolid: SolidQuery,
): { moved: number; collided: boolean } {
  if (delta === 0) return { moved: 0, collided: false };

  let minA: number;
  let maxA: number;
  let pRange1: { lo: number; hi: number };
  let pRange2: { lo: number; hi: number };

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
  const leadFace = positive ? maxA : minA;
  const sweptLeadFace = leadFace + delta;

  const sweepLo = positive ? Math.floor(leadFace) : Math.floor(sweptLeadFace);
  const sweepHi = positive ? Math.floor(sweptLeadFace) : Math.floor(leadFace);

  let best = delta;
  let collided = false;

  const cellSolid = (a: number, p1: number, p2: number): boolean => {
    if (axis === "x") return isSolid(a, p1, p2);
    if (axis === "y") return isSolid(p1, a, p2);
    return isSolid(p1, p2, a);
  };

  for (let a = sweepLo; a <= sweepHi; a++) {
    for (let p1 = pRange1.lo; p1 <= pRange1.hi; p1++) {
      for (let p2 = pRange2.lo; p2 <= pRange2.hi; p2++) {
        if (!cellSolid(a, p1, p2)) continue;

        if (positive) {
          let allowed = a - leadFace - EPSILON;
          if (allowed < 0) allowed = 0;
          if (allowed < best) {
            best = allowed;
            collided = true;
          }
        } else {
          let allowed = a + 1 - leadFace + EPSILON;
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

/** Probe for a solid block flush beneath the feet (resting contact). */
function restingOnGround(
  feet: Vec3,
  hw: number,
  height: number,
  isSolid: SolidQuery,
): boolean {
  const box = boxFromFeet(feet, hw, height);
  const probeY = box.minY - 2 * EPSILON;
  const by = Math.floor(probeY);
  const xr = cellRange(box.minX, box.maxX);
  const zr = cellRange(box.minZ, box.maxZ);
  for (let bx = xr.lo; bx <= xr.hi; bx++) {
    for (let bz = zr.lo; bz <= zr.hi; bz++) {
      if (isSolid(bx, by, bz)) return true;
    }
  }
  return false;
}

/**
 * Advance a mob one tick.
 *
 *  1. Apply gravity to velocity.y (with DRAG, clamped at TERMINAL_VEL).
 *  2. Adopt the desired horizontal velocity (blocks/tick) from the AI.
 *  3. Axis-separated swept move (X, then Y, then Z) with sub-stepping against
 *     the mob's own hitbox, writing the result back into `mob.feet`.
 *  4. Set `onGround` when downward Y motion was blocked or the mob rests flush.
 */
export function mobStep(
  mob: Mob,
  desiredHoriz: Vec3,
  isSolid: SolidQuery,
): void {
  const stats = MOB_STATS[mob.type];
  const hw = stats.width / 2;
  const height = stats.height;

  // 1) Gravity (match player vertical integration: drag then accel).
  let vy = mob.velocity.y;
  vy = vy * PHYSICS.DRAG - PHYSICS.GRAVITY;
  if (vy < PHYSICS.TERMINAL_VEL) vy = PHYSICS.TERMINAL_VEL;
  mob.velocity.y = vy;

  // 2) Horizontal velocity from the AI's desired motion.
  mob.velocity.x = desiredHoriz.x;
  mob.velocity.z = desiredHoriz.z;

  const vel = mob.velocity;

  // 3) Sub-stepped, axis-separated swept move.
  const maxComponent = Math.max(
    Math.abs(vel.x),
    Math.abs(vel.y),
    Math.abs(vel.z),
  );
  const steps = Math.max(1, Math.ceil(maxComponent / MAX_SUBSTEP));
  const stepVel: Vec3 = {
    x: vel.x / steps,
    y: vel.y / steps,
    z: vel.z / steps,
  };

  let current: Vec3 = { x: mob.feet.x, y: mob.feet.y, z: mob.feet.z };
  let yBlocked = false;

  for (let s = 0; s < steps; s++) {
    // X
    {
      const box = boxFromFeet(current, hw, height);
      const r = resolveAxis(box, "x", stepVel.x, isSolid);
      if (r.collided) mob.velocity.x = 0;
      current = { x: current.x + r.moved, y: current.y, z: current.z };
    }
    // Y
    {
      const box = boxFromFeet(current, hw, height);
      const r = resolveAxis(box, "y", stepVel.y, isSolid);
      if (r.collided) {
        yBlocked = true;
        mob.velocity.y = 0;
      }
      current = { x: current.x, y: current.y + r.moved, z: current.z };
    }
    // Z
    {
      const box = boxFromFeet(current, hw, height);
      const r = resolveAxis(box, "z", stepVel.z, isSolid);
      if (r.collided) mob.velocity.z = 0;
      current = { x: current.x, y: current.y, z: current.z + r.moved };
    }
  }

  // 4) Ground contact.
  const onGround =
    (vel.y < 0 && yBlocked) || restingOnGround(current, hw, height, isSolid);

  mob.feet = current;
  mob.onGround = onGround;
}

/**
 * D5 — auto-jump a 1-block ledge. If the mob is on the ground and its horizontal
 * path is blocked by exactly a 1-block-high step (solid at feet level ahead, air
 * one block above that, and headroom clear above the mob), set the jump velocity
 * and return true. A 2-block (or taller) wall is NOT jumped.
 *
 * `horizDir` only needs a direction; magnitude is ignored.
 */
export function tryStepUp(
  mob: Mob,
  isSolid: SolidQuery,
  horizDir: Vec3,
): boolean {
  if (!mob.onGround) return false;

  const len = Math.hypot(horizDir.x, horizDir.z);
  if (len === 0) return false;

  const stats = MOB_STATS[mob.type];
  const hw = stats.width / 2;
  const height = stats.height;

  // One block ahead in the horizontal direction of travel, just past the
  // mob's leading face.
  const nx = horizDir.x / len;
  const nz = horizDir.z / len;
  const aheadX = mob.feet.x + nx * (hw + 0.5);
  const aheadZ = mob.feet.z + nz * (hw + 0.5);

  const cx = Math.floor(aheadX);
  const cz = Math.floor(aheadZ);
  const feetY = Math.floor(mob.feet.y);

  // The ledge: solid at feet level ahead.
  const ledgeSolid = isSolid(cx, feetY, cz);
  if (!ledgeSolid) return false;

  // Step must be exactly one block: the cell one above the ledge must be air,
  // otherwise it's a 2+ block wall.
  const stepAboveBlocked = isSolid(cx, feetY + 1, cz);
  if (stepAboveBlocked) return false; // 2-block wall → do not jump

  // Headroom: where the mob would land (feetY + 1) plus its body height must be
  // clear so it doesn't jump into a ceiling. Check the column above the landing.
  const landingY = feetY + 1;
  const topCell = Math.floor(landingY + height - EPSILON);
  for (let y = landingY; y <= topCell; y++) {
    if (isSolid(cx, y, cz)) return false;
  }

  mob.velocity.y = PHYSICS.JUMP_VEL;
  return true;
}
