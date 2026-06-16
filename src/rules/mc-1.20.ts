/**
 * mc-1.20.ts — SINGLE SOURCE OF TRUTH for game constants (Minecraft 1.20 reference).
 *
 * Pure data + types only. No logic, no imports from Babylon or anywhere else.
 * Every magic number in the game must originate here.
 */

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export const Blocks = {
  AIR: 0,
  STONE: 1,
  DIRT: 2,
  GRASS: 3,
  SAND: 4,
  WATER: 5,
  OAK_LOG: 6,
  OAK_LEAVES: 7,
  OAK_PLANKS: 8,
  COBBLESTONE: 9,
  GLASS: 10,
  COAL_ORE: 11,
  IRON_ORE: 12,
  GOLD_ORE: 13,
  REDSTONE_ORE: 14,
  DIAMOND_ORE: 15,
  LAPIS_ORE: 16,
  BEDROCK: 17,
  SNOW: 18,
  GRAVEL: 19,
  CRAFTING_TABLE: 20,
  FURNACE: 21,
  TORCH: 22,
  GLOWSTONE: 23,
  LAVA: 24,
  BIRCH_LOG: 25,
  BIRCH_LEAVES: 26,
  BIRCH_PLANKS: 27,
  BED: 28,
  BREWING_STAND: 29,
} as const;

/** A numeric block identifier (one of the values in {@link Blocks}). */
export type BlockId = (typeof Blocks)[keyof typeof Blocks];

// ---------------------------------------------------------------------------
// Physics (values in blocks/tick or blocks/second as noted)
// ---------------------------------------------------------------------------

export const PHYSICS = {
  /** Initial upward velocity on jump (blocks/tick). */
  JUMP_VEL: 0.42,
  /** Downward acceleration per tick (blocks/tick^2). */
  GRAVITY: 0.08,
  /** Per-tick vertical velocity multiplier (air drag). */
  DRAG: 0.98,
  /** Maximum (most-negative) fall velocity (blocks/tick). */
  TERMINAL_VEL: -3.92,
  /** Walking speed (blocks/second). */
  WALK_SPEED: 4.317,
  /** Sprinting speed (blocks/second). */
  SPRINT_SPEED: 5.612,
  /** Sneaking speed (blocks/second). */
  CROUCH_SPEED: 1.295,
  /** Minimum ticks between jumps. */
  JUMP_COOLDOWN_TICKS: 10,
} as const;

export const FALL = {
  /** Blocks of fall that incur no damage. */
  SAFE_BLOCKS: 3,
  /** Half-hearts of damage per block fallen beyond the safe threshold. */
  DAMAGE_PER_BLOCK: 1,
} as const;

export const TICKS_PER_SECOND = 20 as const;

// ---------------------------------------------------------------------------
// Time / day-night cycle (in game ticks)
// ---------------------------------------------------------------------------

export const TIME = {
  TICKS_PER_DAY: 24000,
  DAY_START: 0,
  SUNSET_START: 12000,
  NIGHT_START: 13000,
  SUNRISE_START: 23000,
  /** Wall-clock seconds the full day cycle takes (1200s = 20 min). */
  REAL_SECONDS_PER_DAY: 1200,
} as const;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export type ToolTier = "wood" | "stone" | "iron" | "diamond" | "gold" | "none";

export const TOOL_TIER_MULTIPLIER: Record<ToolTier, number> = {
  none: 1,
  wood: 2,
  stone: 4,
  iron: 6,
  diamond: 8,
  gold: 12,
};

/** Durability (uses) per tool tier. `none` (hand) is not a tool and is omitted. */
export const TOOL_DURABILITY: Record<Exclude<ToolTier, "none">, number> = {
  wood: 59,
  stone: 131,
  iron: 250,
  diamond: 1561,
  gold: 32,
};

// ---------------------------------------------------------------------------
// Armor (MC 1.20 canonical defense points + per-slot durability)
// ---------------------------------------------------------------------------

/** Armor material tiers. NOTE: distinct from ToolTier (no stone armor). */
export type ArmorTier = "leather" | "iron" | "diamond" | "gold";
/** The four armor slots. */
export type ArmorSlot = "helmet" | "chestplate" | "leggings" | "boots";

