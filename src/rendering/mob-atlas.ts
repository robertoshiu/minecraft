/**
 * mob-atlas.ts — PURE, Babylon-free procedural mob texture atlas generator.
 *
 * Generates a 256×256 RGBA Uint8Array holding an 8×8 grid of 32×32 tile cells.
 * Each cell corresponds to one (species, role) pair. The atlas uses the same
 * deterministic hash technique as atlas.ts — no Math.random, no wall-clock.
 *
 * Atlas cell layout (col, row) — stable ordered assignment:
 *   row 0: cow:body, cow:head, cow:leg, cow:tail
 *   row 1: pig:body, pig:head, pig:leg, pig:snout
 *   row 2: sheep:body, sheep:head, sheep:leg
 *   row 3: chicken:body, chicken:head, chicken:leg, chicken:beak
 *   row 4: zombie:body, zombie:head, zombie:leg, zombie:arm
 *   row 5: skeleton:body, skeleton:head, skeleton:leg, skeleton:arm
 *   row 6: creeper:body, creeper:head, creeper:leg
 *
 * faceUV face order for Babylon CreateBox (documented per Babylon source):
 *   0 = +Z (front), 1 = -Z (back), 2 = +X (right), 3 = -X (left),
 *   4 = +Y (top),   5 = -Y (bottom)
 */

// ---------------------------------------------------------------------------
// Atlas constants
// ---------------------------------------------------------------------------

/** Total atlas width/height in pixels. */
export const MOB_ATLAS_PX = 256;

/** One tile cell width/height in pixels. */
export const MOB_TILE_PX = 32;

/** Number of cells per axis (256/32 = 8). */
export const MOB_GRID = MOB_ATLAS_PX / MOB_TILE_PX; // 8

// ---------------------------------------------------------------------------
// Species base colors (mirrors MOB_COLORS in mob-renderer.ts)
// ---------------------------------------------------------------------------

/** Base color per mob species as [r, g, b] in [0, 1]. */
const MOB_BASE_RGB: Record<string, [number, number, number]> = {
  cow:      [0x6b / 255, 0x4f / 255, 0x3a / 255],
  pig:      [0xe0 / 255, 0xa0 / 255, 0xa8 / 255],
  sheep:    [0xe8 / 255, 0xe8 / 255, 0xe0 / 255],
  chicken:  [0xf0 / 255, 0xe8 / 255, 0xc0 / 255],
  zombie:   [0x3a / 255, 0x7d / 255, 0x3a / 255],
  skeleton: [0xd8 / 255, 0xd8 / 255, 0xd0 / 255],
  creeper:  [0x2f / 255, 0x7d / 255, 0x33 / 255],
};

// ---------------------------------------------------------------------------
// (species, role) → (col, row) atlas cell mapping
// ---------------------------------------------------------------------------

/**
 * Stable ordered list of all (species, role) pairs used by MODELS in
 * mob-renderer.ts. Each entry gets a unique cell in row-major order.
 * Adding new pairs always goes at the end to avoid shifting existing UVs.
 */
const CELL_LIST: ReadonlyArray<[species: string, role: string]> = [
  // row 0
  ["cow",      "body"],
  ["cow",      "head"],
  ["cow",      "leg"],
  ["cow",      "tail"],
  // row 0 col 4
  ["cow",      "horn"],
  ["cow",      "snout"],
  // row 0 col 6
  ["pig",      "body"],
  ["pig",      "head"],
  // row 1
  ["pig",      "leg"],
  ["pig",      "snout"],
  ["sheep",    "body"],
  ["sheep",    "head"],
  ["sheep",    "leg"],
  ["chicken",  "body"],
  ["chicken",  "head"],
  ["chicken",  "leg"],
  // row 2
  ["chicken",  "beak"],
  ["zombie",   "body"],
  ["zombie",   "head"],
  ["zombie",   "leg"],
  ["zombie",   "arm"],
  ["skeleton", "body"],
  ["skeleton", "head"],
  ["skeleton", "leg"],
  // row 3
  ["skeleton", "arm"],
  ["creeper",  "body"],
  ["creeper",  "head"],
  ["creeper",  "leg"],
];

/** Map from "species:role" to {col, row} in the atlas grid. */
const CELL_MAP = new Map<string, { col: number; row: number }>();
for (let i = 0; i < CELL_LIST.length; i++) {
  const [sp, rl] = CELL_LIST[i]!;
  CELL_MAP.set(`${sp}:${rl}`, {
    col: i % MOB_GRID,
    row: Math.floor(i / MOB_GRID),
  });
}

