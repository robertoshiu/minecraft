import { describe, it, expect } from "vitest";
import { BrewingStands } from "./brewing-stands";
import { BREW } from "../rules/mc-1.20";
import { makeStack } from "../inventory/stack";
import { Items } from "../rules/items";

describe("BrewingStands registry", () => {
  it("getOrCreate returns the SAME stand for the same coords", () => {
    const reg = new BrewingStands();
    const a = reg.getOrCreate(3, 64, -7);
    const b = reg.getOrCreate(3, 64, -7);
    expect(a).toBe(b);
    expect(reg.count()).toBe(1);
  });
  it("distinct coords get distinct stands", () => {
    const reg = new BrewingStands();
    reg.getOrCreate(0, 0, 0);
    reg.getOrCreate(0, 0, 1);
    expect(reg.count()).toBe(2);
  });
  it("peek is null before creation, the stand after, null after remove", () => {
    const reg = new BrewingStands();
    expect(reg.peek(1, 1, 1)).toBeNull();
    const s = reg.getOrCreate(1, 1, 1);
    expect(reg.peek(1, 1, 1)).toBe(s);
    expect(reg.remove(1, 1, 1)).toBe(true);
    expect(reg.peek(1, 1, 1)).toBeNull();
  });
  it("tickAll advances every registered stand", () => {
    const reg = new BrewingStands();
    const s = reg.getOrCreate(2, 2, 2);
    s.base = makeStack(Items.WATER_BOTTLE, 1, 1);
    s.ingredient = makeStack(Items.NETHER_WART, 1);
    s.fuel = makeStack(Items.BLAZE_POWDER, 1);
    reg.tickAll();
    expect(s.brewProgress).toBe(1);
    expect(s.brewsRemaining).toBe(BREW.BREWS_PER_BLAZE_POWDER);
  });
});

describe("BrewingStands save round-trip", () => {
  it("toSave/fromSave preserves coords + per-stand contents", () => {
    const reg = new BrewingStands();
    const s = reg.getOrCreate(5, 64, -3);
    s.base = makeStack(Items.WATER_BOTTLE, 1, 1);
    s.ingredient = makeStack(Items.NETHER_WART, 1);
    s.fuel = makeStack(Items.BLAZE_POWDER, 1);
    reg.tickAll(); // ignite + 1 tick
    const json = JSON.stringify(reg.toSave());
    const restored = BrewingStands.fromSave(JSON.parse(json));
    expect(restored.count()).toBe(1);
    const rs = restored.peek(5, 64, -3);
    expect(rs).not.toBeNull();
    expect(rs!.brewProgress).toBe(s.brewProgress);
    expect(rs!.brewsRemaining).toBe(s.brewsRemaining);
    expect(rs!.base).toEqual(s.base);
  });
  it("fromSave skips malformed rows without throwing", () => {
    const bad = [{ x: 1, y: 1 } as unknown] as never;
    expect(() => BrewingStands.fromSave(bad)).not.toThrow();
    expect(BrewingStands.fromSave(bad).count()).toBe(0);
  });
});
