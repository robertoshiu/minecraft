/**
 * atlas.ts — PURE, Babylon-free procedural texture atlas generator.
 *
 * Generates a single 1024×1024 RGBA Uint8Array covering a 16×16 grid of 64×64
 * tile cells. Each tile corresponds to an atlas index used by the block registry
 * (see src/rules/block-registry.ts for the documented index mapping).
 *
 * Key design decisions:
 *  - NO randomness, NO wall-clock. All procedural detail uses integer hashes of
 *    (tileIndex, x, y) so output is deterministic across runs and environments.
 *  - 2-pixel edge dilation per tile prevents mipmap bleed across tile boundaries.
 *  - Unused tiles (indices 35..255) are filled with a recognisable magenta debug
 *    color so a wrong index is immediately visible in-game.
 *
 * Row-major layout: index = row*16 + col (matching the registry mapping).
 */

import { tileColor, type RGB } from "./palette";

/** Number of tiles per row/column of the atlas grid. */
export const ATLAS_GRID = 16;
/** Pixel size of one tile cell. */
export const TILE_PX = 64;
/** Total atlas pixel size (ATLAS_GRID * TILE_PX). */
export const ATLAS_PX = 1024;

/** Column of a tile in the 16×16 atlas grid (0..15). */
export function tileCol(index: number): number {
  return index % ATLAS_GRID;
}

/** Row of a tile in the 16×16 atlas grid (0..15). */
export function tileRow(index: number): number {
  return Math.floor(index / ATLAS_GRID);
}

// ---------------------------------------------------------------------------
// Deterministic integer hash (no randomness, no wall-clock).
// ---------------------------------------------------------------------------

/**
 * A fast, deterministic integer hash of three inputs. Returns a value in
 * [0, 2^31) suitable for driving procedural detail.
 */
function hash3(a: number, b: number, c: number): number {
  // Wang hash-style mixing — no floating-point, purely integer.
  let h = (a * 1664525 + 1013904223) | 0;
  h = (h ^ b) * 1664525 + 1013904223;
  h = (h ^ c) * 1664525 + 1013904223;
  return h & 0x7fffffff; // mask to positive int
}

/**
 * Map a hash value to a float in [0, 1).
 */
function hashF(a: number, b: number, c: number): number {
  return hash3(a, b, c) / 0x80000000;
}

// ---------------------------------------------------------------------------
// Tile-type classification helpers
// ---------------------------------------------------------------------------

/** Tile indices that should receive speckle noise (stone-like). */
const SPECKLE_TILES = new Set<number>([
  1,  // stone
  2,  // dirt
  5,  // sand
  11, // cobblestone
  13, // coal_ore
  14, // iron_ore
  15, // gold_ore
  16, // redstone_ore
  17, // diamond_ore
  18, // lapis_ore
  19, // bedrock
  21, // gravel
]);

/** Tile indices that should have wood-grain vertical streaks. */
const WOOD_TILES = new Set<number>([
  7,  // oak_log_side
  8,  // oak_log_end
  10, // oak_planks
  22, // crafting_table_top
  23, // crafting_table_bottom
  24, // crafting_table_side
  31, // birch_log_side
  32, // birch_log_end
  34, // birch_planks
]);

/** Tile indices that should have a dappled leaf pattern. */
const LEAF_TILES = new Set<number>([
  9,  // oak_leaves
  33, // birch_leaves
]);

/** Number of distinct tile indices used by the block registry. */
const MAX_USED_TILE = 35;

// ---------------------------------------------------------------------------
// Per-texel detail computation
// ---------------------------------------------------------------------------

/**
 * Compute the brightness modifier (in [-1, 1]) for a texel at (px, py)
 * within a tile of the given `index`. The modifier is scaled to ±8% so the
 * base color is always clearly visible.
 */
function texelDetail(index: number, px: number, py: number): number {
  if (SPECKLE_TILES.has(index)) {
    // Random per-texel speckle: ±8% brightness variation.
    const n = hashF(index, px, py);
    return (n - 0.5) * 0.16; // maps [0,1) → [-0.08, +0.08)
  }

  if (WOOD_TILES.has(index)) {
    // Vertical grain streaks: vary brightness smoothly by column.
    // Use two harmonics to give an organic look.
    const grain1 = hashF(index, px, 0) * 0.06; // per-column base offset
    const grain2 = hashF(index, px, 1) * 0.04; // finer per-column modulation
    const rowVar = hashF(index, px, py) * 0.02; // tiny per-texel noise
    return grain1 + grain2 + rowVar - 0.06; // center around 0
  }

  if (LEAF_TILES.has(index)) {
    // Dappled pattern: alternating lighter/darker blobs using a 2D hash of
    // a coarser grid position. 4×4 pixel "dapple cells".
    const cx = (px >> 2) & 0xff;
    const cy = (py >> 2) & 0xff;
    const dapple = hashF(index, cx * 17 + cy, 42);
    const micro = hashF(index, px, py) * 0.03;
    return (dapple - 0.5) * 0.14 + micro;
  }

  // All other tiles (grass, water, snow, glass, lava, torch, glowstone, etc.)
  // get a very subtle ±2% per-texel variation so they don't look completely flat.
  return (hashF(index, px, py) - 0.5) * 0.04;
}

// ---------------------------------------------------------------------------
// Atlas generation
// ---------------------------------------------------------------------------

