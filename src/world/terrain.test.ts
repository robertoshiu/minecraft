import { describe, it, expect } from "vitest";
import { Blocks, CHUNK } from "../rules/mc-1.20";
import { ChunkColumn } from "../chunk/column";
import { getBiome, biomeParams } from "./biome";
import { generateTerrain, SEA_LEVEL } from "./terrain";

const SEED = 2024;
const SIZE = CHUNK.SIZE; // 16
const HEIGHT = CHUNK.HEIGHT; // 256

function freshColumn(cx: number, cz: number, seed: number): ChunkColumn {
  const col = new ChunkColumn(cx, cz);
  generateTerrain(col, seed);
  return col;
}

describe("SEA_LEVEL", () => {
  it("is 64", () => {
    expect(SEA_LEVEL).toBe(64);
  });
});

describe("generateTerrain determinism", () => {
  it("two fresh columns with the same coords+seed are voxel-identical", () => {
    const a = freshColumn(3, -5, SEED);
    const b = freshColumn(3, -5, SEED);
    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        for (let y = 0; y < HEIGHT; y++) {
          expect(a.getBlock(lx, y, lz)).toBe(b.getBlock(lx, y, lz));
        }
      }
    }
  });

  it("differs (at least somewhere) for different column coords", () => {
    const a = freshColumn(0, 0, SEED);
    const b = freshColumn(100, 100, SEED);
    let anyDiff = false;
    outer: for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        for (let y = 0; y < HEIGHT; y++) {
          if (a.getBlock(lx, y, lz) !== b.getBlock(lx, y, lz)) {
            anyDiff = true;
            break outer;
          }
        }
      }
    }
    expect(anyDiff).toBe(true);
  });
});

describe("generateTerrain structure", () => {
  it("places BEDROCK at y=0 everywhere", () => {
    const col = freshColumn(7, 11, SEED);
    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        expect(col.getBlock(lx, 0, lz)).toBe(Blocks.BEDROCK);
      }
    }
  });

  it("never leaves any voxel as the placeholder AIR below sea level boundary unexpectedly (no NaN heights)", () => {
    // A column over several biomes; the surfaceHeight must always be valid.
    for (const [cx, cz] of [
      [0, 0],
      [50, -30],
      [-120, 200],
      [300, 300],
    ] as const) {
      const col = freshColumn(cx, cz, SEED);
      for (let lx = 0; lx < SIZE; lx++) {
        for (let lz = 0; lz < SIZE; lz++) {
          const h = col.surfaceHeight(lx, lz);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThan(HEIGHT);
        }
      }
    }
  });

  it("surface block at the computed terrain height matches the biome surface block (when above water)", () => {
    const col = freshColumn(13, 21, SEED);
    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        const wx = col.columnX * SIZE + lx;
        const wz = col.columnZ * SIZE + lz;
        const params = biomeParams(getBiome(wx, wz, SEED));
        // Find the terrain surface = highest non-water, non-air block.
        let terrainTop = -1;
        for (let y = HEIGHT - 1; y >= 0; y--) {
          const b = col.getBlock(lx, y, lz);
          if (b !== Blocks.AIR && b !== Blocks.WATER) {
            terrainTop = y;
            break;
          }
        }
        expect(terrainTop).toBeGreaterThanOrEqual(0);
        const top = col.getBlock(lx, terrainTop, lz);
        // Above sea level the surface is the biome surface block; near/under
        // water it may be a beach (sand) or the biome block — accept those.
        if (terrainTop > SEA_LEVEL) {
          expect(top).toBe(params.surfaceBlock);
        } else {
          expect([params.surfaceBlock, Blocks.SAND]).toContain(top);
        }
      }
    }
  });

  it("fills WATER up to sea level where terrain is below sea level", () => {
    // Scan many columns to find at least one underwater spot, then assert.
    let checked = 0;
    for (let cx = -10; cx <= 10 && checked < 5; cx++) {
      for (let cz = -10; cz <= 10 && checked < 5; cz++) {
        const col = freshColumn(cx, cz, SEED);
        for (let lx = 0; lx < SIZE; lx++) {
          for (let lz = 0; lz < SIZE; lz++) {
            // terrain top = highest solid (non-air, non-water)
            let terrainTop = -1;
            for (let y = HEIGHT - 1; y >= 0; y--) {
              const b = col.getBlock(lx, y, lz);
              if (b !== Blocks.AIR && b !== Blocks.WATER) {
                terrainTop = y;
                break;
              }
            }
            if (terrainTop < SEA_LEVEL) {
              expect(col.getBlock(lx, SEA_LEVEL, lz)).toBe(Blocks.WATER);
              // and just above the terrain there must be water, not air
              expect(col.getBlock(lx, terrainTop + 1, lz)).toBe(Blocks.WATER);
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("places no solid STONE above the terrain surface", () => {
    const col = freshColumn(2, 2, SEED);
    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        // terrain top
        let terrainTop = -1;
        for (let y = HEIGHT - 1; y >= 0; y--) {
          const b = col.getBlock(lx, y, lz);
          if (b !== Blocks.AIR && b !== Blocks.WATER) {
            terrainTop = y;
            break;
          }
        }
        for (let y = terrainTop + 1; y < HEIGHT; y++) {
          expect(col.getBlock(lx, y, lz)).not.toBe(Blocks.STONE);
        }
      }
    }
  });

  it("stacks STONE / sub-surface / surface in the documented order above water", () => {
    const col = freshColumn(40, 40, SEED);
    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        const wx = col.columnX * SIZE + lx;
        const wz = col.columnZ * SIZE + lz;
        const params = biomeParams(getBiome(wx, wz, SEED));
        // terrain top (highest non-air, non-water)
        let h = -1;
        for (let y = HEIGHT - 1; y >= 0; y--) {
          const b = col.getBlock(lx, y, lz);
          if (b !== Blocks.AIR && b !== Blocks.WATER) {
            h = y;
            break;
          }
        }
        if (h > SEA_LEVEL && h >= 5) {
          expect(col.getBlock(lx, h, lz)).toBe(params.surfaceBlock);
          expect(col.getBlock(lx, h - 1, lz)).toBe(params.subSurfaceBlock);
          expect(col.getBlock(lx, h - 4, lz)).toBe(Blocks.STONE);
        }
      }
    }
  });
});
