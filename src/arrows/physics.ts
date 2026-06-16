/**
 * physics.ts — PURE per-tick kinematic arrow step (Phase 5).
 *
 * Each tick: apply gravity/drag to velocity, then sweep the arrow from its
 * current position to current+velocity. The swept segment is tested against:
 *   (a) solid voxels via the existing Amanatides-Woo DDA (raycastVoxel), and
 *   (b) every mob AABB via the existing pickMob slab test,
 * and resolves NEAREST-hit precedence (block vs mob). On a block hit the arrow
 * lands at the hit; on a mob hit the arrow is consumed (and the caller deals
 * damage). With no hit the arrow advances the full segment.
 *
 * Reuses raycastVoxel (src/interaction/raycast.ts) and pickMob
 * (src/game/mob-driver.ts) unchanged.
 */

import type { Vec3, Mob } from "../mobs/entity";
import { raycastVoxel, type BlockQuery } from "../interaction/raycast";
import { pickMob } from "../game/mob-driver";
import { ARROW } from "../rules/mc-1.20";

/** What the arrow hit this tick (if anything). */
export type ArrowHit =
  | { kind: "none" }
  | { kind: "block" }
  | { kind: "mob"; mob: Mob; fromXZ: { x: number; z: number } };

/** Distance from `a` to `b`. */
function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/**
 * Advance `arrow` one tick against blocks (via `getBlock`) and `mobs`. Mutates
 * arrow.feet/velocity/age and sets arrow.landed / arrow.hitMob on a hit.
 * Returns what was hit so the caller can apply mob damage / play audio.
 *
 * Block-vs-mob precedence: pickMob is bounded by min(segLen, blockDist), where
 * blockDist is the distance to the hit voxel's CENTER — the same voxel-center
 * approximation blockHitDistance uses elsewhere for melee precedence. The center
 * slightly overestimates the true face-entry distance (by up to ~0.5 blocks), so
 * a mob pressed flush behind a thin wall could rarely be picked "through" it; the
 * arrow is consumed either way, so the practical impact is sub-block cosmetic. No
 * need to export mob-driver's private raySlab.
 */
export function arrowStep(
  arrow: { feet: Vec3; velocity: Vec3; age: number; landed: boolean; hitMob: boolean },
  getBlock: BlockQuery,
  mobs: Mob[],
): ArrowHit {
  arrow.age++;

  // 1) Integrate gravity + drag (mob-style: vy*DRAG - GRAVITY).
  arrow.velocity.x *= ARROW.DRAG;
  arrow.velocity.z *= ARROW.DRAG;
  arrow.velocity.y = arrow.velocity.y * ARROW.DRAG - ARROW.GRAVITY;

  const from: Vec3 = { x: arrow.feet.x, y: arrow.feet.y, z: arrow.feet.z };
  const seg: Vec3 = { x: arrow.velocity.x, y: arrow.velocity.y, z: arrow.velocity.z };
  const segLen = Math.hypot(seg.x, seg.y, seg.z);
  if (segLen === 0) return { kind: "none" };
  // Unit travel direction. Every proven call site (the melee
  // `pickMob(eye, dir, REACH, ...)` / block raycast) passes a UNIT dir + a
  // world-distance, so pass the same convention here: `maxDistance = segLen`
  // is then unambiguously in BLOCKS regardless of how each routine treats |dir|.
  const dir: Vec3 = { x: seg.x / segLen, y: seg.y / segLen, z: seg.z / segLen };

  // 2) Block hit along the segment (DDA clamps to segLen → no tunneling).
  const blockHit = raycastVoxel(from, dir, segLen, getBlock);
  const blockDist =
    blockHit === null
      ? Number.POSITIVE_INFINITY
      : dist(from, {
          x: blockHit.block.x + 0.5,
          y: blockHit.block.y + 0.5,
          z: blockHit.block.z + 0.5,
        });

  // 3) Nearest mob whose AABB the segment enters, within the BLOCK distance (so
  //    a mob behind a wall is not hit). Bound pickMob to min(segLen, blockDist).
  const mobReach = Math.min(segLen, blockDist);
  const mob = pickMob(from, dir, mobReach, mobs);

  if (mob !== null) {
    // Move the arrow to the mob's center plane (visual stick; consumed this tick).
    // fromXZ is the arrow's pre-hit position so the caller knocks the mob ALONG
    // travel (away from where the arrow came from), not in a fixed direction.
    const fromXZ = { x: from.x, z: from.z };
    arrow.feet = { x: mob.feet.x, y: mob.feet.y + 0.5, z: mob.feet.z };
    arrow.hitMob = true;
    arrow.velocity = { x: 0, y: 0, z: 0 };
    return { kind: "mob", mob, fromXZ };
  }

  if (blockHit !== null) {
    // Land at the empty voxel just before the hit (so it sits flush, not inside).
    arrow.feet = {
      x: blockHit.previous.x + 0.5,
      y: blockHit.previous.y + 0.5,
      z: blockHit.previous.z + 0.5,
    };
    arrow.landed = true;
    arrow.velocity = { x: 0, y: 0, z: 0 };
    return { kind: "block" };
  }

  // 4) No hit — advance the full segment.
  arrow.feet = { x: from.x + seg.x, y: from.y + seg.y, z: from.z + seg.z };
  return { kind: "none" };
}
