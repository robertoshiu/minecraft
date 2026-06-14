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
  0: [0.0, 0.0, 0.0], // air_blank — never rendered
  1: [0.5, 0.5, 0.5], // stone — mid gray
  2: [0.45, 0.32, 0.2], // dirt — brown
  3: [0.35, 0.55, 0.2], // grass_top — olive green
  4: [0.42, 0.46, 0.24], // grass_side — brownish-green
  5: [0.85, 0.8, 0.62], // sand — pale tan
  6: [0.18, 0.36, 0.7], // water — blue
  7: [0.45, 0.34, 0.22], // oak_log_side — brown bark
  8: [0.62, 0.5, 0.34], // oak_log_end — lighter end-grain
  9: [0.22, 0.45, 0.16], // oak_leaves — green
  10: [0.66, 0.52, 0.33], // oak_planks — tan wood
  11: [0.42, 0.42, 0.42], // cobblestone — dark gray
  12: [0.75, 0.85, 0.9], // glass — pale blue-white
  13: [0.28, 0.28, 0.3], // coal_ore — stone-gray, dark tint
  14: [0.56, 0.48, 0.42], // iron_ore — stone-gray, tan tint
  15: [0.66, 0.6, 0.32], // gold_ore — stone-gray, yellow tint
  16: [0.6, 0.32, 0.32], // redstone_ore — stone-gray, red tint
  17: [0.4, 0.62, 0.64], // diamond_ore — stone-gray, cyan tint
  18: [0.32, 0.4, 0.62], // lapis_ore — stone-gray, blue tint
  19: [0.12, 0.12, 0.13], // bedrock — near-black
  20: [0.95, 0.96, 0.98], // snow — white
  21: [0.5, 0.48, 0.46], // gravel — speckled gray
  22: [0.6, 0.46, 0.3], // crafting_table_top
  23: [0.66, 0.52, 0.33], // crafting_table_bottom — planks look
  24: [0.58, 0.44, 0.28], // crafting_table_side
  25: [0.36, 0.36, 0.38], // furnace_top — dark stone
  26: [0.4, 0.4, 0.42], // furnace_side
  27: [0.3, 0.3, 0.32], // furnace_front — fire hole, darker
  28: [0.85, 0.65, 0.3], // torch — warm orange
  29: [0.92, 0.85, 0.55], // glowstone — bright yellow
  30: [0.85, 0.35, 0.12], // lava — orange-red
  31: [0.86, 0.86, 0.82], // birch_log_side — pale bark
  32: [0.8, 0.76, 0.6], // birch_log_end
  33: [0.3, 0.5, 0.22], // birch_leaves — green
  34: [0.78, 0.7, 0.5], // birch_planks — pale wood
  35: [0.78, 0.16, 0.18], // bed — warm red
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
