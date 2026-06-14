import { describe, it, expect } from "vitest";
import { Blocks, SMELT } from "../rules/mc-1.20";
import { Items, type ItemId } from "../rules/items";
import { RECIPES, SMELTING } from "./recipes";
import { findRecipe, findSmelting, fuelBurnTicks } from "./matcher";

const _ = null;

describe("RECIPES — coverage", () => {
  it("defines at least 15 recipes", () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(15);
  });

  it("every recipe has the right shape for its type", () => {
    for (const r of RECIPES) {
      if (r.type === "shaped") {
        expect(r.pattern, `${r.id} shaped needs pattern`).toBeDefined();
      } else {
        expect(r.ingredients, `${r.id} shapeless needs ingredients`).toBeDefined();
      }
      expect(r.count).toBeGreaterThan(0);
    }
  });

  it("recipe ids are unique", () => {
    const ids = RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("shapeless planks", () => {
  it("1 oak log anywhere in a 2×2 → 4 oak planks", () => {
    const positions: (ItemId | null)[][][] = [
      [[Blocks.OAK_LOG, _], [_, _]],
      [[_, Blocks.OAK_LOG], [_, _]],
      [[_, _], [Blocks.OAK_LOG, _]],
      [[_, _], [_, Blocks.OAK_LOG]],
    ];
    for (const grid of positions) {
      const out = findRecipe(grid);
      expect(out).toEqual({ result: Blocks.OAK_PLANKS, count: 4 });
    }
  });

  it("1 birch log → 4 birch planks", () => {
    expect(findRecipe([[Blocks.BIRCH_LOG]])).toEqual({
      result: Blocks.BIRCH_PLANKS,
      count: 4,
    });
  });

  it("shapeless ignores position in a 3×3 too", () => {
    const grid = [
      [_, _, _],
      [_, Blocks.OAK_LOG, _],
      [_, _, _],
    ];
    expect(findRecipe(grid)).toEqual({ result: Blocks.OAK_PLANKS, count: 4 });
  });
});

describe("shaped sticks — shape matters", () => {
  it("2 planks stacked vertically → 4 sticks", () => {
    expect(findRecipe([[Blocks.OAK_PLANKS], [Blocks.OAK_PLANKS]])).toEqual({
      result: Items.STICK,
      count: 4,
    });
  });

  it("vertical stick recipe matches regardless of which column it sits in", () => {
    const grid = [
      [_, Blocks.OAK_PLANKS],
      [_, Blocks.OAK_PLANKS],
    ];
    expect(findRecipe(grid)).toEqual({ result: Items.STICK, count: 4 });
  });

  it("2 planks horizontal does NOT make sticks (shape matters)", () => {
    expect(
      findRecipe([[Blocks.OAK_PLANKS, Blocks.OAK_PLANKS]]),
    ).toBeNull();
  });
});

describe("shaped crafting table + furnace + pickaxe", () => {
  it("2×2 planks → crafting table", () => {
    const grid = [
      [Blocks.OAK_PLANKS, Blocks.OAK_PLANKS],
      [Blocks.OAK_PLANKS, Blocks.OAK_PLANKS],
    ];
    expect(findRecipe(grid)).toEqual({
      result: Blocks.CRAFTING_TABLE,
      count: 1,
    });
  });

  it("8-cobblestone ring → furnace", () => {
    const C = Blocks.COBBLESTONE;
    const grid = [
      [C, C, C],
      [C, _, C],
      [C, C, C],
    ];
    expect(findRecipe(grid)).toEqual({ result: Blocks.FURNACE, count: 1 });
  });

  it("wooden pickaxe shape (3 planks top, 2 sticks center column)", () => {
    const P = Blocks.OAK_PLANKS;
    const S = Items.STICK;
    const grid = [
      [P, P, P],
      [_, S, _],
      [_, S, _],
    ];
    expect(findRecipe(grid)).toEqual({
      result: Items.WOODEN_PICKAXE,
      count: 1,
    });
  });

  it("torch: coal over stick → 4 torches", () => {
    expect(findRecipe([[Items.COAL], [Items.STICK]])).toEqual({
      result: Blocks.TORCH,
      count: 4,
    });
  });

  it("bread: 3 wheat in a row → 1 bread", () => {
    expect(
      findRecipe([[Items.WHEAT, Items.WHEAT, Items.WHEAT]]),
    ).toEqual({ result: Items.BREAD, count: 1 });
  });

  it("bed: 3 wool top row + 3 oak planks bottom row → 1 bed", () => {
    const W = Items.WOOL;
    const P = Blocks.OAK_PLANKS;
    expect(findRecipe([[W, W, W], [P, P, P]])).toEqual({
      result: Blocks.BED,
      count: 1,
    });
  });
});

describe("mirror equivalence (asymmetric recipe)", () => {
  it("the axe matches its horizontal mirror", () => {
    const P = Blocks.OAK_PLANKS;
    const S = Items.STICK;
    // Canonical (right-handed) axe.
    const canonical = [
      [P, P],
      [P, S],
      [_, S],
    ];
    // Horizontal mirror (left-handed) — should also craft an axe.
    const mirrored = [
      [P, P],
      [S, P],
      [S, _],
    ];
    expect(findRecipe(canonical)).toEqual({ result: Items.WOODEN_AXE, count: 1 });
    expect(findRecipe(mirrored)).toEqual({ result: Items.WOODEN_AXE, count: 1 });
  });
});

describe("no match", () => {
  it("empty grid → null", () => {
    expect(findRecipe([[_, _], [_, _]])).toBeNull();
  });

  it("a nonsense combination → null", () => {
    expect(
      findRecipe([[Items.DIAMOND, Items.FEATHER], [Items.WOOL, _]]),
    ).toBeNull();
  });
});

describe("SMELTING table", () => {
  it("iron ore → iron ingot", () => {
    expect(findSmelting(Blocks.IRON_ORE)).toBe(Items.IRON_INGOT);
  });

  it("covers the required conversions", () => {
    expect(findSmelting(Blocks.GOLD_ORE)).toBe(Items.GOLD_INGOT);
    expect(findSmelting(Items.RAW_IRON)).toBe(Items.IRON_INGOT);
    expect(findSmelting(Blocks.SAND)).toBe(Blocks.GLASS);
    expect(findSmelting(Items.RAW_BEEF)).toBe(Items.STEAK);
    expect(findSmelting(Items.RAW_PORKCHOP)).toBe(Items.COOKED_PORKCHOP);
    expect(findSmelting(Items.RAW_CHICKEN)).toBe(Items.COOKED_CHICKEN);
    expect(findSmelting(Blocks.COBBLESTONE)).toBe(Blocks.STONE);
  });

  it("non-smeltable → null", () => {
    expect(findSmelting(Items.DIAMOND)).toBeNull();
  });

  it("SMELTING has all 8 conversions", () => {
    expect(SMELTING.length).toBe(8);
  });
});

describe("fuelBurnTicks", () => {
  it("coal = 8 × TICKS_PER_ITEM", () => {
    expect(fuelBurnTicks(Items.COAL)).toBe(8 * SMELT.TICKS_PER_ITEM);
  });

  it("coal block = 80 × TICKS_PER_ITEM", () => {
    expect(fuelBurnTicks(Items.COAL_BLOCK)).toBe(80 * SMELT.TICKS_PER_ITEM);
  });

  it("non-fuel → 0", () => {
    expect(fuelBurnTicks(Items.DIAMOND)).toBe(0);
    expect(fuelBurnTicks(Blocks.STONE)).toBe(0);
  });
});
