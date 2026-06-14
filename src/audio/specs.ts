/**
 * specs.ts — procedural sound-effect specifications + block→sound mapping.
 *
 * All sounds are described as synthesis parameters; no audio files are loaded.
 * This module is pure data + mapping — no Web Audio, no side effects.
 * Fully testable in Node/Vitest.
 */

import { Blocks, type BlockId } from "../rules/mc-1.20";

// ---------------------------------------------------------------------------
// SfxSpec — describes one synthesised sound
// ---------------------------------------------------------------------------

/**
 * A descriptor for one procedurally-synthesised sound effect.
 *
 * Fields marked optional have sensible defaults in the engine.
 */
export interface SfxSpec {
  /** Synthesis mode: pure noise, a tonal oscillator, or a mix of both. */
  kind: "noise" | "tone" | "mixed";
  /** Total duration of the sound in milliseconds. */
  durationMs: number;
  /** Oscillator frequency in Hz (used by "tone" and "mixed" kinds). */
  freqHz?: number;
  /** Biquad low-pass filter cutoff in Hz applied to the noise component. */
  filterHz?: number;
  /** Attack ramp time in milliseconds (default: ~5 ms). */
  attackMs?: number;
  /** Release ramp time in milliseconds (default: 20% of durationMs). */
  releaseMs?: number;
  /** Peak gain multiplier (default: 1). */
  gain?: number;
  /** True to loop this sound indefinitely (ambient). */
  loop?: boolean;
}

// ---------------------------------------------------------------------------
// SFX catalogue
// ---------------------------------------------------------------------------

/**
 * All named sound effects, keyed by a stable name string.
 * Real CC0 .ogg files can replace each entry later by swapping the engine's
 * synthesis path for a buffer-source loader — the key names stay the same.
 */
export const SFX: Record<string, SfxSpec> = {
  // --- Block break sounds --------------------------------------------------
  /** Stone / cobblestone / ores: short sharp filtered-noise burst. */
  break_stone: {
    kind: "noise",
    durationMs: 150,
    filterHz: 800,
    attackMs: 5,
    releaseMs: 80,
    gain: 0.7,
  },
  /** Dirt: muffled low thump. */
  break_dirt: {
    kind: "noise",
    durationMs: 180,
    filterHz: 400,
    attackMs: 5,
    releaseMs: 100,
    gain: 0.6,
  },
  /** Grass: slightly brighter than dirt, with a leafy rustle character. */
  break_grass: {
    kind: "noise",
    durationMs: 200,
    filterHz: 600,
    attackMs: 5,
    releaseMs: 120,
    gain: 0.55,
  },
  /** Wood (logs / planks / crafting table): warm mid-frequency crack. */
  break_wood: {
    kind: "mixed",
    durationMs: 220,
    freqHz: 180,
    filterHz: 1200,
    attackMs: 5,
    releaseMs: 130,
    gain: 0.65,
  },
  /** Sand / gravel: soft grainy friction. */
  break_sand: {
    kind: "noise",
    durationMs: 160,
    filterHz: 2000,
    attackMs: 5,
    releaseMs: 90,
    gain: 0.5,
  },
  /** Glass: bright high-frequency shatter + quick decay. */
  break_glass: {
    kind: "mixed",
    durationMs: 120,
    freqHz: 2200,
    filterHz: 6000,
    attackMs: 2,
    releaseMs: 80,
    gain: 0.8,
  },

  // --- Block place ---------------------------------------------------------
  /** Generic block placement thud. */
  place_block: {
    kind: "noise",
    durationMs: 100,
    filterHz: 600,
    attackMs: 3,
    releaseMs: 60,
    gain: 0.5,
  },

  // --- Footsteps -----------------------------------------------------------
  /** Footstep on grass: soft low thud. */
  footstep_grass: {
    kind: "noise",
    durationMs: 100,
    filterHz: 300,
    attackMs: 2,
    releaseMs: 60,
    gain: 0.35,
  },
  /** Footstep on stone / hard surfaces: sharper low impact. */
  footstep_stone: {
    kind: "noise",
    durationMs: 80,
    filterHz: 500,
    attackMs: 2,
    releaseMs: 50,
    gain: 0.4,
  },
  /** Footstep on sand: muffled shuffle. */
  footstep_sand: {
    kind: "noise",
    durationMs: 120,
    filterHz: 250,
    attackMs: 3,
    releaseMs: 70,
    gain: 0.3,
  },

  // --- Mob voices ----------------------------------------------------------
  /** Zombie: low descending moan. */
  mob_zombie: {
    kind: "mixed",
    durationMs: 600,
    freqHz: 90,
    filterHz: 400,
    attackMs: 30,
    releaseMs: 200,
    gain: 0.6,
  },
  /** Skeleton: rattling mid-frequency noise burst. */
  mob_skeleton: {
    kind: "noise",
    durationMs: 400,
    filterHz: 1500,
    attackMs: 10,
    releaseMs: 150,
    gain: 0.55,
  },
  /** Cow: low tonal moo. */
  mob_cow: {
    kind: "tone",
    durationMs: 700,
    freqHz: 130,
    attackMs: 40,
    releaseMs: 250,
    gain: 0.5,
  },
  /** Pig: high-pitched oink. */
  mob_pig: {
    kind: "tone",
    durationMs: 300,
    freqHz: 400,
    attackMs: 10,
    releaseMs: 120,
    gain: 0.45,
  },
  /** Sheep: baa — mid-tonal bleat. */
  mob_sheep: {
    kind: "tone",
    durationMs: 500,
    freqHz: 280,
    attackMs: 20,
    releaseMs: 180,
    gain: 0.45,
  },
  /** Chicken: clucking high peep. */
  mob_chicken: {
    kind: "tone",
    durationMs: 200,
    freqHz: 600,
    attackMs: 5,
    releaseMs: 80,
    gain: 0.4,
  },
  /** Creeper hiss: rising filtered noise (the fuse). */
  mob_creeper_hiss: {
    kind: "noise",
    durationMs: 1500,
    filterHz: 3000,
    attackMs: 50,
    releaseMs: 400,
    gain: 0.7,
  },

  // --- Generic mob hurt / death --------------------------------------------
  /** Generic hurt grunt: short tonal thud. */
  mob_hurt: {
    kind: "mixed",
    durationMs: 180,
    freqHz: 200,
    filterHz: 800,
    attackMs: 3,
    releaseMs: 100,
    gain: 0.6,
  },
  /** Generic death: descending low tone. */
  mob_death: {
    kind: "mixed",
    durationMs: 500,
    freqHz: 110,
    filterHz: 600,
    attackMs: 5,
    releaseMs: 300,
    gain: 0.65,
  },

  // --- Explosion -----------------------------------------------------------
  /** Creeper/TNT explosion: loud low-frequency noise burst with long tail. */
  explosion: {
    kind: "noise",
    durationMs: 800,
    filterHz: 250,
    attackMs: 2,
    releaseMs: 500,
    gain: 1.0,
  },

  // --- Ambient -------------------------------------------------------------
  /** Ambient wind: gentle looping low-pass noise. */
  ambient_wind: {
    kind: "noise",
    durationMs: 4000,
    filterHz: 150,
    attackMs: 500,
    releaseMs: 800,
    gain: 0.18,
    loop: true,
  },
} as const;

