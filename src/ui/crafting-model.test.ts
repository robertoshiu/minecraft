import { describe, it, expect } from "vitest";
import { HandCraftModel, outputFor, craftOnce, WorkbenchModel, outputFor3x3, craftOnceWorkbench } from "./crafting-model";
import { Inventory } from "../inventory/inventory";
import { makeStack } from "../inventory/stack";
import { Blocks } from "../rules/mc-1.20";
import { Items } from "../rules/items";

describe("outputFor (2×2 hand-craft grid)", () => {
  it("returns null for an empty grid", () => {
    expect(outputFor([null, null, null, null])).toBeNull();
  });

  it("yields 4 planks from a single oak log placed in any cell", () => {
    // Shapeless 1 log -> 4 planks; cell position is irrelevant after trim.
    const cells = [Blocks.OAK_LOG, null, null, null];
    const out = outputFor(cells);
    expect(out).not.toBeNull();
    expect(out?.result).toBe(Blocks.OAK_PLANKS);
    expect(out?.count).toBe(4);

    const out2 = outputFor([null, null, null, Blocks.OAK_LOG]);
    expect(out2?.result).toBe(Blocks.OAK_PLANKS);
  });

  it("matches a 2×2 planks -> crafting table", () => {
    const p = Blocks.OAK_PLANKS;
    const out = outputFor([p, p, p, p]);
    expect(out?.result).toBe(Blocks.CRAFTING_TABLE);
    expect(out?.count).toBe(1);
  });

  it("returns null for a non-recipe arrangement", () => {
    const out = outputFor([Blocks.STONE, Blocks.DIRT, null, null]);
    expect(out).toBeNull();
  });
});

describe("HandCraftModel", () => {
  it("starts empty with 4 cells and null output", () => {
    const m = new HandCraftModel();
    expect(m.grid.length).toBe(4);
    expect(m.isEmpty()).toBe(true);
    expect(m.output()).toBeNull();
  });

  it("placing an oak log in a cell produces a planks output", () => {
    const m = new HandCraftModel();
    m.setCell(0, Blocks.OAK_LOG);
    expect(m.isEmpty()).toBe(false);
    expect(m.output()?.result).toBe(Blocks.OAK_PLANKS);
    expect(m.output()?.count).toBe(4);
  });

  it("clear() empties all cells", () => {
    const m = new HandCraftModel();
    m.setCell(1, Blocks.OAK_LOG);
    m.clear();
    expect(m.isEmpty()).toBe(true);
  });
});

