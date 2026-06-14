import { describe, it, expect } from "vitest";
import { ChunkColumn } from "../chunk/column";
import { Blocks, ORE_TABLE, type BlockId } from "../rules/mc-1.20";
import { generateOres } from "./ore";

const SIZE = 16;
const WORLD_HEIGHT = 256;

const ORE_BLOCKS = new Set<BlockId>(ORE_TABLE.map((e) => e.block));

function diamondEntry() {
  const e = ORE_TABLE.find((x) => x.block === Blocks.DIAMOND_ORE);
  if (e === undefined) throw new Error("DIAMOND_ORE missing from ORE_TABLE");
  return e;
}

/** A column filled entirely with STONE. */
function stoneColumn(columnX = 0, columnZ = 0): ChunkColumn {
  const c = new ChunkColumn(columnX, columnZ);
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    c.fillLayer(y, Blocks.STONE);
  }
  return c;
}

/** Flatten every voxel of a column into a single array for comparison. */
function snapshot(c: ChunkColumn): BlockId[] {
  const out: BlockId[] = [];
  for (let z = 0; z < SIZE; z++) {
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let x = 0; x < SIZE; x++) {
        out.push(c.getBlock(x, y, z));
      }
    }
  }
  return out;
}

describe("generateOres determinism", () => {
  it("produces identical voxels for identical columns + same seed", () => {
    const a = stoneColumn(3, -2);
    const b = stoneColumn(3, -2);
    generateOres(a, 12345);
    generateOres(b, 12345);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it("differs across seeds (sanity: not a constant function)", () => {
    const a = stoneColumn(0, 0);
    const b = stoneColumn(0, 0);
    generateOres(a, 1);
    generateOres(b, 2);
    expect(snapshot(a)).not.toEqual(snapshot(b));
  });

  it("differs across column coordinates", () => {
    const a = stoneColumn(0, 0);
    const b = stoneColumn(5, 5);
    generateOres(a, 99);
    generateOres(b, 99);
    expect(snapshot(a)).not.toEqual(snapshot(b));
  });
});

describe("generateOres only replaces stone", () => {
  it("never places ore where the voxel was not STONE", () => {
    const c = new ChunkColumn(0, 0);
    // Band of STONE in y 8..40; DIRT below, AIR above (so ores can't float).
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      const block: BlockId = y < 8 ? Blocks.DIRT : y <= 40 ? Blocks.STONE : Blocks.AIR;
      c.fillLayer(y, block);
    }

    generateOres(c, 555);

    for (let z = 0; z < SIZE; z++) {
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        for (let x = 0; x < SIZE; x++) {
          const b = c.getBlock(x, y, z);
          if (ORE_BLOCKS.has(b)) {
            // An ore here must mean this voxel was STONE before (y in 8..40).
            expect(y).toBeGreaterThanOrEqual(8);
            expect(y).toBeLessThanOrEqual(40);
          } else {
            // Non-ore voxels keep their original block.
            const original: BlockId = y < 8 ? Blocks.DIRT : y <= 40 ? Blocks.STONE : Blocks.AIR;
            expect(b).toBe(original);
          }
        }
      }
    }
  });
});