// ---------------------------------------------------------------------------
// Deterministic hash helpers (mirrors atlas.ts)
// ---------------------------------------------------------------------------

function hash3(a: number, b: number, c: number): number {
  let h = (a * 1664525 + 1013904223) | 0;
  h = (h ^ b) * 1664525 + 1013904223;
  h = (h ^ c) * 1664525 + 1013904223;
  return h & 0x7fffffff;
}

function hashF(a: number, b: number, c: number): number {
  return hash3(a, b, c) / 0x80000000;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// Atlas generation
// ---------------------------------------------------------------------------

/**
 * Generate the full 256×256 RGBA mob atlas as a Uint8Array
 * (length = MOB_ATLAS_PX * MOB_ATLAS_PX * 4 = 262 144 bytes).
 * Deterministic — identical output on every call.
 *
 * Each (species, role) cell is filled with the species' base color plus
 * subtle per-texel brightness variation (pixel-art texture appearance).
 * The "head" role tiles receive a slightly darker horizontal band near the
 * top half to hint at facial shading.
 * 2-pixel edge dilation prevents mipmap/bilinear bleed at tile boundaries.
 * Unused cells are filled with neutral mid-gray.
 */
export function generateMobAtlasRGBA(): Uint8Array {
  const out = new Uint8Array(MOB_ATLAS_PX * MOB_ATLAS_PX * 4);
  const DILATE = 2;

  // Fill all cells — known cells get species color, unused get gray.
  for (let cellIdx = 0; cellIdx < MOB_GRID * MOB_GRID; cellIdx++) {
    const col = cellIdx % MOB_GRID;
    const row = Math.floor(cellIdx / MOB_GRID);
    const cellX = col * MOB_TILE_PX;
    const cellY = row * MOB_TILE_PX;

    // Determine species and role for this cell (if any).
    const entry = CELL_LIST[cellIdx];
    const species = entry?.[0] ?? null;
    const roleStr = entry?.[1] ?? null;
    const baseRGB: [number, number, number] =
      species !== null && species in MOB_BASE_RGB
        ? MOB_BASE_RGB[species]!
        : [0.5, 0.5, 0.5];

    // Inner region (excluding dilation border).
    for (let ly = 0; ly < MOB_TILE_PX; ly++) {
      for (let lx = 0; lx < MOB_TILE_PX; lx++) {
        // Per-texel brightness variation for pixel-art look (±8%).
        const detail = (hashF(cellIdx, lx, ly) - 0.5) * 0.16;

        // Head tiles: add a darker band in the upper third (face hint).
        let headShade = 0;
        if (roleStr === "head") {
          // Darken upper 1/3 of the tile to simulate a forehead/face zone.
          const normY = ly / MOB_TILE_PX;
          if (normY < 0.33) {
            headShade = -0.08 * (1 - normY / 0.33);
          }
        }

        const r = clamp01(baseRGB[0] + detail + headShade);
        const g = clamp01(baseRGB[1] + detail + headShade);
        const b = clamp01(baseRGB[2] + detail + headShade);

        const atlasX = cellX + lx;
        const atlasY = cellY + ly;
        const o = (atlasY * MOB_ATLAS_PX + atlasX) * 4;
        out[o]     = Math.round(r * 255);
        out[o + 1] = Math.round(g * 255);
        out[o + 2] = Math.round(b * 255);
        out[o + 3] = 255;
      }
    }

    // 2-pixel edge dilation: copy edge texels outward to prevent bilinear bleed.
    for (let d = 1; d <= DILATE; d++) {
      // Top edge: row (cellY + d - 1) ← copy of row (cellY + DILATE)
      const srcTopY = cellY + DILATE;
      const dstTopY = cellY + DILATE - d;
      for (let lx = 0; lx < MOB_TILE_PX; lx++) {
        const sx = cellX + lx;
        const so = (srcTopY * MOB_ATLAS_PX + sx) * 4;
        const do_ = (dstTopY * MOB_ATLAS_PX + sx) * 4;
        out[do_]     = out[so]     ?? 0;
        out[do_ + 1] = out[so + 1] ?? 0;
        out[do_ + 2] = out[so + 2] ?? 0;
        out[do_ + 3] = 255;
      }

      // Bottom edge: row (cellY + TILE_PX - DILATE + d - 1) ← row (cellY + TILE_PX - 1 - DILATE)
      const srcBotY = cellY + MOB_TILE_PX - 1 - DILATE;
      const dstBotY = cellY + MOB_TILE_PX - DILATE + d - 1;
      for (let lx = 0; lx < MOB_TILE_PX; lx++) {
        const sx = cellX + lx;
        const so = (srcBotY * MOB_ATLAS_PX + sx) * 4;
        const do_ = (dstBotY * MOB_ATLAS_PX + sx) * 4;
        out[do_]     = out[so]     ?? 0;
        out[do_ + 1] = out[so + 1] ?? 0;
        out[do_ + 2] = out[so + 2] ?? 0;
        out[do_ + 3] = 255;
      }

      // Left edge: col (cellX + DILATE - d) ← col (cellX + DILATE)
      const srcLeftX = cellX + DILATE;
      const dstLeftX = cellX + DILATE - d;
      for (let ly = 0; ly < MOB_TILE_PX; ly++) {
        const sy = cellY + ly;
        const so = (sy * MOB_ATLAS_PX + srcLeftX) * 4;
        const do_ = (sy * MOB_ATLAS_PX + dstLeftX) * 4;
        out[do_]     = out[so]     ?? 0;
        out[do_ + 1] = out[so + 1] ?? 0;
        out[do_ + 2] = out[so + 2] ?? 0;
        out[do_ + 3] = 255;
      }

      // Right edge: col (cellX + TILE_PX - DILATE + d - 1) ← col (cellX + TILE_PX - 1 - DILATE)
      const srcRightX = cellX + MOB_TILE_PX - 1 - DILATE;
      const dstRightX = cellX + MOB_TILE_PX - DILATE + d - 1;
      for (let ly = 0; ly < MOB_TILE_PX; ly++) {
        const sy = cellY + ly;
        const so = (sy * MOB_ATLAS_PX + srcRightX) * 4;
        const do_ = (sy * MOB_ATLAS_PX + dstRightX) * 4;
        out[do_]     = out[so]     ?? 0;
        out[do_ + 1] = out[so + 1] ?? 0;
        out[do_ + 2] = out[so + 2] ?? 0;
        out[do_ + 3] = 255;
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// UV helpers
// ---------------------------------------------------------------------------

/** Normalized UV rectangle in [0,1] atlas space. */
export interface UVRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/**
 * Return the UV rect for a given (species, role) pair, inset by half a texel
 * on each side so NEAREST sampling never bleeds into the neighbour cell.
 * Falls back to cell (0,0) for unknown pairs (returns a valid rect).
 */
export function uvRegion(species: string, role: string): UVRect {
  const cell = CELL_MAP.get(`${species}:${role}`);
  const col = cell?.col ?? 0;
  const row = cell?.row ?? 0;

  // Half-texel inset in atlas UV space.
  const half = 0.5 / MOB_ATLAS_PX;

  const u0 = (col * MOB_TILE_PX) / MOB_ATLAS_PX + half;
  const v0 = (row * MOB_TILE_PX) / MOB_ATLAS_PX + half;
  const u1 = ((col + 1) * MOB_TILE_PX) / MOB_ATLAS_PX - half;
  const v1 = ((row + 1) * MOB_TILE_PX) / MOB_ATLAS_PX - half;

  return { u0, v0, u1, v1 };
}

/**
 * Convert a UVRect to an array of 6 Babylon CreateBox faceUV entries.
 * All 6 faces receive the same UV rect (per-face anatomical mapping is a
 * later refinement).
 *
 * Babylon CreateBox faceUV face order (index → face):
 *   0 = +Z (front)   1 = -Z (back)
 *   2 = +X (right)   3 = -X (left)
 *   4 = +Y (top)     5 = -Y (bottom)
 *
 * Each entry is { x: u0, y: v0, z: u1, w: v1 } — the Vector4 that Babylon
 * reads as (bottomLeftU, bottomLeftV, topRightU, topRightV).
 * mob-renderer.ts converts these plain objects to Vector4 instances.
 */
export function faceUVForRect(
  r: UVRect,
): { x: number; y: number; z: number; w: number }[] {
  const face = { x: r.u0, y: r.v0, z: r.u1, w: r.v1 };
  return [face, face, face, face, face, face];
}
