/**
 * physics.ts — PURE per-tick splash-potion step (Phase 6b). Cloned from
 * arrowStep's gravity/drag/DDA sweep, but a block OR mob hit means BURST (the
 * caller applies the AoE this tick, then despawns). Reuses raycastVoxel +
 * pickMob unchanged.
 */

import type { Vec3, Mob } from "../mobs/entity";
import { raycastVoxel, type BlockQuery } from "../interaction/raycast";
import { pickMob } from "../game/mob-driver";
import { SPLASH } from "../rules/mc-1.20";

/** What the splash potion did this tick. */
export type SplashHit = { kind: "none" } | { kind: "burst"; at: Vec3 };

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/**
 * Advance `potion` one tick against blocks + mobs. On a block or mob hit, sets
 * potion.burst and returns { kind: "burst", at } with the burst center. With no
 * hit, advances the full segment.
 */
export function splashPotionStep(
  potion: { feet: Vec3; velocity: Vec3; age: number; burst: boolean },
  getBlock: BlockQuery,
  mobs: Mob[],
): SplashHit {
  potion.age++;
  potion.velocity.x *= SPLASH.DRAG;
  potion.velocity.z *= SPLASH.DRAG;
  potion.velocity.y = potion.velocity.y * SPLASH.DRAG - SPLASH.GRAVITY;

  const from: Vec3 = { x: potion.feet.x, y: potion.feet.y, z: potion.feet.z };
  const seg: Vec3 = { x: potion.velocity.x, y: potion.velocity.y, z: potion.velocity.z };
  const segLen = Math.hypot(seg.x, seg.y, seg.z);
  if (segLen === 0) return { kind: "none" };
  const dir: Vec3 = { x: seg.x / segLen, y: seg.y / segLen, z: seg.z / segLen };

  const blockHit = raycastVoxel(from, dir, segLen, getBlock);
  const blockDist =
    blockHit === null
      ? Number.POSITIVE_INFINITY
      : dist(from, {
          x: blockHit.block.x + 0.5,
          y: blockHit.block.y + 0.5,
          z: blockHit.block.z + 0.5,
        });
  const mob = pickMob(from, dir, Math.min(segLen, blockDist), mobs);

  if (mob !== null) {
    const at: Vec3 = { x: mob.feet.x, y: mob.feet.y + 0.5, z: mob.feet.z };
    potion.feet = at;
    potion.burst = true;
    potion.velocity = { x: 0, y: 0, z: 0 };
    return { kind: "burst", at };
  }
  if (blockHit !== null) {
    const at: Vec3 = {
      x: blockHit.previous.x + 0.5,
      y: blockHit.previous.y + 0.5,
      z: blockHit.previous.z + 0.5,
    };
    potion.feet = at;
    potion.burst = true;
    potion.velocity = { x: 0, y: 0, z: 0 };
    return { kind: "burst", at };
  }

  potion.feet = { x: from.x + seg.x, y: from.y + seg.y, z: from.z + seg.z };
  return { kind: "none" };
}