describe("craftOnce", () => {
  it("consumes one log and adds 4 planks to the inventory", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.OAK_LOG, 3));
    const m = new HandCraftModel();
    m.setCell(0, Blocks.OAK_LOG);

    const ok = craftOnce(m, inv);
    expect(ok).toBe(true);
    expect(inv.count(Blocks.OAK_LOG)).toBe(2);
    expect(inv.count(Blocks.OAK_PLANKS)).toBe(4);
    // Still 2 logs backing the cell -> cell remains populated.
    expect(m.cell(0)).toBe(Blocks.OAK_LOG);
  });

  it("clears the grid cell when the last backing input is consumed", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.OAK_LOG, 1));
    const m = new HandCraftModel();
    m.setCell(0, Blocks.OAK_LOG);

    expect(craftOnce(m, inv)).toBe(true);
    expect(inv.count(Blocks.OAK_LOG)).toBe(0);
    expect(m.cell(0)).toBeNull();
  });

  it("crafts a table consuming 4 planks, one per cell", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.OAK_PLANKS, 4));
    const m = new HandCraftModel();
    const p = Blocks.OAK_PLANKS;
    m.setCell(0, p);
    m.setCell(1, p);
    m.setCell(2, p);
    m.setCell(3, p);

    expect(craftOnce(m, inv)).toBe(true);
    expect(inv.count(Blocks.OAK_PLANKS)).toBe(0);
    expect(inv.count(Blocks.CRAFTING_TABLE)).toBe(1);
  });

  it("refuses to craft an empty grid", () => {
    const inv = new Inventory();
    const m = new HandCraftModel();
    expect(craftOnce(m, inv)).toBe(false);
  });

  it("refuses when inputs are insufficient in the inventory", () => {
    // Grid shows 4 planks but the inventory holds only 3 — no craft, no change.
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.OAK_PLANKS, 3));
    const m = new HandCraftModel();
    const p = Blocks.OAK_PLANKS;
    m.setCell(0, p);
    m.setCell(1, p);
    m.setCell(2, p);
    m.setCell(3, p);

    expect(craftOnce(m, inv)).toBe(false);
    expect(inv.count(Blocks.OAK_PLANKS)).toBe(3);
    expect(inv.count(Blocks.CRAFTING_TABLE)).toBe(0);
  });

  it("refuses when the result cannot fit and leaves inventory unchanged", () => {
    const inv = new Inventory();
    // Fill all 36 slots full with stone so a planks result has nowhere to go,
    // except keep one log in a stone-full layout is impossible — instead fill
    // 35 slots with stone and the last with the input log only.
    for (let i = 0; i < Inventory.SLOTS - 1; i++) {
      inv.set(i, makeStack(Blocks.STONE, 64));
    }
    inv.set(Inventory.SLOTS - 1, makeStack(Blocks.OAK_LOG, 1));
    const m = new HandCraftModel();
    m.setCell(0, Blocks.OAK_LOG);

    // The only free room is the log slot, which becomes free as the log is the
    // input — but add() runs before consume, so 4 planks cannot be stored.
    expect(craftOnce(m, inv)).toBe(false);
    expect(inv.count(Blocks.OAK_LOG)).toBe(1);
    expect(inv.count(Blocks.OAK_PLANKS)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WorkbenchModel tests
// ---------------------------------------------------------------------------

describe("outputFor3x3", () => {
  it("returns null for an all-empty 9-cell grid", () => {
    const empty = new Array<null>(9).fill(null);
    expect(outputFor3x3(empty)).toBeNull();
  });

  it("crafts a furnace from 8 cobblestone in a ring (true 3×3 recipe)", () => {
    const C = Blocks.COBBLESTONE;
    const _ = null;
    // furnace: ring of 8 cobble, empty center
    const flat = [C, C, C, C, _, C, C, C, C];
    const out = outputFor3x3(flat);
    expect(out).not.toBeNull();
    expect(out?.result).toBe(Blocks.FURNACE);
    expect(out?.count).toBe(1);
  });

  it("crafts a wooden pickaxe (full 3×3 shaped recipe)", () => {
    const P = Blocks.OAK_PLANKS;
    const S = Items.STICK;
    const _ = null;
    // pickaxe: [P,P,P] / [_,S,_] / [_,S,_]
    const flat = [P, P, P, _, S, _, _, S, _];
    const out = outputFor3x3(flat);
    expect(out).not.toBeNull();
    expect(out?.result).toBe(Items.WOODEN_PICKAXE);
  });

  it("also matches a 2×2-equivalent recipe placed in top-left", () => {
    // 2×2 planks = crafting table; should still match in the 3×3 grid
    const P = Blocks.OAK_PLANKS;
    const _ = null;
    const flat = [P, P, _, P, P, _, _, _, _];
    const out = outputFor3x3(flat);
    expect(out?.result).toBe(Blocks.CRAFTING_TABLE);
  });
});

describe("WorkbenchModel", () => {
  it("starts empty with 9 cells and null output", () => {
    const m = new WorkbenchModel();
    expect(m.grid.length).toBe(9);
    expect(m.isEmpty()).toBe(true);
    expect(m.output()).toBeNull();
  });

  it("placing cobble in ring shape produces a furnace", () => {
    const m = new WorkbenchModel();
    const C = Blocks.COBBLESTONE;
    [0, 1, 2, 3, 5, 6, 7, 8].forEach((i) => m.setCell(i, C));
    expect(m.output()?.result).toBe(Blocks.FURNACE);
  });

  it("clear() empties all 9 cells", () => {
    const m = new WorkbenchModel();
    m.setCell(4, Blocks.STONE);
    m.clear();
    expect(m.isEmpty()).toBe(true);
  });
});

describe("craftOnceWorkbench", () => {
  it("crafts a furnace consuming 8 cobblestone", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.COBBLESTONE, 8));
    const m = new WorkbenchModel();
    const C = Blocks.COBBLESTONE;
    [0, 1, 2, 3, 5, 6, 7, 8].forEach((i) => m.setCell(i, C));

    const ok = craftOnceWorkbench(m, inv);
    expect(ok).toBe(true);
    expect(inv.count(Blocks.COBBLESTONE)).toBe(0);
    expect(inv.count(Blocks.FURNACE)).toBe(1);
  });

  it("crafts a wooden pickaxe consuming planks and sticks", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.OAK_PLANKS, 3));
    inv.set(1, makeStack(Items.STICK, 2));
    const m = new WorkbenchModel();
    const P = Blocks.OAK_PLANKS;
    const S = Items.STICK;
    const _ = null;
    [P, P, P, _, S, _, _, S, _].forEach((id, i) => m.setCell(i, id));

    const ok = craftOnceWorkbench(m, inv);
    expect(ok).toBe(true);
    expect(inv.count(Blocks.OAK_PLANKS)).toBe(0);
    expect(inv.count(Items.STICK)).toBe(0);
    expect(inv.count(Items.WOODEN_PICKAXE)).toBe(1);
  });

  it("also works for a 2×2 recipe placed in the 3×3 grid", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.OAK_PLANKS, 4));
    const m = new WorkbenchModel();
    const P = Blocks.OAK_PLANKS;
    // 2×2 planks in top-left of the 3×3
    [P, P, null, P, P, null, null, null, null].forEach((id, i) => m.setCell(i, id));

    const ok = craftOnceWorkbench(m, inv);
    expect(ok).toBe(true);
    expect(inv.count(Blocks.CRAFTING_TABLE)).toBe(1);
  });

  it("refuses when inputs are insufficient", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.COBBLESTONE, 4)); // only 4, need 8
    const m = new WorkbenchModel();
    const C = Blocks.COBBLESTONE;
    [0, 1, 2, 3, 5, 6, 7, 8].forEach((i) => m.setCell(i, C));

    expect(craftOnceWorkbench(m, inv)).toBe(false);
    expect(inv.count(Blocks.COBBLESTONE)).toBe(4);
    expect(inv.count(Blocks.FURNACE)).toBe(0);
  });

  it("clears grid cells when backing items are consumed", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.COBBLESTONE, 8));
    const m = new WorkbenchModel();
    const C = Blocks.COBBLESTONE;
    [0, 1, 2, 3, 5, 6, 7, 8].forEach((i) => m.setCell(i, C));

    craftOnceWorkbench(m, inv);
    // All cobblestone consumed → all cells cleared.
    expect(m.isEmpty()).toBe(true);
  });
});
