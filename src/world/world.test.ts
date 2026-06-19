import { describe, it, expect, vi } from "vitest";
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

describe("World — subscribeColumnLoaded", () => {
  it("fires exactly once on a fresh ensureColumn and NOT on a repeated ensureColumn", () => {
    const world = new World(SEED);
    const fn = vi.fn();
    world.subscribeColumnLoaded(fn);

    world.ensureColumn(5, 5);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(5, 5);

    // Second call to same column: cache hit, must NOT fire again.
    world.ensureColumn(5, 5);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fires with correct cx, cz arguments for multiple different columns", () => {
    const world = new World(SEED);
    const calls: [number, number][] = [];
    world.subscribeColumnLoaded((cx, cz) => calls.push([cx, cz]));

    world.ensureColumn(0, 0);
    world.ensureColumn(1, 2);
    world.ensureColumn(-3, 4);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual([0, 0]);
    expect(calls[1]).toEqual([1, 2]);
    expect(calls[2]).toEqual([-3, 4]);
  });

  it("fires all multiple subscribers when a column is freshly generated", () => {
    const world = new World(SEED);
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    const fn3 = vi.fn();
    world.subscribeColumnLoaded(fn1);
    world.subscribeColumnLoaded(fn2);
    world.subscribeColumnLoaded(fn3);

    world.ensureColumn(0, 0);

    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(fn3).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops further callbacks", () => {
    const world = new World(SEED);
    const fn = vi.fn();
    const unsub = world.subscribeColumnLoaded(fn);

    world.ensureColumn(0, 0);
    expect(fn).toHaveBeenCalledTimes(1);

    unsub();

    world.ensureColumn(1, 1); // fresh column, but listener removed
    expect(fn).toHaveBeenCalledTimes(1); // still only 1
  });

  it("suppressColumnLoaded=true prevents dispatch", () => {
    const world = new World(SEED);
    const fn = vi.fn();
    world.subscribeColumnLoaded(fn);
    world.suppressColumnLoaded = true;

    world.ensureColumn(0, 0); // fresh, but suppressed
    expect(fn).not.toHaveBeenCalled();
  });

  it("setBlock into an ungenerated column does NOT fire the column-loaded listener", () => {
    const world = new World(SEED);
    const fn = vi.fn();
    world.subscribeColumnLoaded(fn);

    // Writing to a block in a column that has not been generated yet.
    world.setBlock(0, 70, 0, Blocks.STONE);

    // The setBlock path suppresses the listener — blockChanged handles remesh.
    expect(fn).not.toHaveBeenCalled();
  });

  it("setBlock into an already-generated column does NOT fire the listener", () => {
    const world = new World(SEED);
    world.ensureColumn(0, 0); // pre-generate

    const fn = vi.fn();
    world.subscribeColumnLoaded(fn);

    world.setBlock(0, 70, 0, Blocks.STONE); // existing column → no event
    expect(fn).not.toHaveBeenCalled();
  });
});
