import { describe, it, expect } from "vitest";
import { Blocks, LIGHT, CHUNK } from "../rules/mc-1.20";
import { ChunkColumn } from "../chunk/column";
import { computeColumnSkylight, skylightAt, type LightMap } from "./lighting";

const SIZE = CHUNK.SIZE; // 16
const HEIGHT = CHUNK.HEIGHT; // 256

describe("LightMap layout", () => {
  it("computeColumnSkylight returns a 16*16*256 Uint8Array", () => {
    const col = new ChunkColumn(0, 0);
    const map: LightMap = computeColumnSkylight(col);
    expect(map).toBeInstanceOf(Uint8Array);
    expect(map.length).toBe(SIZE * SIZE * HEIGHT);
  });
});

describe("computeColumnSkylight — stone floor, air above", () => {
  it("is 15 above and at the opening, 0 at and below the highest opaque block", () => {
    const col = new ChunkColumn(0, 0);
    // Stone y=0..100, air y=101..255.
    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        for (let y = 0; y <= 100; y++) {
          col.setBlock(lx, y, lz, Blocks.STONE);
        }
      }
    }
    const map = computeColumnSkylight(col);

    // Representative column (5, 9).
    expect(skylightAt(map, 5, 150, 9)).toBe(15);
    expect(skylightAt(map, 5, 101, 9)).toBe(15);
    expect(skylightAt(map, 5, 100, 9)).toBe(0);
    expect(skylightAt(map, 5, 50, 9)).toBe(0);

    // Holds across every column.
    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        expect(skylightAt(map, lx, 150, lz)).toBe(15);
        expect(skylightAt(map, lx, 101, lz)).toBe(15);
        expect(skylightAt(map, lx, 100, lz)).toBe(0);
        expect(skylightAt(map, lx, 0, lz)).toBe(0);
      }
    }
  });
});

describe("computeColumnSkylight — all-air column", () => {
  it("every cell is SKY_MAX (15)", () => {
    const col = new ChunkColumn(0, 0);
    const map = computeColumnSkylight(col);
    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
        for (let y = 0; y < HEIGHT; y++) {
          expect(skylightAt(map, lx, y, lz)).toBe(LIGHT.SKY_MAX);
        }
      }
    }
  });
});

describe("computeColumnSkylight — non-opaque GLASS does not block", () => {
  it("light passes through glass to the cells above the stone floor", () => {
    const col = new ChunkColumn(0, 0);
    const lx = 3;
    const lz = 7;
    // Stone floor y=0..10, then air gap, GLASS at the very top (y=255).
    for (let y = 0; y <= 10; y++) {
      col.setBlock(lx, y, lz, Blocks.STONE);
    }
    col.setBlock(lx, 255, lz, Blocks.GLASS);

    const map = computeColumnSkylight(col);

    // Glass itself: non-opaque, open to sky -> 15.
    expect(skylightAt(map, lx, 255, lz)).toBe(15);
    // Cells between glass and stone floor: glass didn't block -> 15.
    for (let y = 11; y <= 254; y++) {
      expect(skylightAt(map, lx, y, lz)).toBe(15);
    }
    // Highest opaque (stone top, y=10) and everything below -> 0.
    expect(skylightAt(map, lx, 10, lz)).toBe(0);
    for (let y = 0; y <= 10; y++) {
      expect(skylightAt(map, lx, y, lz)).toBe(0);
    }
  });
});

describe("skylightAt — satisfies mob-spawn light thresholds", () => {
  it("open surface >= PASSIVE_MIN, deep underground <= HOSTILE_MAX", () => {
    const col = new ChunkColumn(0, 0);
    for (let y = 0; y <= 80; y++) {
      col.setBlock(0, y, 0, Blocks.STONE);
    }
    const map = computeColumnSkylight(col);
    expect(skylightAt(map, 0, 200, 0)).toBeGreaterThanOrEqual(LIGHT.PASSIVE_MIN);
    expect(skylightAt(map, 0, 40, 0)).toBeLessThanOrEqual(LIGHT.HOSTILE_MAX);
  });
});

describe("skylightAt — out-of-range is guarded", () => {
  it("throws for coordinates outside the valid ranges", () => {
    const col = new ChunkColumn(0, 0);
    const map = computeColumnSkylight(col);
    expect(() => skylightAt(map, -1, 0, 0)).toThrow();
    expect(() => skylightAt(map, 16, 0, 0)).toThrow();
    expect(() => skylightAt(map, 0, -1, 0)).toThrow();
    expect(() => skylightAt(map, 0, 256, 0)).toThrow();
    expect(() => skylightAt(map, 0, 0, -1)).toThrow();
    expect(() => skylightAt(map, 0, 0, 16)).toThrow();
    // Non-integer coordinates are also rejected.
    expect(() => skylightAt(map, 0.5, 0, 0)).toThrow();
  });
});
