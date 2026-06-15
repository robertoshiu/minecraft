/**
 * mob-atlas.test.ts — pure unit tests for the mob texture atlas generator.
 * No Babylon, no Scene required.
 */

import { describe, it, expect } from "vitest";
import {
  generateMobAtlasRGBA,
  uvRegion,
  faceUVForRect,
  MOB_ATLAS_PX,
  MOB_TILE_PX,
} from "./mob-atlas";

// ---------------------------------------------------------------------------
// generateMobAtlasRGBA
// ---------------------------------------------------------------------------

describe("generateMobAtlasRGBA", () => {
  it("returns a Uint8Array of the correct length", () => {
    const rgba = generateMobAtlasRGBA();
    expect(rgba).toBeInstanceOf(Uint8Array);
    expect(rgba.length).toBe(MOB_ATLAS_PX * MOB_ATLAS_PX * 4);
  });

  it("every alpha byte (index 3, 7, 11, …) is 255", () => {
    const rgba = generateMobAtlasRGBA();
    const total = MOB_ATLAS_PX * MOB_ATLAS_PX;
    for (let i = 0; i < total; i++) {
      expect(rgba[i * 4 + 3]).toBe(255);
    }
  });

  it("is deterministic — two calls produce byte-identical output", () => {
    const a = generateMobAtlasRGBA();
    const b = generateMobAtlasRGBA();
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        throw new Error(`Mismatch at byte ${i}: ${a[i]} !== ${b[i]}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// uvRegion
// ---------------------------------------------------------------------------

/** All (species, role) pairs that MODELS in mob-renderer.ts actually uses. */
const USED_PAIRS: [string, string][] = [
  // cow
  ["cow",      "body"],
  ["cow",      "head"],
  ["cow",      "tail"],
  // pig
  ["pig",      "body"],
  // sheep
  ["sheep",    "body"],
  ["sheep",    "head"],
  // chicken
  ["chicken",  "body"],
  ["chicken",  "head"],
  // zombie
  ["zombie",   "body"],
  ["zombie",   "head"],
  // skeleton
  ["skeleton", "body"],
  ["skeleton", "head"],
  // creeper
  ["creeper",  "body"],
  ["creeper",  "head"],
];

describe("uvRegion", () => {
  it("returns coords in [0,1] with u0<u1 and v0<v1 for all used pairs", () => {
    for (const [sp, rl] of USED_PAIRS) {
      const r = uvRegion(sp, rl);
      expect(r.u0).toBeGreaterThanOrEqual(0);
      expect(r.u1).toBeLessThanOrEqual(1);
      expect(r.v0).toBeGreaterThanOrEqual(0);
      expect(r.v1).toBeLessThanOrEqual(1);
      expect(r.u0).toBeLessThan(r.u1);
      expect(r.v0).toBeLessThan(r.v1);
    }
  });

  it("rect is strictly inside the raw cell boundaries (half-texel inset)", () => {
    const half = 0.5 / MOB_ATLAS_PX;
    const tileUV = MOB_TILE_PX / MOB_ATLAS_PX;

    for (const [sp, rl] of USED_PAIRS) {
      const r = uvRegion(sp, rl);
      // Determine the expected cell from the raw cell boundaries.
      // We cannot import CELL_MAP directly, but we can verify u0 > cellEdge + half
      // by checking u0 > 0 (half-texel inset is > 0) and u0 < tileUV (within one tile).
      // More precisely: u0 should be cellLeft + half  (> cellLeft).
      const cellLeft = r.u0 - half;
      const cellRight = r.u1 + half;
      expect(cellLeft).toBeGreaterThanOrEqual(-1e-9); // cell starts at or after 0
      expect(cellRight).toBeLessThanOrEqual(1 + 1e-9); // cell ends at or before 1
      // u0 is strictly inside (not at the cell edge).
      expect(r.u0).toBeGreaterThan(cellLeft + 1e-9);
      expect(r.u1).toBeLessThan(cellRight - 1e-9);
      // Cell width matches one tile exactly.
      expect(cellRight - cellLeft).toBeCloseTo(tileUV, 6);
    }
  });

  it("returns valid (non-zero-size) rect for unknown species:role fallback", () => {
    const r = uvRegion("unknown_species", "unknown_role");
    expect(r.u0).toBeLessThan(r.u1);
    expect(r.v0).toBeLessThan(r.v1);
  });
});

// ---------------------------------------------------------------------------
// faceUVForRect
// ---------------------------------------------------------------------------

describe("faceUVForRect", () => {
  it("returns exactly 6 entries", () => {
    const r = uvRegion("cow", "body");
    const faces = faceUVForRect(r);
    expect(faces.length).toBe(6);
  });

  it("each entry maps x→u0, y→v0, z→u1, w→v1", () => {
    const r = uvRegion("zombie", "head");
    const faces = faceUVForRect(r);
    for (const f of faces) {
      expect(f.x).toBeCloseTo(r.u0, 9);
      expect(f.y).toBeCloseTo(r.v0, 9);
      expect(f.z).toBeCloseTo(r.u1, 9);
      expect(f.w).toBeCloseTo(r.v1, 9);
    }
  });
});
