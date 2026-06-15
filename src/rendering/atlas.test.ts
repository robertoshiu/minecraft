import { describe, it, expect } from "vitest";
import { generateAtlasRGBA, tileCol, tileRow, ATLAS_PX, TILE_PX, ATLAS_GRID } from "./atlas";

describe("tileCol / tileRow", () => {
  it("index 0 maps to col 0, row 0", () => {
    expect(tileCol(0)).toBe(0);
    expect(tileRow(0)).toBe(0);
  });

  it("index 15 maps to col 15, row 0", () => {
    expect(tileCol(15)).toBe(15);
    expect(tileRow(15)).toBe(0);
  });

  it("index 16 maps to col 0, row 1", () => {
    expect(tileCol(16)).toBe(0);
    expect(tileRow(16)).toBe(1);
  });

  it("index 34 maps to col 2, row 2", () => {
    expect(tileCol(34)).toBe(2);
    expect(tileRow(34)).toBe(2);
  });

  it("index 255 maps to col 15, row 15", () => {
    expect(tileCol(255)).toBe(15);
    expect(tileRow(255)).toBe(15);
  });
});

describe("generateAtlasRGBA", () => {
  // Generate once — reuse across assertions.
  const atlas = generateAtlasRGBA();

  it("has the correct byte length: ATLAS_PX * ATLAS_PX * 4", () => {
    expect(atlas.length).toBe(ATLAS_PX * ATLAS_PX * 4);
    expect(atlas.length).toBe(1024 * 1024 * 4);
  });

  it("is deterministic: calling twice yields identical output", () => {
    const atlas2 = generateAtlasRGBA();
    // Compare a sample of positions rather than the whole array (fast test).
    for (let i = 0; i < 1000; i++) {
      const idx = i * 4097; // stride to cover the array
      expect(atlas[idx]).toBe(atlas2[idx]);
    }
  });

  /**
   * Helper: read the RGBA of the texel at atlas-pixel (ax, ay).
   */
  function readPixel(ax: number, ay: number): [number, number, number, number] {
    const o = (ay * ATLAS_PX + ax) * 4;
    return [atlas[o] ?? 0, atlas[o + 1] ?? 0, atlas[o + 2] ?? 0, atlas[o + 3] ?? 0];
  }

  /**
   * Helper: sample the CENTER texel of tile `index`.
   */
  function centerPixel(index: number): [number, number, number, number] {
    const col = tileCol(index);
    const row = tileRow(index);
    const ax = col * TILE_PX + Math.floor(TILE_PX / 2);
    const ay = row * TILE_PX + Math.floor(TILE_PX / 2);
    return readPixel(ax, ay);
  }

  it("STONE tile (index 1) center texel reads grayish (R ≈ G ≈ B in mid range)", () => {
    const [r, g, b, a] = centerPixel(1); // stone
    // Stone base is [0.5, 0.5, 0.5] ≈ 128; with ±8% speckle max offset is ≈ 20.
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(80);
    expect(r).toBeLessThan(180);
    // R, G, B should be similar (grayish) — within 30 of each other.
    expect(Math.abs(r - g)).toBeLessThan(30);
    expect(Math.abs(r - b)).toBeLessThan(30);
  });

  it("GRASS_TOP tile (index 3) center texel reads greenish (G notably > R and G > B)", () => {
    const [r, g, b, a] = centerPixel(3); // grass_top
    // grass_top base is [0.35, 0.55, 0.2] — G is highest, B is lowest.
    expect(a).toBe(255);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it("two different tiles (STONE and GRASS_TOP) have distinct center pixels", () => {
    const [r1, g1, b1] = centerPixel(1); // stone — gray
    const [r2, g2, b2] = centerPixel(3); // grass_top — green
    // They should differ by at least 20 in at least one channel.
    const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
    expect(diff).toBeGreaterThan(20);
  });

  it("DIRT tile (index 2) center texel reads brownish (R > B, G in between)", () => {
    const [r, , b, a] = centerPixel(2); // dirt
    expect(a).toBe(255);
    // dirt base [0.45, 0.32, 0.2] — R is highest, B is lowest.
    expect(r).toBeGreaterThan(b);
  });

  it("BED tile (index 35) center texel reads reddish, not magenta debug color", () => {
    const [r, g, b, a] = centerPixel(35); // bed — warm red [0.78, 0.16, 0.18]
    // MAX_USED_TILE is 35, so tile 35 is filled from tileColor(35) not magenta.
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(150); // red dominant (0.78 * 255 ≈ 199 ± variation)
    expect(g).toBeLessThan(80);     // low green (0.16 * 255 ≈ 41)
    // Not the magenta fallback: magenta has B close to R (both ≈ 0.8*255 ≈ 204).
    // In the bed tile B is about 0.18 * 255 ≈ 46, much lower than R.
    expect(b).toBeLessThan(r - 50); // blue well below red
  });

  it("all pixels have alpha = 255", () => {
    // Spot-check alpha every 512 bytes across the full atlas.
    for (let i = 3; i < atlas.length; i += 512 * 4) {
      expect(atlas[i]).toBe(255);
    }
  });

  it("atlas grid constants are consistent: ATLAS_GRID * TILE_PX === ATLAS_PX", () => {
    expect(ATLAS_GRID * TILE_PX).toBe(ATLAS_PX);
  });

  // ── FIX 3: boosted tile detail / variance assertions ───────────────────────

  /**
   * Compute the per-channel standard deviation of all texels in a tile cell.
   * A higher value means more visible intra-tile variation (better texture).
   */
  function tileLuminanceStdDev(index: number): number {
    const col = tileCol(index);
    const row = tileRow(index);
    const cellX = col * TILE_PX;
    const cellY = row * TILE_PX;
    const values: number[] = [];
    for (let ly = 0; ly < TILE_PX; ly++) {
      for (let lx = 0; lx < TILE_PX; lx++) {
        const ax = cellX + lx;
        const ay = cellY + ly;
        const o = (ay * ATLAS_PX + ax) * 4;
        // Use luminance (perceptual approximation) to measure brightness variation.
        const r = (atlas[o] ?? 0) / 255;
        const g = (atlas[o + 1] ?? 0) / 255;
        const b = (atlas[o + 2] ?? 0) / 255;
        values.push(0.299 * r + 0.587 * g + 0.114 * b);
      }
    }
    const n = values.length;
    const mean = values.reduce((a, v) => a + v, 0) / n;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
    return Math.sqrt(variance);
  }

  it("grass_top tile (index 3) has higher intra-tile luminance variance than 0.02", () => {
    // Pre-fix the fallback was ±2% variation (stdDev ≈ 0.006–0.010).
    // Post-fix the grass clumpy pattern yields stdDev well above 0.02.
    const stdDev = tileLuminanceStdDev(3);
    expect(stdDev).toBeGreaterThan(0.02);
  });

  it("grass_side tile (index 4) has higher intra-tile luminance variance than 0.02", () => {
    const stdDev = tileLuminanceStdDev(4);
    expect(stdDev).toBeGreaterThan(0.02);
  });

  it("stone tile (index 1) has higher intra-tile luminance variance than 0.03 (boosted speckle)", () => {
    // Pre-fix speckle was ±8% (stdDev ≈ 0.023); post-fix ±14% → stdDev ≈ 0.04+.
    const stdDev = tileLuminanceStdDev(1);
    expect(stdDev).toBeGreaterThan(0.03);
  });

  it("grass_top tile has materially higher variance than the pre-fix fallback threshold", () => {
    // The old fallback was ±2% → stdDev ≈ 0.006. New grass pattern must be
    // at least 3× that to be visually distinct.
    const stdDev = tileLuminanceStdDev(3);
    expect(stdDev).toBeGreaterThan(0.018); // 3× the old ≈ 0.006 floor
  });
});