/** Defense points (armor points) per tier × slot. Each point ≈ 4% reduction. */
export const ARMOR_DEFENSE: Record<ArmorTier, Record<ArmorSlot, number>> = {
  leather: { helmet: 1, chestplate: 3, leggings: 2, boots: 1 },
  iron: { helmet: 2, chestplate: 6, leggings: 5, boots: 2 },
  diamond: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 },
  gold: { helmet: 2, chestplate: 5, leggings: 3, boots: 1 },
};

/** Durability (hits absorbed) per tier × slot. */
export const ARMOR_DURABILITY: Record<ArmorTier, Record<ArmorSlot, number>> = {
  leather: { helmet: 55, chestplate: 80, leggings: 75, boots: 65 },
  iron: { helmet: 165, chestplate: 240, leggings: 225, boots: 195 },
  diamond: { helmet: 363, chestplate: 528, leggings: 495, boots: 429 },
  gold: { helmet: 77, chestplate: 112, leggings: 105, boots: 91 },
};

/** Damage reduction contributed per defense point (4%). */
export const ARMOR_REDUCTION_PER_POINT = 0.04;
/** Hard cap on total armor reduction (80%). */
export const ARMOR_MAX_REDUCTION = 0.8;

// ---------------------------------------------------------------------------
// Ore generation
// ---------------------------------------------------------------------------

export interface OreEntry {
  readonly block: BlockId;
  readonly minY: number;
  readonly maxY: number;
  readonly bestY: number;
  readonly veinSize: number;
  readonly veinsPerChunk: number;
  readonly toolTier: ToolTier;
}

export const ORE_TABLE: readonly OreEntry[] = [
  {
    block: Blocks.COAL_ORE,
    minY: 0,
    maxY: 128,
    bestY: 64,
    veinSize: 17,
    veinsPerChunk: 20,
    toolTier: "wood",
  },
  {
    block: Blocks.IRON_ORE,
    minY: 0,
    maxY: 64,
    bestY: 32,
    veinSize: 9,
    veinsPerChunk: 10,
    toolTier: "stone",
  },
  {
    block: Blocks.GOLD_ORE,
    minY: 0,
    maxY: 32,
    bestY: 16,
    veinSize: 9,
    veinsPerChunk: 4,
    toolTier: "iron",
  },
  {
    block: Blocks.REDSTONE_ORE,
    minY: 0,
    maxY: 16,
    bestY: 8,
    veinSize: 8,
    veinsPerChunk: 8,
    toolTier: "iron",
  },
  {
    block: Blocks.DIAMOND_ORE,
    minY: 0,
    maxY: 16,
    bestY: 4,
    veinSize: 4,
    veinsPerChunk: 7,
    toolTier: "iron",
  },
  {
    block: Blocks.LAPIS_ORE,
    minY: 0,
    maxY: 32,
    bestY: 16,
    veinSize: 7,
    veinsPerChunk: 2,
    toolTier: "stone",
  },
] as const;

// ---------------------------------------------------------------------------
// Block hardness (seconds to break by hand at multiplier 1). Infinity = unbreakable.
// ---------------------------------------------------------------------------

export const BLOCK_HARDNESS: Partial<Record<BlockId, number>> = {
  [Blocks.DIRT]: 0.5,
  [Blocks.GRASS]: 0.5,
  [Blocks.SAND]: 0.5,
  [Blocks.STONE]: 1.5,
  [Blocks.COBBLESTONE]: 1.5,
  [Blocks.OAK_LOG]: 2,
  [Blocks.OAK_PLANKS]: 2,
  [Blocks.COAL_ORE]: 3,
  [Blocks.IRON_ORE]: 3,
  [Blocks.GOLD_ORE]: 3,
  [Blocks.REDSTONE_ORE]: 3,
  [Blocks.DIAMOND_ORE]: 3,
  [Blocks.LAPIS_ORE]: 3,
  [Blocks.GLASS]: 0.3,
  [Blocks.BEDROCK]: Infinity,
  [Blocks.OAK_LEAVES]: 0.2,
  [Blocks.BREWING_STAND]: 0.5,
};

// ---------------------------------------------------------------------------
// Hunger / saturation / exhaustion
// ---------------------------------------------------------------------------

