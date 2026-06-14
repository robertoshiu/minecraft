/**
 * mob-stats.ts — SINGLE SOURCE OF TRUTH for mob types, sizes, stats, and drops.
 *
 * Pure data + types only. No logic, no Babylon. Sizes/stats follow Minecraft
 * 1.20 reference values (hitbox width/height in blocks, speed in blocks/second).
 *
 * This is the keystone for the mob/AI system: downstream AI modules read from
 * here and must NOT redefine these numbers.
 */

import { Items } from "./items";

// ---------------------------------------------------------------------------
// Mob types
// ---------------------------------------------------------------------------

/** Every mob kind in the game. */
export type MobType =
  | "cow"
  | "pig"
  | "sheep"
  | "chicken"
  | "zombie"
  | "skeleton"
  | "creeper";

/** Passive (non-aggressive, breedable) mob types. */
export const PASSIVE_TYPES: readonly MobType[] = [
  "cow",
  "pig",
  "sheep",
  "chicken",
];

/** Hostile (player-attacking) mob types. */
export const HOSTILE_TYPES: readonly MobType[] = [
  "zombie",
  "skeleton",
  "creeper",
];

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/** Per-mob physical + combat properties. */
export interface MobStats {
  /** Hitbox width (and depth) in blocks. */
  width: number;
  /** Hitbox height in blocks. */
  height: number;
  /** Max (and starting) health in half-hearts. */
  maxHealth: number;
  /** Movement speed in blocks/second. */
  speed: number;
  /** Range (blocks) at which a hostile mob notices the player. */
  detectionRange?: number;
  /** Melee/ranged damage dealt to the player in half-hearts. */
  attackDamage?: number;
  /** Range (blocks) within which the mob may attack. */
  attackRangeBlocks?: number;
  /** True iff the mob catches fire in daylight (zombies/skeletons). */
  burnsInSun?: boolean;
}

/** Stats for every {@link MobType}. */
export const MOB_STATS: Record<MobType, MobStats> = {
  cow: { width: 0.9, height: 1.4, maxHealth: 10, speed: 2 },
  pig: { width: 0.9, height: 0.9, maxHealth: 10, speed: 2 },
  sheep: { width: 0.9, height: 1.3, maxHealth: 8, speed: 2 },
  chicken: { width: 0.4, height: 0.7, maxHealth: 4, speed: 2 },
  zombie: {
    width: 0.6,
    height: 1.95,
    maxHealth: 20,
    speed: 2.3,
    detectionRange: 16,
    attackDamage: 3,
    attackRangeBlocks: 1.6,
    burnsInSun: true,
  },
  skeleton: {
    width: 0.6,
    height: 1.99,
    maxHealth: 20,
    speed: 2,
    detectionRange: 16,
    attackDamage: 2,
    attackRangeBlocks: 12,
    burnsInSun: true,
  },
  creeper: {
    width: 0.6,
    height: 1.7,
    maxHealth: 20,
    speed: 2,
    detectionRange: 16,
  },
};

// ---------------------------------------------------------------------------
// Drops
// ---------------------------------------------------------------------------

/** A single drop entry: an item id and the inclusive count range. */
export interface MobDrop {
  item: number;
  min: number;
  max: number;
}

/**
 * Loot dropped on death, per {@link MobType}. Only item ids that actually
 * exist in {@link Items} are used.
 *
 * Hostile mobs drop nothing here: the item registry has no bone / arrow /
 * gunpowder / rotten-flesh ids, so those drops are omitted (see deviations).
 */
export const MOB_DROPS: Record<MobType, MobDrop[]> = {
  cow: [
    { item: Items.LEATHER, min: 0, max: 2 },
    { item: Items.RAW_BEEF, min: 1, max: 3 },
  ],
  pig: [{ item: Items.RAW_PORKCHOP, min: 1, max: 3 }],
  sheep: [{ item: Items.WOOL, min: 1, max: 1 }],
  chicken: [
    { item: Items.FEATHER, min: 0, max: 2 },
    { item: Items.RAW_CHICKEN, min: 1, max: 1 },
  ],
  zombie: [],
  skeleton: [],
  creeper: [],
};
