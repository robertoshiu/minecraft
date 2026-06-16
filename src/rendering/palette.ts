/**
 * palette.ts — atlas-tile-index → vertex color mapping (robust v1 renderer).
 *
 * Until a real texture atlas + PBR shader lands, the terrain is rendered with
 * flat per-vertex colors: each greedy-mesher quad carries its tile index, and
 * we color every vertex by the natural color of that tile here. This sidesteps
 * all atlas/shader-plugin risk and is guaranteed to render.
 *
 * The tile-index → texture mapping is documented in `src/rules/block-registry.ts`
 * (indices 0..34). The colors below are believable approximations of those
 * textures; ores are stone-gray tinted toward their mineral.
 *
 * Pure data + a tiny accessor. No Babylon imports.
 */

/** An RGB triple, each component in [0, 1]. */
export type RGB = [number, number, number];

/**
 * Per-tile-index colors. Index matches the atlas mapping table in
 * `block-registry.ts`. Indices not present here fall back to {@link FALLBACK}.
 */
const TILE_COLORS: Readonly<Record<number, RGB>> = {
  0:  [0.0,  0.0,  0.0 ], // air_blank — never rendered
  1:  [0.54, 0.52, 0.48], // stone — warm grey
  2:  [0.52, 0.34, 0.18], // dirt — richer warm brown
  3:  [0.38, 0.58, 0.16], // grass_top — vivid warm yellow-green
  4:  [0.46, 0.48, 0.20], // grass_side — warmer brownish-green
  5:  [0.90, 0.84, 0.60], // sand — richer warm tan
  6:  [0.16, 0.38, 0.72], // water — slightly richer blue
  7:  [0.50, 0.36, 0.20], // oak_log_side — richer warm bark
  8:  [0.68, 0.54, 0.32], // oak_log_end — warmer end-grain
  9:  [0.24, 0.48, 0.14], // oak_leaves — vivid green
  10: [0.72, 0.56, 0.30], // oak_planks — richer warm tan wood
  11: [0.46, 0.44, 0.40], // cobblestone — warm dark grey
  12: [0.78, 0.86, 0.90], // glass — pale blue-white
  13: [0.30, 0.28, 0.26], // coal_ore — warm dark
  14: [0.60, 0.50, 0.40], // iron_ore — warm tan
  15: [0.70, 0.64, 0.28], // gold_ore — richer yellow
  16: [0.64, 0.28, 0.28], // redstone_ore — deeper red
  17: [0.36, 0.64, 0.66], // diamond_ore — vivid cyan
  18: [0.28, 0.38, 0.66], // lapis_ore — deeper blue
  19: [0.12, 0.12, 0.13], // bedrock — near-black
  20: [0.94, 0.96, 0.98], // snow — white
  21: [0.54, 0.50, 0.46], // gravel — warm speckled grey
  22: [0.64, 0.48, 0.28], // crafting_table_top — warmer
  23: [0.70, 0.56, 0.30], // crafting_table_bottom — planks
  24: [0.62, 0.46, 0.24], // crafting_table_side — warmer
  25: [0.38, 0.36, 0.34], // furnace_top — warm dark stone
  26: [0.44, 0.42, 0.38], // furnace_side — warm stone
  27: [0.30, 0.28, 0.26], // furnace_front — darker warm
  28: [0.90, 0.68, 0.28], // torch — richer warm orange
  29: [0.94, 0.88, 0.52], // glowstone — rich yellow
  30: [0.88, 0.32, 0.10], // lava — vivid orange-red
  31: [0.88, 0.86, 0.80], // birch_log_side — warm pale bark
  32: [0.84, 0.78, 0.58], // birch_log_end — warmer
  33: [0.28, 0.52, 0.18], // birch_leaves — vivid green
  34: [0.82, 0.74, 0.48], // birch_planks — richer warm pale wood
  35: [0.82, 0.14, 0.16], // bed — vivid warm red
  36: [0.34, 0.30, 0.26], // brewing_stand — dark stone-brown (blaze-rod stand)
};

/** Fallback color for unknown tile indices (magenta-ish, easy to spot). */
const FALLBACK: RGB = [0.8, 0.2, 0.8];

/**
 * Map an atlas tile index to a natural RGB color (each component in [0, 1]).
 * Unknown indices return a distinct {@link FALLBACK} color. The returned array
 * is a fresh copy so callers may mutate it freely.
 */
export function tileColor(tileIndex: number): RGB {
  const c = TILE_COLORS[tileIndex];
  if (c === undefined) return [...FALLBACK];
  return [...c];
}
