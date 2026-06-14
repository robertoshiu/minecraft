import { describe, it, expect } from "vitest";
import { Blocks } from "../rules/mc-1.20";
import { Chunk, ChunkOutOfBoundsError, type FaceDir } from "./data";

describe("Chunk (16x16x16 voxel section)", () => {
  it("defaults to all AIR (isEmpty) and reports section coords", () => {
    const c = new Chunk();
    expect(c.isEmpty()).toBe(true);
    expect(c.get(0, 0, 0)).toBe(Blocks.AIR);
    expect(c.get(15, 15, 15)).toBe(Blocks.AIR);
    expect(c.sx).toBe(0);
    expect(c.sy).toBe(0);
    expect(c.sz).toBe(0);
  });

  it("stores constructor section coords", () => {
    const c = new Chunk(2, 3, -4);
    expect(c.sx).toBe(2);
    expect(c.sy).toBe(3);
    expect(c.sz).toBe(-4);
  });

  it("round-trips get/set for arbitrary cells", () => {
    const c = new Chunk();
    c.set(1, 2, 3, Blocks.STONE);
    c.set(7, 8, 9, Blocks.DIRT);
    expect(c.get(1, 2, 3)).toBe(Blocks.STONE);
    expect(c.get(7, 8, 9)).toBe(Blocks.DIRT);
    expect(c.get(0, 0, 0)).toBe(Blocks.AIR);
    expect(c.isEmpty()).toBe(false);
  });

  it("set at the two corner cells (0,0,0) and (15,15,15)", () => {
    const c = new Chunk();
    c.set(0, 0, 0, Blocks.GRASS);
    c.set(15, 15, 15, Blocks.BEDROCK);
    expect(c.get(0, 0, 0)).toBe(Blocks.GRASS);
    expect(c.get(15, 15, 15)).toBe(Blocks.BEDROCK);
  });

  it("fill sets every cell and is not empty afterwards", () => {
    const c = new Chunk();
    c.fill(Blocks.SAND);
    expect(c.isEmpty()).toBe(false);
    expect(c.get(0, 0, 0)).toBe(Blocks.SAND);
    expect(c.get(15, 0, 0)).toBe(Blocks.SAND);
    expect(c.get(0, 15, 0)).toBe(Blocks.SAND);
    expect(c.get(0, 0, 15)).toBe(Blocks.SAND);
    expect(c.get(15, 15, 15)).toBe(Blocks.SAND);
  });

  it("fill(AIR) makes a chunk empty again", () => {
    const c = new Chunk();
    c.fill(Blocks.STONE);
    expect(c.isEmpty()).toBe(false);
    c.fill(Blocks.AIR);
    expect(c.isEmpty()).toBe(true);
  });

  it("clone produces an independent copy (same coords, decoupled data)", () => {
    const a = new Chunk(1, 2, 3);
    a.set(5, 6, 7, Blocks.IRON_ORE);
    const b = a.clone();
    expect(b.sx).toBe(1);
    expect(b.sy).toBe(2);
    expect(b.sz).toBe(3);
    expect(b.get(5, 6, 7)).toBe(Blocks.IRON_ORE);
    // mutating the clone must not affect the original
    b.set(5, 6, 7, Blocks.GOLD_ORE);
    expect(b.get(5, 6, 7)).toBe(Blocks.GOLD_ORE);
    expect(a.get(5, 6, 7)).toBe(Blocks.IRON_ORE);
  });

  it("clone copies merged borders independently", () => {
    const a = new Chunk();
    const border = new Uint16Array(256).fill(Blocks.WATER);
    a.mergeNeighborBorder("px", border);
    const b = a.clone();
    const bb = b.getBorder("px");
    expect(bb).not.toBeNull();
    expect(bb?.[0]).toBe(Blocks.WATER);
    // mutating clone border does not affect original
    bb?.set([Blocks.LAVA], 0);
    expect(a.getBorder("px")?.[0]).toBe(Blocks.WATER);
  });

  it("idx maps (x,y,z) to x + y*16 + z*256 (corner sanity via order)", () => {
    const c = new Chunk();
    // Distinguish x, y, z axes: set each unit-axis cell to a distinct id.
    c.set(1, 0, 0, Blocks.STONE); // idx 1
    c.set(0, 1, 0, Blocks.DIRT); // idx 16
    c.set(0, 0, 1, Blocks.SAND); // idx 256
    expect(c.get(1, 0, 0)).toBe(Blocks.STONE);
    expect(c.get(0, 1, 0)).toBe(Blocks.DIRT);
    expect(c.get(0, 0, 1)).toBe(Blocks.SAND);
  });

  it("getNeighborBorder returns a 256-length slice on every face", () => {
    const c = new Chunk();
    const dirs: FaceDir[] = ["px", "nx", "py", "ny", "pz", "nz"];
    for (const d of dirs) {
      expect(c.getNeighborBorder(d).length).toBe(256);
    }
  });

  it("getNeighborBorder('px') reads the x=15 plane indexed by (y,z)", () => {
    const c = new Chunk();
    // place a marker at x=15, y=2, z=3 -> border index y + z*16 = 2 + 48 = 50
    c.set(15, 2, 3, Blocks.GLASS);
    const border = c.getNeighborBorder("px");
    expect(border[2 + 3 * 16]).toBe(Blocks.GLASS);
    expect(border[0]).toBe(Blocks.AIR);
  });

  it("getNeighborBorder('ny') reads the y=0 plane indexed by (x,z)", () => {
    const c = new Chunk();
    // y=0 plane, marker at x=4, z=5 -> index x + z*16 = 4 + 80 = 84
    c.set(4, 0, 5, Blocks.COBBLESTONE);
    const border = c.getNeighborBorder("ny");
    expect(border[4 + 5 * 16]).toBe(Blocks.COBBLESTONE);
  });

  it("getNeighborBorder('pz') reads the z=15 plane indexed by (x,y)", () => {
    const c = new Chunk();
    c.set(6, 7, 15, Blocks.OAK_LOG);
    const border = c.getNeighborBorder("pz");
    expect(border[6 + 7 * 16]).toBe(Blocks.OAK_LOG);
  });

  it("mergeNeighborBorder round-trips through getBorder", () => {
    const c = new Chunk();
    expect(c.getBorder("nx")).toBeNull();
    const data = new Uint16Array(256);
    data[10] = Blocks.SNOW;
    c.mergeNeighborBorder("nx", data);
    const got = c.getBorder("nx");
    expect(got).not.toBeNull();
    expect(got?.length).toBe(256);
    expect(got?.[10]).toBe(Blocks.SNOW);
    expect(got?.[0]).toBe(Blocks.AIR);
  });

  it("mergeNeighborBorder throws on wrong-length data", () => {
    const c = new Chunk();
    expect(() => c.mergeNeighborBorder("py", new Uint16Array(255))).toThrow();
    expect(() => c.mergeNeighborBorder("py", new Uint16Array(257))).toThrow();
  });

  it("get throws ChunkOutOfBoundsError for out-of-range coords", () => {
    const c = new Chunk();
    expect(() => c.get(-1, 0, 0)).toThrow(ChunkOutOfBoundsError);
    expect(() => c.get(16, 0, 0)).toThrow(ChunkOutOfBoundsError);
    expect(() => c.get(0, 16, 0)).toThrow(ChunkOutOfBoundsError);
    expect(() => c.get(0, 0, 16)).toThrow(ChunkOutOfBoundsError);
  });

  it("set throws ChunkOutOfBoundsError for out-of-range coords", () => {
    const c = new Chunk();
    expect(() => c.set(0, -1, 0, Blocks.STONE)).toThrow(ChunkOutOfBoundsError);
    expect(() => c.set(0, 0, 99, Blocks.STONE)).toThrow(ChunkOutOfBoundsError);
  });
});
