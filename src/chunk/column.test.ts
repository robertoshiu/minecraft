import { describe, it, expect } from "vitest";
import { Blocks } from "../rules/mc-1.20";
import { Chunk } from "./data";
import { ChunkColumn } from "./column";

describe("ChunkColumn (16x16, 256 tall = 16 stacked sections)", () => {
  it("creates 16 sections eagerly with correct section coords", () => {
    const col = new ChunkColumn(3, -2);
    expect(col.columnX).toBe(3);
    expect(col.columnZ).toBe(-2);
    expect(col.sections.length).toBe(16);
    for (let sy = 0; sy < 16; sy++) {
      const s = col.sections[sy];
      expect(s).toBeInstanceOf(Chunk);
      expect(s?.sx).toBe(3);
      expect(s?.sy).toBe(sy);
      expect(s?.sz).toBe(-2);
    }
  });

  it("getBlock/setBlock round-trips across the full height", () => {
    const col = new ChunkColumn(0, 0);
    col.setBlock(1, 0, 2, Blocks.BEDROCK);
    col.setBlock(1, 255, 2, Blocks.SNOW);
    col.setBlock(5, 130, 9, Blocks.STONE);
    expect(col.getBlock(1, 0, 2)).toBe(Blocks.BEDROCK);
    expect(col.getBlock(1, 255, 2)).toBe(Blocks.SNOW);
    expect(col.getBlock(5, 130, 9)).toBe(Blocks.STONE);
    expect(col.getBlock(0, 0, 0)).toBe(Blocks.AIR);
  });

  it("routes worldY to the correct section and local y", () => {
    const col = new ChunkColumn(0, 0);
    // worldY 0 -> section 0, local y 0
    col.setBlock(2, 0, 3, Blocks.DIRT);
    expect(col.sections[0]?.get(2, 0, 3)).toBe(Blocks.DIRT);

    // worldY 17 -> section 1 (17>>4), local y 1 (17&15)
    col.setBlock(2, 17, 3, Blocks.GRASS);
    expect(col.sections[1]?.get(2, 1, 3)).toBe(Blocks.GRASS);

    // worldY 255 -> section 15, local y 15
    col.setBlock(2, 255, 3, Blocks.SAND);
    expect(col.sections[15]?.get(2, 15, 3)).toBe(Blocks.SAND);

    // worldY 64 -> section 4 (64>>4), local y 0 (64&15)
    col.setBlock(2, 64, 3, Blocks.WATER);
    expect(col.sections[4]?.get(2, 0, 3)).toBe(Blocks.WATER);
  });

  it("setBlock at worldY=0 and worldY=255 both work", () => {
    const col = new ChunkColumn(0, 0);
    col.setBlock(0, 0, 0, Blocks.STONE);
    col.setBlock(15, 255, 15, Blocks.GLASS);
    expect(col.getBlock(0, 0, 0)).toBe(Blocks.STONE);
    expect(col.getBlock(15, 255, 15)).toBe(Blocks.GLASS);
  });

  it("surfaceHeight returns the highest non-air worldY", () => {
    const col = new ChunkColumn(0, 0);
    col.setBlock(8, 60, 8, Blocks.STONE);
    col.setBlock(8, 61, 8, Blocks.DIRT);
    col.setBlock(8, 62, 8, Blocks.GRASS);
    expect(col.surfaceHeight(8, 8)).toBe(62);
  });

  it("surfaceHeight ignores AIR above the surface and other columns' cells", () => {
    const col = new ChunkColumn(0, 0);
    col.setBlock(4, 70, 4, Blocks.STONE);
    // a different (lx,lz) does not affect this column's surface
    expect(col.surfaceHeight(5, 5)).toBe(-1);
    expect(col.surfaceHeight(4, 4)).toBe(70);
  });

  it("surfaceHeight is -1 for an all-air column", () => {
    const col = new ChunkColumn(0, 0);
    expect(col.surfaceHeight(0, 0)).toBe(-1);
    expect(col.surfaceHeight(15, 15)).toBe(-1);
  });

  it("surfaceHeight finds a block at the very top (worldY=255)", () => {
    const col = new ChunkColumn(0, 0);
    col.setBlock(10, 255, 10, Blocks.SNOW);
    expect(col.surfaceHeight(10, 10)).toBe(255);
  });

  it("surfaceHeight finds a block at the very bottom (worldY=0)", () => {
    const col = new ChunkColumn(0, 0);
    col.setBlock(11, 0, 11, Blocks.BEDROCK);
    expect(col.surfaceHeight(11, 11)).toBe(0);
  });

  it("fillLayer fills the whole 16x16 plane at a worldY", () => {
    const col = new ChunkColumn(0, 0);
    col.fillLayer(40, Blocks.STONE);
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        expect(col.getBlock(lx, 40, lz)).toBe(Blocks.STONE);
      }
    }
    // layer above is still air
    expect(col.getBlock(0, 41, 0)).toBe(Blocks.AIR);
    expect(col.surfaceHeight(7, 7)).toBe(40);
  });

  it("getBlock throws for out-of-range worldY / local coords", () => {
    const col = new ChunkColumn(0, 0);
    expect(() => col.getBlock(0, -1, 0)).toThrow();
    expect(() => col.getBlock(0, 256, 0)).toThrow();
    expect(() => col.getBlock(-1, 0, 0)).toThrow();
    expect(() => col.getBlock(16, 0, 0)).toThrow();
  });
});