export const HUNGER = {
  MAX_FOOD: 20,
  MAX_SATURATION: 20,
  MAX_EXHAUSTION: 4,
  /** Food level at/above which natural regen begins. */
  REGEN_FOOD_THRESHOLD: 18,
  /** Food level below which sprinting is disabled. */
  SPRINT_DISABLE_FOOD: 6,
  /** Ticks between regen ticks while well-fed. */
  REGEN_INTERVAL_TICKS: 80,
  /** Exhaustion added per heart regenerated. */
  REGEN_EXHAUSTION_COST: 6,
  /** Ticks between starvation damage ticks at 0 food. */
  STARVE_INTERVAL_TICKS: 80,
} as const;

export const EXHAUSTION = {
  SPRINT_PER_M: 0.1,
  JUMP: 0.05,
  SPRINT_JUMP: 0.2,
  BREAK_BLOCK: 0.005,
  ATTACK: 0.1,
  TAKE_DAMAGE: 0.1,
} as const;

export interface FoodValue {
  readonly hunger: number;
  readonly saturation: number;
}

export const FOOD_VALUES: Record<string, FoodValue> = {
  steak: { hunger: 8, saturation: 12.8 },
  bread: { hunger: 5, saturation: 6 },
  apple: { hunger: 4, saturation: 2.4 },
  cooked_porkchop: { hunger: 8, saturation: 12.8 },
  cooked_chicken: { hunger: 6, saturation: 7.2 },
};

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const HEALTH = {
  MAX: 20,
} as const;

// ---------------------------------------------------------------------------
// Smelting / fuel (fuel values in items-smelted; 1 coal = 8 items).
// ---------------------------------------------------------------------------

export const SMELT = {
  TICKS_PER_ITEM: 200,
} as const;

// ---------------------------------------------------------------------------
// Fire / lava damage-over-time (Phase 6b)
// ---------------------------------------------------------------------------

/** Lava/fire burning damage-over-time tuning (20 TPS). */
export const FIRE = {
  /** Ticks of burning set/refreshed each tick the player is in/on lava. */
  IGNITE_TICKS: 30,
  /** Half-hearts dealt per fire-damage interval. */
  DAMAGE: 1,
  /**
   * Ticks between fire-damage applications. MUST be >= the 10-tick i-frame
   * window (combat/iframes) or the periodic fire hit is swallowed by i-frames.
   * 10 → 1 dmg every 10 ticks ≈ 2 HP/s, matching MC lava.
   */
  DAMAGE_INTERVAL: 10,
} as const;

// ---------------------------------------------------------------------------
// Brewing (Phase 6b)
// ---------------------------------------------------------------------------

/** Brewing-stand tuning (20 TPS). */
export const BREW = {
  /** Ticks to complete one brew (20 s — slower than smelting, MC-flavored). */
  TICKS_PER_BREW: 400,
  /** Brews one unit of blaze powder fuels (MC: 20). */
  BREWS_PER_BLAZE_POWDER: 20,
} as const;

export const FUEL_VALUES: Record<string, number> = {
  coal: 8,
  coal_block: 80,
  lava_bucket: 100,
  oak_planks: 1.5,
  stick: 0.5,
  oak_log: 1.5,
};

// ---------------------------------------------------------------------------
// Mob spawning
// ---------------------------------------------------------------------------

export const MOB_CAP = {
  HOSTILE: 10,
  PASSIVE: 10,
} as const;

/**
 * Uniform scale applied to a BABY mob's hitbox AND its render root (Phase 6c).
 * 0.5 mirrors Minecraft's ~half-size babies. Read off mob.extra["babyScale"]
 * (default 1.0 = adult) by both Mob.aabb()/physics (hitbox) and the renderer
 * (visual). Stored in the open `extra` map so it persists with no MobSave
 * schema change and no SAVE_VERSION bump.
 */
export const BABY_SCALE = 0.5;

// ---------------------------------------------------------------------------
// Status effects (Phase 5). Durations/intervals in TICKS (20 TPS).
// ---------------------------------------------------------------------------