/** Debug magenta fill for unused tile slots (easy to spot if a wrong index appears). */
const DEBUG_MAGENTA: RGB = [0.8, 0.2, 0.8];

/**
 * Clamp a value into [0, 1].
 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Generate the full 1024×1024 RGBA atlas as a Uint8Array (length = ATLAS_PX *
 * ATLAS_PX * 4 = 4 194 304 bytes). Deterministic — same output on every call.
 *
 * Tile cell layout: tile `index` occupies pixels [cellX..cellX+TILE_PX) ×
 * [cellY..cellY+TILE_PX) where cellX = tileCol(index)*TILE_PX and cellY =
 * tileRow(index)*TILE_PX.
 */
export function generateAtlasRGBA(): Uint8Array {
  const out = new Uint8Array(ATLAS_PX * ATLAS_PX * 4);

  // Fill every tile slot.
  for (let tileIdx = 0; tileIdx < ATLAS_GRID * ATLAS_GRID; tileIdx++) {
    const col = tileCol(tileIdx);
    const row = tileRow(tileIdx);
    const cellX = col * TILE_PX;
    const cellY = row * TILE_PX;

    // Base color: from the palette for known tiles, debug magenta otherwise.
    const base: RGB =
      tileIdx <= MAX_USED_TILE ? tileColor(tileIdx) : [...DEBUG_MAGENTA];

    // Fill the inner region (no dilation border yet).
    for (let ly = 0; ly < TILE_PX; ly++) {
      for (let lx = 0; lx < TILE_PX; lx++) {
        const detail = texelDetail(tileIdx, lx, ly);
        const r = clamp01(base[0] + detail);
        const g = clamp01(base[1] + detail);
        const b = clamp01(base[2] + detail);

        const atlasX = cellX + lx;
        const atlasY = cellY + ly;
        const o = (atlasY * ATLAS_PX + atlasX) * 4;
        out[o] = Math.round(r * 255);
        out[o + 1] = Math.round(g * 255);
        out[o + 2] = Math.round(b * 255);
        out[o + 3] = 255;
      }
    }

    // 2-pixel edge dilation: copy edge texels outward so mipmaps don't bleed
    // the wrong tile's color at tile boundaries.
    //
    // We dilate outward by 2 pixels within the tile cell region. The atlas is
    // big enough (64px tiles, 16 tiles × 64px = 1024px) that a 2px pad is
    // entirely within each cell.
    //
    // Implementation: for each border side, copy the nearest interior edge
    // row/column outward to the two padding rows/columns.
    const dilate = 2;
    for (let d = 1; d <= dilate; d++) {
      // Top edge: row (cellY + d - 1) ← copy of row (cellY + dilate)
      // We overwrite the outermost rows first, working inward.
      const srcTopY = cellY + dilate;
      const dstTopY = cellY + dilate - d;
      for (let lx = 0; lx < TILE_PX; lx++) {
        const sx = cellX + lx;
        const so = (srcTopY * ATLAS_PX + sx) * 4;
        const do_ = (dstTopY * ATLAS_PX + sx) * 4;
        out[do_] = out[so] ?? 0;
        out[do_ + 1] = out[so + 1] ?? 0;
        out[do_ + 2] = out[so + 2] ?? 0;
        out[do_ + 3] = 255;
      }

      // Bottom edge: row (cellY + TILE_PX - dilate + d - 1) ← row (cellY + TILE_PX - 1 - dilate)
      const srcBotY = cellY + TILE_PX - 1 - dilate;
      const dstBotY = cellY + TILE_PX - dilate + d - 1;
      for (let lx = 0; lx < TILE_PX; lx++) {
        const sx = cellX + lx;
        const so = (srcBotY * ATLAS_PX + sx) * 4;
        const do_ = (dstBotY * ATLAS_PX + sx) * 4;
        out[do_] = out[so] ?? 0;
        out[do_ + 1] = out[so + 1] ?? 0;
        out[do_ + 2] = out[so + 2] ?? 0;
        out[do_ + 3] = 255;
      }

      // Left edge: col (cellX + dilate - d) ← col (cellX + dilate)
      const srcLeftX = cellX + dilate;
      const dstLeftX = cellX + dilate - d;
      for (let ly = 0; ly < TILE_PX; ly++) {
        const sy = cellY + ly;
        const so = (sy * ATLAS_PX + srcLeftX) * 4;
        const do_ = (sy * ATLAS_PX + dstLeftX) * 4;
        out[do_] = out[so] ?? 0;
        out[do_ + 1] = out[so + 1] ?? 0;
        out[do_ + 2] = out[so + 2] ?? 0;
        out[do_ + 3] = 255;
      }

      // Right edge: col (cellX + TILE_PX - dilate + d - 1) ← col (cellX + TILE_PX - 1 - dilate)
      const srcRightX = cellX + TILE_PX - 1 - dilate;
      const dstRightX = cellX + TILE_PX - dilate + d - 1;
      for (let ly = 0; ly < TILE_PX; ly++) {
        const sy = cellY + ly;
        const so = (sy * ATLAS_PX + srcRightX) * 4;
        const do_ = (sy * ATLAS_PX + dstRightX) * 4;
        out[do_] = out[so] ?? 0;
        out[do_ + 1] = out[so + 1] ?? 0;
        out[do_ + 2] = out[so + 2] ?? 0;
        out[do_ + 3] = 255;
      }
    }
  }

  return out;
}
