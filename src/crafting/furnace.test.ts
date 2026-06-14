import { describe, it, expect } from "vitest";
import { Blocks, SMELT } from "../rules/mc-1.20";
import { Items } from "../rules/items";
import { makeStack } from "../inventory/stack";
import { Furnace } from "./furnace";

/** Run `n` ticks on a furnace. */
function run(f: Furnace, n: number): void {
  for (let i = 0; i < n; i++) f.tick();
}

describe("Furnace — basic smelting", () => {
  it("iron ore + 1 coal: smelts one ingot after TICKS_PER_ITEM ticks", () => {
    const f = new Furnace();
    f.input = makeStack(Blocks.IRON_ORE, 1);
    f.fuel = makeStack(Items.COAL, 1);

    run(f, SMELT.TICKS_PER_ITEM);

    expect(f.output?.itemId).toBe(Items.IRON_INGOT);
    expect(f.output?.count).toBe(1);
    expect(f.input).toBeNull(); // single ore consumed
    // One coal smelts 8 items; after 1 item there is leftover burn time.
    expect(f.fuel).toBeNull(); // the single coal was consumed to ignite
    expect(f.burnTicksRemaining).toBeGreaterThan(0);
  });

  it("smelts multiple ores from a single coal (coal = 8 items)", () => {
    const f = new Furnace();
    f.input = makeStack(Blocks.IRON_ORE, 3);
    f.fuel = makeStack(Items.COAL, 1);

    run(f, SMELT.TICKS_PER_ITEM * 3);

    expect(f.output?.itemId).toBe(Items.IRON_INGOT);
    expect(f.output?.count).toBe(3);
    expect(f.input).toBeNull();
    // 1 coal = 1600 ticks = 8 items; 3 smelted ⇒ 5 items of heat remain.
    expect(f.burnTicksRemaining).toBe(SMELT.TICKS_PER_ITEM * 5);
  });

  it("consumes a second coal only when the first runs out", () => {
    const f = new Furnace();
    f.input = makeStack(Blocks.IRON_ORE, 9); // needs > 8 items of fuel
    f.fuel = makeStack(Items.COAL, 2);

    run(f, SMELT.TICKS_PER_ITEM * 9);

    expect(f.output?.count).toBe(9);
    expect(f.input).toBeNull();
    expect(f.fuel).toBeNull(); // both coal needed (9 > 8)
  });
});

describe("Furnace — stalls", () => {
  it("empty input → no progress, no fuel consumed", () => {
    const f = new Furnace();
    f.fuel = makeStack(Items.COAL, 1);

    run(f, SMELT.TICKS_PER_ITEM * 2);

    expect(f.output).toBeNull();
    expect(f.cookProgress).toBe(0);
    expect(f.fuel?.count).toBe(1); // untouched
    expect(f.burnTicksRemaining).toBe(0);
  });

  it("input present but no fuel → no progress", () => {
    const f = new Furnace();
    f.input = makeStack(Blocks.IRON_ORE, 1);

    run(f, SMELT.TICKS_PER_ITEM * 2);

    expect(f.output).toBeNull();
    expect(f.cookProgress).toBe(0);
    expect(f.input?.count).toBe(1);
  });

  it("non-smeltable input → no progress even with fuel", () => {
    const f = new Furnace();
    f.input = makeStack(Items.DIAMOND, 1);
    f.fuel = makeStack(Items.COAL, 1);

    run(f, SMELT.TICKS_PER_ITEM);

    expect(f.output).toBeNull();
    expect(f.fuel?.count).toBe(1); // never ignited
  });

  it("output full → smelting stalls", () => {
    const f = new Furnace();
    f.input = makeStack(Blocks.IRON_ORE, 1);
    f.fuel = makeStack(Items.COAL, 1);
    // Pre-fill output with a maxed ingot stack.
    f.output = makeStack(Items.IRON_INGOT, 64);

    run(f, SMELT.TICKS_PER_ITEM);

    expect(f.output?.count).toBe(64); // unchanged
    expect(f.input?.count).toBe(1); // not consumed
    expect(f.fuel?.count).toBe(1); // not ignited
  });
});

describe("Furnace — output stacking", () => {
  it("accumulates into an existing matching output stack", () => {
    const f = new Furnace();
    f.input = makeStack(Blocks.IRON_ORE, 2);
    f.fuel = makeStack(Items.COAL, 1);
    f.output = makeStack(Items.IRON_INGOT, 5);

    run(f, SMELT.TICKS_PER_ITEM * 2);

    expect(f.output?.itemId).toBe(Items.IRON_INGOT);
    expect(f.output?.count).toBe(7);
  });
});