/** Per-effect tuning. Durations are total ticks; intervals gate periodic ticks. */
export const EFFECT_TUNING = {
  /** Default potion duration for non-instant effects (ticks). 45 s. */
  DEFAULT_DURATION: 900,
  /** Regeneration heals 1 HP every this many ticks (Regen I). Higher amplifier is faster. */
  REGEN_INTERVAL: 50,
  /** Regen interval shrinks by this many ticks per amplifier level above 0 (min 10). */
  REGEN_INTERVAL_PER_AMP: 25,
  /** Poison deals 1 HP every this many ticks (Poison I). */
  POISON_INTERVAL: 25,
  /** Poison interval shrinks by this many ticks per amplifier level above 0 (min 5). */
  POISON_INTERVAL_PER_AMP: 12,
  /** Instant Health restores this many HP per (amplifier+1). */
  INSTANT_HEALTH_PER_LEVEL: 6,
  /** Instant Damage deals this many HP per (amplifier+1). */
  INSTANT_DAMAGE_PER_LEVEL: 6,
  /** Resistance reduces post-armor damage by this fraction per (amplifier+1). 4 levels → 80%. */
  RESISTANCE_PER_LEVEL: 0.2,
  /** Strength adds this many half-hearts to melee per (amplifier+1). */
  STRENGTH_PER_LEVEL: 3,
  /** Swiftness multiplies move speed by (1 + this × (amplifier+1)). */
  SWIFTNESS_PER_LEVEL: 0.2,
} as const;

/** Max simultaneous in-flight arrows (pooled/capped). */
export const ARROW_CAP = 16 as const;

/** Bow/arrow ballistics (blocks/tick at 20 TPS). */
export const ARROW = {
  /** Launch speed at full charge (blocks/tick). ~3 b/tick ≈ 60 b/s. */
  MAX_SPEED: 3.0,
  /** Launch speed at zero charge (a limp release still leaves the bow). */
  MIN_SPEED: 0.6,
  /** Milliseconds of hold to reach full charge. */
  FULL_CHARGE_MS: 1000,
  /** Per-tick gravity applied to vy (matches mob integration: vy*DRAG - GRAVITY). */
  GRAVITY: 0.05,
  /** Per-tick air drag multiplier on velocity (slight). */
  DRAG: 0.99,
  /** Arrow half-extent for the swept AABB / render box (blocks). */
  WIDTH: 0.1,
  /** Arrow length along travel (render only). */
  LENGTH: 0.5,
  /** Damage a fully-charged arrow deals to a mob (half-hearts). */
  DAMAGE: 6,
  /** Ticks an arrow may fly before auto-despawn (safety cap). 30 s. */
  MAX_AGE: 600,
  /** Distance past the shooter eye to spawn the arrow (clear the body). */
  SPAWN_OFFSET: 0.5,
} as const;

/** Max simultaneous in-flight splash potions (pooled/capped; separate from arrows). */
export const SPLASH_POTION_CAP = 8 as const;

/** Splash-potion ballistics + burst (blocks/tick at 20 TPS). */
export const SPLASH = {
  /** Throw speed (blocks/tick). Slower + heavier-arced than an arrow. */
  SPEED: 1.2,
  /** Per-tick gravity on vy. */
  GRAVITY: 0.05,
  /** Per-tick air drag multiplier. */
  DRAG: 0.99,
  /** Spawn offset past the eye so it clears the body. */
  SPAWN_OFFSET: 0.5,
  /** AoE radius (blocks) of the burst effect/damage. */
  RADIUS: 4,
  /** Instant-damage half-hearts dealt to mobs in range on burst (splash harm). */
  MOB_DAMAGE: 4,
  /** Ticks a splash potion may fly before auto-despawn. */
  MAX_AGE: 200,
} as const;

export const LIGHT = {
  /** Max light level at which hostile mobs may spawn. */
  HOSTILE_MAX: 7,
  /** Min light level required for passive mob spawns. */
  PASSIVE_MIN: 9,
  /** Maximum sky light level. */
  SKY_MAX: 15,
} as const;

// ---------------------------------------------------------------------------
// World / chunk dimensions
// ---------------------------------------------------------------------------

export const CHUNK = {
  /** Horizontal chunk extent in blocks (x and z). */
  SIZE: 16,
  /** Vertical world extent in blocks. */
  HEIGHT: 256,
} as const;
