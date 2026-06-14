import { describe, it, expect } from "vitest";
import { Blocks, type BlockId } from "../rules/mc-1.20";
import { ChunkColumn } from "../chunk/column";
import { carveCaves } from "./cave";

const SEED = 4242;
const WORLD_HEIGHT = 256;
const SIZE = 16;

/**
 * Build a terrain-like column: solid `fill` block from y=0 up to and including
 * `surfaceY`, AIR above. Optionally place a thin dirt cap just below the
 * surface to exercise the DIRT-carving path.
 */
function makeTerrainColumn(
  columnX: number,
  columnZ: number,
  surfaceY: number,
  fill: BlockId = Blocks.STONE,
): ChunkColumn {
  const col = new ChunkColumn(columnX, columnZ);
  for (let lz = 0; lz < SIZE; lz++) {
    for (let lx = 0; lx < SIZE; lx++) {
      for (let worldY = 0; worldY <= surfaceY; worldY++) {
        col.setBlock(lx, worldY, lz, fill);
      }
    }
  }
  return col;
}

/** Snapshot every voxel of a column into a flat array for equality checks. */
function snapshot(col: ChunkColumn): BlockId[] {
  const out: BlockId[] = [];
  for (let lz = 0; lz < SIZE; lz++) {
    for (let lx = 0; lx < SIZE; lx++) {
      for (let worldY = 0; worldY < WORLD_HEIGHT; worldY++) {
        out.push(col.getBlock(lx, worldY, lz));
      }
    }
  }
  return out;
}

describe("carveCaves determinism", () => {
  it("produces identical voxels for identical input and seed", () => {
    const a = makeTerrainColumn(0, 0, 120);
    const b = makeTerrainColumn(0, 0, 120);

    carveCaves(a, SEED);
    carveCaves(b, SEED);

    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it("differs across seeds (caves are seed-dependent)", () => {
    // Span columns across the world: 3D Perlin noise is pinned to ~0 on the
    // integer lattice, so a column at the origin can carve nothing for many
    // seeds. Comparing a swath of off-origin columns exercises the field where
    // it actually varies, making the seed dependence observable.
    const snapAll = (seed: number): BlockId[] => {
      const out: BlockId[] = [];
      for (let c = 0; c < 16; c++) {
        const col = makeTerrainColumn(c * 4 - 20, c * 7 - 30, 120);
        carveCaves(col, seed);
        out.push(...snapshot(col));
      }
      return out;
    };

    expect(snapAll(SEED)).not.toEqual(snapAll(SEED + 1));
  });
});

describe("carveCaves surface integrity", () => {
  it("never alters the surface block or introduces air at/above the surface", () => {
    const surfaceY = 100;
    // Grass-on-dirt-on-stone profile so the top is a recognizable surface.
    const col = new ChunkColumn(3, -2);
    for (let lz = 0; lz < SIZE; lz++) {
      for (let lx = 0; lx < SIZE; lx++) {
        for (let worldY = 0; worldY < surfaceY - 4; worldY++) {
          col.setBlock(lx, worldY, lz, Blocks.STONE);
        }
        for (let worldY = surfaceY - 4; worldY < surfaceY; worldY++) {
          col.setBlock(lx, worldY, lz, Blocks.DIRT);
        }
        col.setBlock(lx, surfaceY, lz, Blocks.GRASS);
      }
    }

    const before = snapshot(col);
    carveCaves(col, SEED);

    for (let lz = 0; lz < SIZE; lz++) {
      for (let lx = 0; lx < SIZE; lx++) {
        const sh = col.surfaceHeight(lx, lz);
        // Surface stays exactly the grass we placed.
        expect(sh).toBe(surfaceY);
        expect(col.getBlock(lx, surfaceY, lz)).toBe(Blocks.GRASS);
        // No air at or above the original surface.
        for (let worldY = surfaceY; worldY < WORLD_HEIGHT; worldY++) {
          const idx = (lx + lz * SIZE) * WORLD_HEIGHT + worldY;
          expect(col.getBlock(lx, worldY, lz)).toBe(before[idx]);
        }
      }
    }
  });
});

describe("carveCaves bedrock safety", () => {
  it("never carves y=0 to AIR", () => {
    const col = makeTerrainColumn(7, 7, 120);
    carveCaves(col, SEED);
    for (let lz = 0; lz < SIZE; lz++) {
      for (let lx = 0; lx < SIZE; lx++) {
        expect(col.getBlock(lx, 0, lz)).not.toBe(Blocks.AIR);
      }
    }
  });
});

describe("carveCaves carves real but sparse caves", () => {
  it("carves some underground air over ~50 columns, but well under half", () => {
    const surfaceY = 120;
    const COLUMNS = 50;

    let solidConsidered = 0; // candidate solid voxels below surface-1
    let carved = 0;

    for (let c = 0; c < COLUMNS; c++) {
      // Spread columns across the world so noise sampling varies.
      const col = makeTerrainColumn(c * 3 - 25, c * 5 - 40, surfaceY);

      // Count carve candidates before carving: stone strictly below surfaceY-1
      // and above bedrock.
      for (let lz = 0; lz < SIZE; lz++) {
        for (let lx = 0; lx < SIZE; lx++) {
          for (let worldY = 1; worldY < surfaceY - 1; worldY++) {
            if (col.getBlock(lx, worldY, lz) === Blocks.STONE) solidConsidered++;
          }
        }
      }

      carveCaves(col, SEED);

      for (let lz = 0; lz < SIZE; lz++) {
        for (let lx = 0; lx < SIZE; lx++) {
          for (let worldY = 1; worldY < surfaceY - 1; worldY++) {
            if (col.getBlock(lx, worldY, lz) === Blocks.AIR) carved++;
          }
        }
      }
    }

    expect(carved).toBeGreaterThan(0);
    const fraction = carved / solidConsidered;
    expect(fraction).toBeLessThan(0.5);
  });
});
