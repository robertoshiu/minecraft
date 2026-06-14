import { describe, it, expect } from "vitest";
import { Blocks } from "../rules/mc-1.20";
import { getBiome, biomeParams, type Biome } from "./biome";

const SEED = 1337;
const BIOMES: Biome[] = ["plains", "forest", "desert", "snow"];

describe("getBiome determinism", () => {
  it("returns the same biome for the same (x, z, seed)", () => {
    for (let i = 0; i < 100; i++) {
      const x = (i * 37) % 1000;
      const z = (i * 91) % 1000;
      expect(getBiome(x, z, SEED)).toBe(getBiome(x, z, SEED));
    }
  });

  it("returns one of the four valid biomes", () => {
    for (let x = -200; x < 200; x += 13) {
      for (let z = -200; z < 200; z += 17) {
        expect(BIOMES).toContain(getBiome(x, z, SEED));
      }
    }
  });

  it("depends on the seed", () => {
    let differ = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 11;
      const z = i * 23;
      if (getBiome(x, z, SEED) !== getBiome(x, z, SEED + 1)) differ++;
    }
    expect(differ).toBeGreaterThan(0);
  });
});

describe("getBiome distribution", () => {
  it("produces all four biomes, each above 5%, over ~2000 samples", () => {
    const counts: Record<Biome, number> = {
      plains: 0,
      forest: 0,
      desert: 0,
      snow: 0,
    };
    let total = 0;
    // Deterministic pseudo-random spread of sample points.
    let state = 12345;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let i = 0; i < 2000; i++) {
      const x = Math.floor((next() - 0.5) * 20000);
      const z = Math.floor((next() - 0.5) * 20000);
      counts[getBiome(x, z, SEED)]++;
      total++;
    }
    for (const b of BIOMES) {
      expect(counts[b] / total).toBeGreaterThan(0.05);
    }
  });
});

describe("getBiome contiguity", () => {
  it("usually keeps adjacent cells in the same biome (large regions)", () => {
    let same = 0;
    let total = 0;
    for (let x = -500; x < 500; x += 7) {
      for (let z = -500; z < 500; z += 7) {
        if (getBiome(x, z, SEED) === getBiome(x + 1, z, SEED)) same++;
        if (getBiome(x, z, SEED) === getBiome(x, z + 1, SEED)) same++;
        total += 2;
      }
    }
    // Low-frequency noise => neighbours overwhelmingly agree.
    expect(same / total).toBeGreaterThan(0.9);
  });
});

describe("biomeParams", () => {
  it("returns the documented surface/sub-surface blocks", () => {
    expect(biomeParams("desert").surfaceBlock).toBe(Blocks.SAND);
    expect(biomeParams("desert").subSurfaceBlock).toBe(Blocks.SAND);
    expect(biomeParams("plains").surfaceBlock).toBe(Blocks.GRASS);
    expect(biomeParams("plains").subSurfaceBlock).toBe(Blocks.DIRT);
    expect(biomeParams("forest").surfaceBlock).toBe(Blocks.GRASS);
    expect(biomeParams("forest").subSurfaceBlock).toBe(Blocks.DIRT);
    expect(biomeParams("snow").surfaceBlock).toBe(Blocks.SNOW);
    expect(biomeParams("snow").subSurfaceBlock).toBe(Blocks.DIRT);
  });

  it("returns sensible height profiles (desert flat, snow peaked)", () => {
    const desert = biomeParams("desert");
    const plains = biomeParams("plains");
    const forest = biomeParams("forest");
    const snow = biomeParams("snow");

    // Amplitude grows plains < forest < snow; desert is the flattest.
    expect(desert.amplitude).toBeLessThan(plains.amplitude);
    expect(plains.amplitude).toBeLessThan(forest.amplitude);
    expect(forest.amplitude).toBeLessThan(snow.amplitude);

    // Base heights are reasonable terrain altitudes.
    for (const p of [desert, plains, forest, snow]) {
      expect(p.baseHeight).toBeGreaterThan(50);
      expect(p.baseHeight).toBeLessThan(120);
      expect(p.amplitude).toBeGreaterThanOrEqual(0);
    }
  });

  it("is a pure function (stable across calls)", () => {
    for (const b of BIOMES) {
      expect(biomeParams(b)).toEqual(biomeParams(b));
    }
  });
});
