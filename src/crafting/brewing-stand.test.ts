import { describe, it, expect } from "vitest";
import { BrewingStand } from "./brewing-stand";
import { BREW } from "../rules/mc-1.20";
import { makeStack } from "../inventory/stack";
import { Items } from "../rules/items";

function fueledStand(): BrewingStand {
  const s = new BrewingStand();
  s.base = makeStack(Items.WATER_BOTTLE, 1, 1);
  s.ingredient = makeStack(Items.NETHER_WART, 1);
  s.fuel = makeStack(Items.BLAZE_POWDER, 1);
  return s;
}

describe("BrewingStand", () => {
  it("does nothing with no recipe (progress stays 0)", () => {
    const s = new BrewingStand();
    s.base = makeStack(Items.WATER_BOTTLE, 1, 1);
    s.ingredient = makeStack(Items.STICK, 1); // not a reagent
    s.fuel = makeStack(Items.BLAZE_POWDER, 1);
    for (let i = 0; i < 10; i++) s.tick();
    expect(s.brewProgress).toBe(0);
    expect(s.output).toBeNull();
    expect(s.brewsRemaining).toBe(0); // never ignited (nothing brewable)
  });

  it("ignites one blaze powder into BREWS_PER_BLAZE_POWDER brews on first tick", () => {
    const s = fueledStand();
    s.tick();
    expect(s.brewsRemaining).toBe(BREW.BREWS_PER_BLAZE_POWDER);
    expect(s.fuel).toBeNull(); // consumed the single powder unit
    expect(s.brewProgress).toBe(1);
  });

  it("completes a brew after TICKS_PER_BREW: produces result, consumes inputs", () => {
    const s = fueledStand();
    for (let i = 0; i < BREW.TICKS_PER_BREW; i++) s.tick();
    expect(s.output).not.toBeNull();
    expect(s.output!.itemId).toBe(Items.POTION_REGENERATION);
    expect(s.base).toBeNull();        // 1 → 0
    expect(s.ingredient).toBeNull();  // 1 → 0
    expect(s.brewProgress).toBe(0);
    // One blaze powder fuels many brews; one was spent.
    expect(s.brewsRemaining).toBe(BREW.BREWS_PER_BLAZE_POWDER - 1);
  });

  it("stalls when output is occupied (potions do not stack)", () => {
    const s = fueledStand();
    s.output = makeStack(Items.POTION_HEALING, 1, 1);
    for (let i = 0; i < BREW.TICKS_PER_BREW; i++) s.tick();
    expect(s.brewProgress).toBe(0);
    expect(s.output!.itemId).toBe(Items.POTION_HEALING); // unchanged
  });

  it("without fuel, brewable inputs make no progress", () => {
    const s = new BrewingStand();
    s.base = makeStack(Items.WATER_BOTTLE, 1, 1);
    s.ingredient = makeStack(Items.NETHER_WART, 1);
    for (let i = 0; i < 50; i++) s.tick();
    expect(s.brewProgress).toBe(0);
    expect(s.output).toBeNull();
  });
});

describe("BrewingStand save round-trip", () => {
  it("toSave/fromSave is an exact inverse for a mid-brew stand", () => {
    const s = fueledStand();
    for (let i = 0; i < 5; i++) s.tick(); // ignite + accrue some progress
    const restored = BrewingStand.fromSave(s.toSave());
    expect(restored.base).toEqual(s.base);
    expect(restored.ingredient).toEqual(s.ingredient);
    expect(restored.fuel).toEqual(s.fuel);
    expect(restored.output).toEqual(s.output);
    expect(restored.brewsRemaining).toBe(s.brewsRemaining);
    expect(restored.brewProgress).toBe(s.brewProgress);
    expect(restored.brewProgress).toBeGreaterThan(0); // proves progress survived
  });
  it("survives JSON serialization (the registry blob is JSON)", () => {
    const s = fueledStand();
    for (let i = 0; i < 5; i++) s.tick();
    const json = JSON.stringify(s.toSave());
    const restored = BrewingStand.fromSave(JSON.parse(json) as ReturnType<BrewingStand["toSave"]>);
    expect(restored.brewProgress).toBe(s.brewProgress);
    expect(restored.brewsRemaining).toBe(s.brewsRemaining);
  });
  it("a continued brew completes identically after a round-trip", () => {
    const s = fueledStand();
    s.tick(); // ignite + 1 tick of progress
    const restored = BrewingStand.fromSave(s.toSave());
    // Finish the brew from the restored stand.
    for (let i = 1; i < BREW.TICKS_PER_BREW; i++) restored.tick();
    expect(restored.output).not.toBeNull();
    expect(restored.output!.itemId).toBe(Items.POTION_REGENERATION);
  });
});
