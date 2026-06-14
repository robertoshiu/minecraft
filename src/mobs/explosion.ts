/**
 * explosion.ts — TNT/creeper explosion: radial damage + block destruction.
 *
 * Models a simplified Minecraft-style spherical explosion centered at `center`
 * with a given `power` (creeper = 3, TNT = 4). Two effects:
 *
 *  1. Radial damage to the player and every nearby mob, falling off with
 *     distance from the blast center (see {@link explosionDamageAt}).
 *  2. Block destruction: solid blocks within radius ~`power` are removed
 *     (set to AIR), with BEDROCK surviving (blast-resistant / unbreakable).
 *
 * Knockback is intentionally NOT applied in v1 (see note in {@link explode}).
 *
 * Pure logic — no Babylon imports.
 */

import { Blocks } from "../rules/mc-1.20";
import { isSolid } from "../rules/block-registry";
import type { World } from "../world/world";
import type { Mob, Vec3 } from "./entity";

/** Hooks bridging the explosion to the player (kept out of this layer). */
export interface ExplosionHooks {
  /** Apply `n` half-hearts of damage to the player. */
  damagePlayer: (n: number) => void;
  /** Current player feet/eye reference position in world coords. */
  playerPos: () => Vec3;
}

/** Result of detonating an explosion. */
export interface ExplosionResult {
  /** World coords of every block destroyed (set to AIR) by this blast. */
  destroyed: Vec3[];
}

/** Euclidean distance between two points. */
function dist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Half-hearts of damage dealt at `distance` from a blast of the given `power`.
 *
 * The blast has full effect at the center and fades linearly to zero at the
 * edge of the blast diameter:
 *
 *   impact = max(0, 1 - distance / (2 * power))      // 1 at center, 0 at edge
 *   damage = round((impact^2 + impact) * 3.5 * power)
 *
 * Properties:
 *  - distance 0  → large positive damage.
 *  - distance ≥ 2*power → impact 0 → exactly 0 damage.
 *  - monotonically non-increasing in `distance`.
 */
export function explosionDamageAt(distance: number, power: number): number {
  const impact = Math.max(0, 1 - distance / (2 * power));
  return Math.round((impact * impact + impact) * 3.5 * power);
}

/**
 * Detonate an explosion of `power` at `center` at `currentTick`.
 *
 *  - Damages the player by {@link explosionDamageAt} of the center→player
 *    distance via `hooks.damagePlayer`.
 *  - Damages every mob in `mobs` by {@link explosionDamageAt} of the
 *    center→mob distance via `mob.takeDamage`.
 *  - Destroys solid, non-BEDROCK blocks within a cube of half-extent
 *    `floor(power)` whose center is within the spherical blast radius `power`,
 *    setting each to AIR and collecting its world coords.
 *
 * Knockback is NOT applied in v1: positions/velocities are left untouched and
 * only damage + block destruction occur. (Future work.)
 */
export function explode(
  world: World,
  center: Vec3,
  power: number,
  mobs: Mob[],
  hooks: ExplosionHooks,
  currentTick: number,
): ExplosionResult {
  // --- Entity damage -------------------------------------------------------
  const playerDamage = explosionDamageAt(dist(center, hooks.playerPos()), power);
  if (playerDamage > 0) hooks.damagePlayer(playerDamage);

  for (const mob of mobs) {
    const mobDamage = explosionDamageAt(dist(center, mob.feet), power);
    if (mobDamage > 0) mob.takeDamage(mobDamage, currentTick);
  }

  // --- Block destruction ---------------------------------------------------
  const destroyed: Vec3[] = [];
  const radius = power;
  const reach = Math.floor(power);

  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  const cz = Math.floor(center.z);

  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const bx = cx + dx;
        const by = cy + dy;
        const bz = cz + dz;

        // Spherical cull: block center must be within `radius` of the blast.
        const blockCenter: Vec3 = { x: bx + 0.5, y: by + 0.5, z: bz + 0.5 };
        if (dist(center, blockCenter) > radius) continue;

        const id = world.getBlock(bx, by, bz);
        if (id === Blocks.AIR) continue;
        if (id === Blocks.BEDROCK) continue; // blast-resistant: survives
        if (!isSolid(id)) continue; // skip liquids / non-collidable

        world.setBlock(bx, by, bz, Blocks.AIR);
        destroyed.push({ x: bx, y: by, z: bz });
      }
    }
  }

  return { destroyed };
}
