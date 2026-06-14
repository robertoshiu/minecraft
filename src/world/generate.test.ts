import { describe, it, expect } from "vitest";
import { Blocks, CHUNK, ORE_TABLE } from "../rules/mc-1.20";
import { generateColumn, generateColumnWithLight } from "./generate";
import { skylightAt } from "./lighting";
import type { ChunkColumn } from "../chunk/column";

const SEED = 2024;
const SIZE = CHUNK.SIZE; // 16
const HEIGHT = CHUNK.HEIGHT; // 256

const ORE_BLOCKS: ReadonlySet<number> = new Set(ORE_TABLE.map((e) => e.block));

describe("generateColumn determinism", () => {
  it("two columns with the same coords+seed are voxel-identical across all sections", () => {
    const a = generateColumn(3, -5, SEED);
    const b = generateColumn(3, -5, SEED);
    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        for (let y = 0; y < HEIGHT; y++) {
          expect(a.getBlock(lx, y, lz)).toBe(b.getBlock(lx, y, lz));
        }
      }
    }
  });
});

describe("generateColumn structure", () => {
  it("places BEDROCK at y=0 everywhere", () => {
    const col = generateColumn(7, 11, SEED);
    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        expect(col.getBlock(lx, 0, lz)).toBe(Blocks.BEDROCK);
      }
    }
  });

  it("has a surface in a sane range and never broken (left as air) by caves", () => {
    const col = generateColumn(2, 2, SEED);
    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        const h = col.surfaceHeight(lx, lz);
        expect(h).toBeGreaterThanOrEqual(1);
        expect(h).toBeLessThanOrEqual(200);
        // The block at the surface must be solid (non-air): caves run below the
        // surface clamp, so the top is never punched through.
        expect(col.getBlock(lx, h, lz)).not.toBe(Blocks.AIR);
      }
    }
  });
});

describe("generateColumn ore presence", () => {
  it("produces some ore blocks across ~30 columns at varied coords", () => {
    let oreCount = 0;
    let n = 0;
    for (let cx = 0; cx < 6 && n < 30; cx++) {
      for (let cz = 0; cz < 5 && n < 30; cz++) {
        const col = generateColumn(cx * 7 - 13, cz * 9 + 4, SEED);
        n++;
        for (let lx = 0; lx < SIZE; lx++) {
          for (let lz = 0; lz < SIZE; lz++) {
            for (let y = 0; y < HEIGHT; y++) {
              if (ORE_BLOCKS.has(col.getBlock(lx, y, lz))) oreCount++;
            }
          }
        }
      }
    }
    expect(n).toBe(30);
    expect(oreCount).toBeGreaterThan(0);
  });
});

describe("generateColumnWithLight", () => {
  it("returns a 16*16*256 LightMap; surface-and-above are 15, deep underground (y=2) is 0", () => {
    const { column, light } = generateColumnWithLight(3, -5, SEED);
    expect(light).toBeInstanceOf(Uint8Array);
    expect(light.length).toBe(SIZE * SIZE * HEIGHT);

    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        const h = column.surfaceHeight(lx, lz);
        // Strictly above the (opaque) surface: open to sky -> 15.
        expect(skylightAt(light, lx, h + 1, lz)).toBe(15);
        // y=2 is well below any surface here -> dark.
        expect(skylightAt(light, lx, 2, lz)).toBe(0);
      }
    }
  });

  it("the returned column is a ChunkColumn at the requested coords", () => {
    const { column } = generateColumnWithLight(3, -5, SEED);
    const c: ChunkColumn = column;
    expect(c.columnX).toBe(3);
    expect(c.columnZ).toBe(-5);
  });
});