// ---------------------------------------------------------------------------
// Block → sound mapping helpers
// ---------------------------------------------------------------------------

/** Material group used for audio routing. */
type MaterialGroup =
  | "stone"
  | "dirt"
  | "grass"
  | "wood"
  | "sand"
  | "glass"
  | "generic";

/**
 * Classify a block id into an audio material group.
 * Returns "generic" for unmapped blocks (falls back to break_stone audio).
 */
function materialGroup(blockId: number): MaterialGroup {
  switch (blockId as BlockId) {
    case Blocks.STONE:
    case Blocks.COBBLESTONE:
    case Blocks.COAL_ORE:
    case Blocks.IRON_ORE:
    case Blocks.GOLD_ORE:
    case Blocks.REDSTONE_ORE:
    case Blocks.DIAMOND_ORE:
    case Blocks.LAPIS_ORE:
    case Blocks.BEDROCK:
    case Blocks.GRAVEL:
    case Blocks.GLOWSTONE:
    case Blocks.FURNACE:
      return "stone";

    case Blocks.DIRT:
      return "dirt";

    case Blocks.GRASS:
    case Blocks.SNOW:
    case Blocks.OAK_LEAVES:
    case Blocks.BIRCH_LEAVES:
      return "grass";

    case Blocks.OAK_LOG:
    case Blocks.OAK_PLANKS:
    case Blocks.CRAFTING_TABLE:
    case Blocks.BIRCH_LOG:
    case Blocks.BIRCH_PLANKS:
    case Blocks.TORCH:
      return "wood";

    case Blocks.SAND:
      return "sand";

    case Blocks.GLASS:
      return "glass";

    default:
      return "generic";
  }
}

/**
 * Returns the SFX key for breaking a block with the given id.
 *
 * @param blockId  Numeric block id.
 * @returns        A key present in {@link SFX}.
 */
export function blockBreakSound(blockId: number): string {
  const group = materialGroup(blockId);
  switch (group) {
    case "stone":
      return "break_stone";
    case "dirt":
      return "break_dirt";
    case "grass":
      return "break_grass";
    case "wood":
      return "break_wood";
    case "sand":
      return "break_sand";
    case "glass":
      return "break_glass";
    default:
      return "break_stone";
  }
}

/**
 * Returns the SFX key for placing any block.
 */
export function placeSound(): string {
  return "place_block";
}

/**
 * Returns the SFX key for a footstep on the given block.
 *
 * @param blockId  The block the player is walking on (the block underfoot).
 * @returns        A key present in {@link SFX}.
 */
export function footstepSound(blockId: number): string {
  const group = materialGroup(blockId);
  switch (group) {
    case "grass":
      return "footstep_grass";
    case "sand":
      return "footstep_sand";
    case "stone":
    case "wood":
    case "glass":
    case "generic":
    default:
      return "footstep_stone";
  }
}
