/**
 * spawn-rules.ts — pure predicates governing where/when mobs spawn and despawn.
 *
 * No state, no Babylon, no Math.random: every function is deterministic given
 * its arguments (the spawn-ring point generator takes an injected RNG so callers
 * own the randomness). All magic numbers originate in the rules module
 * ({@link LIGHT}, {@link MOB_CAP}) — this file only composes them into rules.
 *
 * Spawning is gated on light + time of day + a valid 2-block-tall footprint:
 *  - Hostile mobs spawn at night in darkness (skylight <= HOSTILE_MAX).
 *  - Passive mobs spawn by day on grass in bright light (skylight >= PASSIVE_MIN).
 *
 * Despawning keys off distance + time-far-from-player, with a combat grace
 * window so a mob being fought is never yanked out from under the player.
 */

import type { Mob } from "./entity";
import type { BlockId } from "../rules/mc-1.20";
import { Blocks, MOB_CAP, LIGHT } from "../rules/mc-1.20";

/**
 * Natural surface block types on which passive mobs may spawn.
 * Covers grass, dirt, sand (desert), and snow (snow biome) surfaces.
 */
const PASSIVE_SPAWN_FLOORS: readonly BlockId[] = [
  Blocks.GRASS,
  Blocks.DIRT,
  Blocks.SAND,
  Blocks.SNOW,
] as const;

/** Ticks after taking damage during which a mob is "in combat" and never despawns. */
const COMBAT_GRACE_TICKS = 40;

/** Distance (blocks) beyond which a mob is a despawn candidate. */
export const DESPAWN_DISTANCE = 64;

/** Ticks a mob must remain far from the player before it despawns (30s @ 20 TPS). */
const DESPAWN_FAR_TICKS = 600;

/**
 * True iff a hostile mob may spawn at a candidate cell.
 *
 * Requires night, darkness (`skylight <= LIGHT.HOSTILE_MAX`), a solid floor to
 * stand on, and headroom above for the 2-block-tall body.
 */
export function canSpawnHostileAt(
  skylight: number,
  night: boolean,
  hasFloor: boolean,
  hasHeadroom: boolean,
): boolean {
  return night && skylight <= LIGHT.HOSTILE_MAX && hasFloor && hasHeadroom;
}

/**
 * True iff a passive mob may spawn at a candidate cell.
 *
 * Requires daytime, bright light (`skylight >= LIGHT.PASSIVE_MIN`), a natural
 * surface floor block (grass, dirt, sand, or snow), and headroom above.
 */
export function canSpawnPassiveAt(
  skylight: number,
  night: boolean,
  floorBlock: BlockId,
  hasHeadroom: boolean,
): boolean {
  return (
    !night &&
    skylight >= LIGHT.PASSIVE_MIN &&
    PASSIVE_SPAWN_FLOORS.includes(floorBlock) &&
    hasHeadroom
  );
}

/**
 * True iff `mob` should despawn this tick.
 *
 * U4: a mob damaged within the last {@link COMBAT_GRACE_TICKS} ticks is "in
 * combat" and never despawns, even when far away. Otherwise it despawns once it
 * is both far (`distanceToPlayer > DESPAWN_DISTANCE`) and has been far long
 * enough (`ticksFarFromPlayer >= DESPAWN_FAR_TICKS`).
 */
export function shouldDespawn(
  mob: Mob,
  distanceToPlayer: number,
  ticksFarFromPlayer: number,
  currentTick: number,
): boolean {
  if (currentTick - mob.lastDamageTick < COMBAT_GRACE_TICKS) return false;
  return distanceToPlayer > DESPAWN_DISTANCE && ticksFarFromPlayer >= DESPAWN_FAR_TICKS;
}

/** Inclusive radius band (blocks) around the player in which mobs may spawn. */
export const SPAWN_RADIUS = { min: 16, max: 48 } as const;

/**
 * A horizontal offset from the player landing in the `[SPAWN_RADIUS.min,
 * SPAWN_RADIUS.max]` ring.
 *
 * Deterministic given `rng` (a `() => number` returning `[0, 1)`): the first
 * draw picks an angle, the second picks the radius. The returned `(dx, dz)`
 * always has magnitude within `[min, max]`.
 */
export function randomSpawnOffset(rng: () => number): { dx: number; dz: number } {
  const angle = rng() * Math.PI * 2;
  const radius = SPAWN_RADIUS.min + rng() * (SPAWN_RADIUS.max - SPAWN_RADIUS.min);
  return { dx: Math.cos(angle) * radius, dz: Math.sin(angle) * radius };
}

/** Mob category a spawn cap applies to. */
export type MobKind = "hostile" | "passive";

/**
 * True iff another mob of `kind` may be added without exceeding its cap
 * ({@link MOB_CAP}).
 */
export function canSpawnMore(kind: MobKind, currentCount: number): boolean {
  const cap = kind === "hostile" ? MOB_CAP.HOSTILE : MOB_CAP.PASSIVE;
  return currentCount < cap;
}
