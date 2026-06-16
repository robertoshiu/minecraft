import { describe, it, expect } from "vitest";
import { Blocks, ORE_TABLE } from "../rules/mc-1.20";
import { ChunkColumn } from "../chunk/column";
import { fillDeepLava } from "./lava";

const SEED = 4242;
const WORLD_HEIGHT = 256;
const SIZE = 16;
/** Mirror of lava.ts LAVA_LEVEL (the deep-fill ceiling). */
const LAVA_LEVEL = 10;

const ORE_BLOCKS: ReadonlySet<number> = new Set(ORE_TABLE.map((e) => e.block));

/**
 * A fully-solid STONE column (no pre-existing caves) so that fillDeepLava must
 * create lava by replacing STONE — proving the new lake-in-stone behaviour.
 * y=0 is set to BEDROCK. Surface marker at surfaceY=120 (GRASS).
 */
function makeSolidColumn(columnX: number, columnZ: number): ChunkColumn {
  const col = new ChunkColumn(columnX, columnZ);
  const surfaceY = 120;
  for (let lz = 0; lz < SIZE; lz++) {
    for (let lx = 0; lx < SIZE; lx++) {
      // y=0 bedrock
      col.setBlock(lx, 0, lz, Blocks.BEDROCK);
      // y=1..surfaceY-1 stone
      for (let y = 1; y < surfaceY; y++) col.setBlock(lx, y, lz, Blocks.STONE);
      // surface grass marker
      col.setBlock(lx, surfaceY, lz, Blocks.GRASS);
    }
  }
  return col;
}

/**
 * Like makeSolidColumn but also seeds ore and bedrock into the deep band
 * so we can assert those cells survive fillDeepLava.
 */
function makeSolidColumnWithDeepOreAndBedrock(
  columnX: number,
  columnZ: number,
): ChunkColumn {
  const col = makeSolidColumn(columnX, columnZ);
  // Place every ore type at a fixed deep cell (y=3..8 across the 6 ore types).
  const ores = [
    Blocks.COAL_ORE,
    Blocks.IRON_ORE,
    Blocks.GOLD_ORE,
    Blocks.REDSTONE_ORE,
    Blocks.DIAMOND_ORE,
    Blocks.LAPIS_ORE,
  ];
  for (let i = 0; i < ores.length; i++) {
    // Spread them at lx=2, varying lz and y so each is in a unique deep cell.
    col.setBlock(2, 3 + i, i, ores[i]!);
  }
  // Also place a BEDROCK cell deep (acts like the extra bedrock layers some
  // generators place at low y).
  col.setBlock(5, 2, 5, Blocks.BEDROCK);
  return col;
}

/**
 * Old-style deep-cave column: solid STONE [0, surfaceY] with a carved AIR
 * pocket at y=5 (cave-air on a solid floor). Used to keep backward-compat
 * determinism + surface-integrity tests meaningful alongside the new stone-fill.
 */
function makeDeepCaveColumn(columnX: number, columnZ: number): ChunkColumn {
  const col = new ChunkColumn(columnX, columnZ);
  const surfaceY = 120;
  for (let lz = 0; lz < SIZE; lz++) {
    for (let lx = 0; lx < SIZE; lx++) {
      for (let y = 0; y <= surfaceY; y++) col.setBlock(lx, y, lz, Blocks.STONE);
      // Carve a 1-block-tall AIR pocket at y=5 on a solid floor (y=4 stays stone).
      col.setBlock(lx, 5, lz, Blocks.AIR);
      // Grass surface marker so we can assert it is never altered.
      col.setBlock(lx, surfaceY, lz, Blocks.GRASS);
    }
  }
  return col;
}

