import { describe, it, expect } from "vitest";
import { World } from "./world";
import { Blocks } from "../rules/mc-1.20";

const SEED = 1337;

describe("World — coordinate mapping & block access", () => {
  it("round-trips setBlock/getBlock within one column", () => {
    const world = new World(SEED);
    world.setBlock(3, 70, 5, Blocks.STONE);
    expect(world.getBlock(3, 70, 5)).toBe(Blocks.STONE);
  });

  it("maps negative world coords across the column boundary (wx=-1 → column -1 local 15)", () => {
    const world = new World(SEED);
    world.setBlock(-1, 70, -1, Blocks.OAK_PLANKS);

    // wx=-1 lives in column -1 at local x=15.
    const column = world.getColumn(-1, -1);
    expect(column).toBeDefined();
    expect(column?.getBlock(15, 70, 15)).toBe(Blocks.OAK_PLANKS);
    // And reading back through the world layer agrees.
    expect(world.getBlock(-1, 70, -1)).toBe(Blocks.OAK_PLANKS);
  });

  it("writes on opposite sides of a column boundary land in different columns", () => {
    const world = new World(SEED);
    world.setBlock(15, 70, 0, Blocks.STONE); // column 0, local 15
    world.setBlock(16, 70, 0, Blocks.GLASS); // column 1, local 0
    expect(world.getColumn(0, 0)?.getBlock(15, 70, 0)).toBe(Blocks.STONE);
    expect(world.getColumn(1, 0)?.getBlock(0, 70, 0)).toBe(Blocks.GLASS);
    expect(world.getBlock(15, 70, 0)).toBe(Blocks.STONE);
    expect(world.getBlock(16, 70, 0)).toBe(Blocks.GLASS);
  });

  it("isSolidAt: true for stone, false for air and water", () => {
    const world = new World(SEED);
    world.setBlock(0, 70, 0, Blocks.STONE);
    world.setBlock(0, 71, 0, Blocks.WATER);
    expect(world.isSolidAt(0, 70, 0)).toBe(true);
    expect(world.isSolidAt(0, 71, 0)).toBe(false); // water is non-solid
    expect(world.isSolidAt(0, 72, 0)).toBe(false); // air
  });

  it("reads AIR from a missing (ungenerated) column without generating it", () => {
    const world = new World(SEED);
    expect(world.getBlock(1000, 70, 1000)).toBe(Blocks.AIR);
    expect(world.getColumn(62, 62)).toBeUndefined();
  });

  it("returns AIR for out-of-range Y", () => {
    const world = new World(SEED);
    world.setBlock(0, 70, 0, Blocks.STONE);
    expect(world.getBlock(0, -1, 0)).toBe(Blocks.AIR);
    expect(world.getBlock(0, 256, 0)).toBe(Blocks.AIR);
  });

  it("ensureColumn generates terrain (surface block is solid)", () => {
    const world = new World(SEED);
    const column = world.ensureColumn(0, 0);
    const surfaceY = column.surfaceHeight(0, 0);
    expect(surfaceY).toBeGreaterThan(0);
    expect(world.isSolidAt(0, surfaceY, 0)).toBe(true);
    // ensureColumn is idempotent: same instance on a second call.
    expect(world.ensureColumn(0, 0)).toBe(column);
  });
});
