import { describe, it, expect } from "vitest";
import { BREWING, findBrewing } from "./brew-recipes";
import { Items } from "../rules/items";

describe("BREWING table", () => {
  it("recipe ids are unique", () => {
    const ids = BREWING.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("(base, ingredient) keys are unique", () => {
    const keys = BREWING.map((r) => `${r.base}:${r.ingredient}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("every result is an existing potion item id", () => {
    const potions = new Set<number>([
      Items.POTION_REGENERATION, Items.POTION_HEALING, Items.POTION_HARMING,
      Items.POTION_POISON, Items.POTION_RESISTANCE, Items.POTION_STRENGTH,
      Items.POTION_SWIFTNESS, Items.POTION_FIRE_RESISTANCE,
    ]);
    for (const r of BREWING) expect(potions.has(r.result)).toBe(true);
  });
});

describe("findBrewing", () => {
  it("water bottle + nether wart → regeneration", () => {
    expect(findBrewing(Items.WATER_BOTTLE, Items.NETHER_WART)).toBe(
      Items.POTION_REGENERATION,
    );
  });
  it("water bottle + blaze rod → fire resistance", () => {
    expect(findBrewing(Items.WATER_BOTTLE, Items.BLAZE_ROD)).toBe(
      Items.POTION_FIRE_RESISTANCE,
    );
  });
  it("water bottle + blaze powder → strength", () => {
    expect(findBrewing(Items.WATER_BOTTLE, Items.BLAZE_POWDER)).toBe(
      Items.POTION_STRENGTH,
    );
  });
  it("non-recipe pairs → null", () => {
    expect(findBrewing(Items.WATER_BOTTLE, Items.STICK)).toBeNull();
    expect(findBrewing(Items.GLASS_BOTTLE, Items.NETHER_WART)).toBeNull();
  });
});