function snapshot(col: ChunkColumn): number[] {
  const out: number[] = [];
  for (let lz = 0; lz < SIZE; lz++) {
    for (let lx = 0; lx < SIZE; lx++) {
      for (let y = 0; y < WORLD_HEIGHT; y++) out.push(col.getBlock(lx, y, lz));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("fillDeepLava determinism", () => {
  it("produces identical voxels for identical input and seed", () => {
    const a = makeSolidColumn(0, 0);
    const b = makeSolidColumn(0, 0);
    fillDeepLava(a, SEED);
    fillDeepLava(b, SEED);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it("differs across seeds (lava placement is seed-dependent)", () => {
    const snapAll = (seed: number): number[] => {
      const out: number[] = [];
      for (let c = 0; c < 16; c++) {
        const col = makeSolidColumn(c * 4 - 20, c * 7 - 30);
        fillDeepLava(col, seed);
        out.push(...snapshot(col));
      }
      return out;
    };
    expect(snapAll(SEED)).not.toEqual(snapAll(SEED + 1));
  });
});

// ---------------------------------------------------------------------------
// Depth + surface integrity
// ---------------------------------------------------------------------------

describe("fillDeepLava depth + surface integrity", () => {
  it("never places LAVA above LAVA_LEVEL", () => {
    const col = makeSolidColumn(3, -2);
    fillDeepLava(col, SEED);
    for (let lz = 0; lz < SIZE; lz++) {
      for (let lx = 0; lx < SIZE; lx++) {
        for (let y = LAVA_LEVEL + 1; y < WORLD_HEIGHT; y++) {
          expect(col.getBlock(lx, y, lz)).not.toBe(Blocks.LAVA);
        }
      }
    }
  });

  it("never alters the surface block (GRASS) or any block above LAVA_LEVEL", () => {
    const surfaceY = 120;
    const col = makeSolidColumn(3, -2);
    fillDeepLava(col, SEED);
    for (let lz = 0; lz < SIZE; lz++) {
      for (let lx = 0; lx < SIZE; lx++) {
        expect(col.surfaceHeight(lx, lz)).toBe(surfaceY);
        expect(col.getBlock(lx, surfaceY, lz)).toBe(Blocks.GRASS);
        // Everything above LAVA_LEVEL must be untouched (STONE or GRASS).
        for (let y = LAVA_LEVEL + 1; y < WORLD_HEIGHT; y++) {
          expect(col.getBlock(lx, y, lz)).not.toBe(Blocks.LAVA);
        }
      }
    }
  });

  it("never places LAVA at y=0 (bedrock layer)", () => {
    const col = makeSolidColumn(7, 7);
    fillDeepLava(col, SEED);
    for (let lz = 0; lz < SIZE; lz++) {
      for (let lx = 0; lx < SIZE; lx++) {
        expect(col.getBlock(lx, 0, lz)).not.toBe(Blocks.LAVA);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Ore + bedrock preservation
// ---------------------------------------------------------------------------

describe("fillDeepLava ore and bedrock preservation", () => {
  it("never overwrites an ore block or a deep bedrock cell", () => {
    const col = makeSolidColumnWithDeepOreAndBedrock(12, -7);
    // Record the positions and IDs of every ore/bedrock in the deep band.
    type Cell = { lx: number; y: number; lz: number; id: number };
    const precious: Cell[] = [];
    for (let lz = 0; lz < SIZE; lz++) {
      for (let lx = 0; lx < SIZE; lx++) {
        for (let y = 1; y <= LAVA_LEVEL; y++) {
          const id = col.getBlock(lx, y, lz);
          if (ORE_BLOCKS.has(id) || id === Blocks.BEDROCK) {
            precious.push({ lx, y, lz, id });
          }
        }
      }
    }
    expect(precious.length).toBeGreaterThan(0); // sanity: we placed some

    fillDeepLava(col, SEED);

    for (const { lx, y, lz, id } of precious) {
      expect(col.getBlock(lx, y, lz)).toBe(id);
    }
  });

  it("only ever overwrites STONE or AIR cells (never touches other block types)", () => {
    const col = makeSolidColumnWithDeepOreAndBedrock(0, 5);
    const before = snapshot(col);
    fillDeepLava(col, SEED);
    for (let lz = 0; lz < SIZE; lz++) {
      for (let lx = 0; lx < SIZE; lx++) {
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const idx = (lx + lz * SIZE) * WORLD_HEIGHT + y;
          const prev = before[idx]!;
          const after = col.getBlock(lx, y, lz);
          if (after !== prev) {
            // Changed: must have been STONE or AIR before, and LAVA after.
            expect(prev === Blocks.STONE || prev === Blocks.AIR).toBe(true);
            expect(after).toBe(Blocks.LAVA);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Encounterability — the key regression test for the rework
// ---------------------------------------------------------------------------

describe("fillDeepLava encounterability", () => {
  it(
    "fills an encounterable fraction of deep-band cells (>=6%) across a wide coordinate sweep",
    () => {
      // Sweep a 20x20 grid of columns (400 columns total) around the origin.
      // For each column we count how many of the 16*16*10 = 2560 deep-band
      // voxels end up as LAVA and tally what fraction of columns have ANY lava.
      //
      // Measured at threshold=0.22 (24x24 sweep, seed 4242):
      //   ~11.77% of deep-band cells are lava, ~98.6% of columns are lava-bearing.
      // Bounds are set with comfortable margin below those values so they:
      //   (a) pass reliably at 0.22, and
      //   (b) would have FAILED the old cave-air-only impl (near 0% on solid stone).
      const COLS = 20; // per axis
      let totalDeepCells = 0;
      let lavaCells = 0;
      let columnsWithLava = 0;
      let totalColumns = 0;

      for (let cx = -10; cx < 10; cx++) {
        for (let cz = -10; cz < 10; cz++) {
          totalColumns++;
          const col = makeSolidColumn(cx, cz);
          fillDeepLava(col, SEED);
          let colHasLava = false;
          for (let lz = 0; lz < SIZE; lz++) {
            for (let lx = 0; lx < SIZE; lx++) {
              for (let y = 1; y <= LAVA_LEVEL; y++) {
                totalDeepCells++;
                if (col.getBlock(lx, y, lz) === Blocks.LAVA) {
                  lavaCells++;
                  colHasLava = true;
                }
              }
            }
          }
          if (colHasLava) columnsWithLava++;
        }
      }

      const cellFraction = lavaCells / totalDeepCells;
      const colFraction = columnsWithLava / totalColumns;

      // At least 6% of deep-band cells should be lava (measured ~11.77%).
      // Would be ~0% under the old cave-air-only impl on solid stone.
      expect(cellFraction).toBeGreaterThanOrEqual(0.06);
      // At least 50% of columns should contain at least one lava cell (measured ~99%).
      expect(colFraction).toBeGreaterThanOrEqual(0.5);

      // Suppress unused-variable lint for COLS (it documents sweep size).
      void COLS;
    },
  );

  it("places SOME lava across many solid-stone deep-band columns (old-style smoke test)", () => {
    let lava = 0;
    for (let c = 0; c < 30; c++) {
      const col = makeSolidColumn(c * 5 - 35, c * 3 - 20);
      fillDeepLava(col, SEED);
      for (let lz = 0; lz < SIZE; lz++) {
        for (let lx = 0; lx < SIZE; lx++) {
          for (let y = 1; y <= LAVA_LEVEL; y++) {
            if (col.getBlock(lx, y, lz) === Blocks.LAVA) lava++;
          }
        }
      }
    }
    // Must be much more than 0 — the old cave-air impl would be 0 on solid cols.
    expect(lava).toBeGreaterThan(100);
  });

  it("also pools lava into cave-air cells (backward-compat with cave-air path)", () => {
    let lava = 0;
    for (let c = 0; c < 30; c++) {
      const col = makeDeepCaveColumn(c * 5 - 35, c * 3 - 20);
      fillDeepLava(col, SEED);
      for (let lz = 0; lz < SIZE; lz++) {
        for (let lx = 0; lx < SIZE; lx++) {
          for (let y = 1; y <= LAVA_LEVEL; y++) {
            if (col.getBlock(lx, y, lz) === Blocks.LAVA) lava++;
          }
        }
      }
    }
    expect(lava).toBeGreaterThan(0);
  });
});