describe("DIAMOND_ORE distribution sanity", () => {
  it("appears, stays within [minY,maxY], and averages a plausible amount", () => {
    const entry = diamondEntry();
    const COLUMNS = 50;
    let total = 0;

    for (let i = 0; i < COLUMNS; i++) {
      const c = stoneColumn(i, i * 7);
      generateOres(c, 2024);
      for (let z = 0; z < SIZE; z++) {
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          for (let x = 0; x < SIZE; x++) {
            if (c.getBlock(x, y, z) === Blocks.DIAMOND_ORE) {
              total++;
              expect(y).toBeGreaterThanOrEqual(entry.minY);
              expect(y).toBeLessThanOrEqual(Math.min(entry.maxY, WORLD_HEIGHT - 1));
            }
          }
        }
      }
    }

    expect(total).toBeGreaterThan(0);
    const avg = total / COLUMNS;
    expect(avg).toBeGreaterThanOrEqual(1);
    expect(avg).toBeLessThanOrEqual(40);
  });

  it("biases placement toward bestY", () => {
    const entry = diamondEntry();
    const COLUMNS = 80;
    let near = 0; // within 4 of bestY
    let far = 0; // 8+ away from bestY (but still in band)

    for (let i = 0; i < COLUMNS; i++) {
      const c = stoneColumn(i * 3, i);
      generateOres(c, 7);
      for (let z = 0; z < SIZE; z++) {
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          for (let x = 0; x < SIZE; x++) {
            if (c.getBlock(x, y, z) === Blocks.DIAMOND_ORE) {
              const d = Math.abs(y - entry.bestY);
              if (d <= 4) near++;
              else if (d >= 8) far++;
            }
          }
        }
      }
    }

    // Peak at bestY ⇒ markedly more diamonds near bestY than far from it.
    expect(near).toBeGreaterThan(far);
  });
});

describe("EC9 air-exposure penalty for diamonds", () => {
  it("places fewer diamonds adjacent to air than an all-stone control", () => {
    // Control: fully solid stone columns. Test: same, but a wide AIR cap above
    // the diamond band so many candidate diamond voxels are air-exposed.
    const COLUMNS = 60;

    function countDiamonds(c: ChunkColumn): number {
      let n = 0;
      for (let z = 0; z < SIZE; z++) {
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          for (let x = 0; x < SIZE; x++) {
            if (c.getBlock(x, y, z) === Blocks.DIAMOND_ORE) n++;
          }
        }
      }
      return n;
    }

    let control = 0;
    let exposed = 0;

    for (let i = 0; i < COLUMNS; i++) {
      // Control: all stone.
      const ctrl = stoneColumn(i, 1000 + i);
      generateOres(ctrl, 31415);
      control += countDiamonds(ctrl);

      // Exposed: stone only in y 0..2, AIR everywhere above. Diamond band is
      // y 0..16, so most candidate voxels sit directly under / beside air.
      const exp = new ChunkColumn(i, 1000 + i);
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        exp.fillLayer(y, y <= 2 ? Blocks.STONE : Blocks.AIR);
      }
      generateOres(exp, 31415);
      exposed += countDiamonds(exp);
    }

    // Even before the air penalty the exposed column has far fewer stone
    // voxels, so this is a loose directional check: exposed < control.
    expect(exposed).toBeLessThan(control);
  });

  it("halves placement probability for an isolated air-exposed candidate (statistical)", () => {
    // Build many single-voxel STONE targets, one per column, surrounded by
    // air, and compare diamond hit-rate against fully-stone neighborhoods.
    // We isolate the diamond entry by checking placement at a fixed candidate.
    const COLUMNS = 400;
    const Y = diamondEntry().bestY;

    let exposedHits = 0;
    let solidHits = 0;

    for (let i = 0; i < COLUMNS; i++) {
      // Solid: 3x3x3 stone block centered on candidate (no air neighbors).
      const solid = new ChunkColumn(i, 50_000 + i);
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        solid.fillLayer(y, Blocks.STONE);
      }
      generateOres(solid, 8675309);

      // Exposed: a thin stone slab so candidate voxels are air-adjacent.
      const exposed = new ChunkColumn(i, 50_000 + i);
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        exposed.fillLayer(y, y === Y ? Blocks.STONE : Blocks.AIR);
      }
      generateOres(exposed, 8675309);

      for (let z = 0; z < SIZE; z++) {
        for (let x = 0; x < SIZE; x++) {
          if (solid.getBlock(x, Y, z) === Blocks.DIAMOND_ORE) solidHits++;
          if (exposed.getBlock(x, Y, z) === Blocks.DIAMOND_ORE) exposedHits++;
        }
      }
    }

    // Air-exposed candidates are gated at 50%, so they should be placed
    // strictly less often than the same candidates in solid stone.
    expect(exposedHits).toBeLessThan(solidHits);
    expect(exposedHits).toBeGreaterThan(0);
  });
});
