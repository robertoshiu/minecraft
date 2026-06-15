import { describe, it, expect } from "vitest";
import { TOOL_DURABILITY } from "../rules/mc-1.20";
import {
  type ItemStack,
  type ToolTier,
  makeStack,
  makeToolStack,
  makeArmorStack,
  canMerge,
  isTool,
  damageTool,
} from "./stack";
import { Items, armorDurabilityOf } from "../rules/items";

describe("makeStack", () => {
  it("defaults maxStack to 64", () => {
    const s = makeStack(1, 5);
    expect(s.itemId).toBe(1);
    expect(s.count).toBe(5);
    expect(s.maxStack).toBe(64);
    expect(s.durability).toBeUndefined();
    expect(s.maxDurability).toBeUndefined();
  });

  it("honours an explicit maxStack", () => {
    const s = makeStack(8, 1, 16);
    expect(s.maxStack).toBe(16);
  });

  it("is not a tool", () => {
    expect(isTool(makeStack(1, 1))).toBe(false);
  });
});

describe("makeToolStack", () => {
  it("creates a diamond tool: durability 1561, count/maxStack 1", () => {
    const t = makeToolStack(100, "diamond");
    expect(t.itemId).toBe(100);
    expect(t.count).toBe(1);
    expect(t.maxStack).toBe(1);
    expect(t.durability).toBe(1561);
    expect(t.maxDurability).toBe(1561);
    expect(isTool(t)).toBe(true);
  });

  it("uses TOOL_DURABILITY for every tier", () => {
    const tiers: ToolTier[] = ["wood", "stone", "iron", "diamond", "gold"];
    for (const tier of tiers) {
      const t = makeToolStack(200, tier);
      expect(t.durability).toBe(TOOL_DURABILITY[tier]);
      expect(t.maxDurability).toBe(TOOL_DURABILITY[tier]);
      expect(t.count).toBe(1);
      expect(t.maxStack).toBe(1);
    }
  });
});

describe("isTool", () => {
  it("is true only when durability is defined", () => {
    expect(isTool(makeToolStack(1, "wood"))).toBe(true);
    expect(isTool(makeStack(1, 1))).toBe(false);
  });
});

describe("canMerge", () => {
  it("merges same non-tool itemId when source has room", () => {
    expect(canMerge(makeStack(1, 10), makeStack(1, 5))).toBe(true);
  });

  it("rejects different itemIds", () => {
    expect(canMerge(makeStack(1, 10), makeStack(2, 5))).toBe(false);
  });

  it("rejects a full source stack", () => {
    expect(canMerge(makeStack(1, 64), makeStack(1, 1))).toBe(false);
  });

  it("rejects when either side is a tool", () => {
    const tool = makeToolStack(1, "wood");
    expect(canMerge(tool, makeStack(1, 1))).toBe(false);
    expect(canMerge(makeStack(1, 1), tool)).toBe(false);
    expect(canMerge(tool, makeToolStack(1, "wood"))).toBe(false);
  });
});

describe("damageTool", () => {
  it("returns a non-tool stack unchanged", () => {
    const s = makeStack(1, 5);
    expect(damageTool(s)).toBe(s);
  });

  it("decrements durability and breaks at 0", () => {
    // A 2-durability tool: build one directly.
    const two: ItemStack = {
      itemId: 1,
      count: 1,
      maxStack: 1,
      durability: 2,
      maxDurability: 2,
    };
    const once = damageTool(two);
    expect(once).not.toBeNull();
    expect(once?.durability).toBe(1);
    // original is not mutated
    expect(two.durability).toBe(2);

    const twice = once === null ? null : damageTool(once);
    expect(twice).toBeNull();
  });

  it("damages a fresh diamond tool by one", () => {
    const t = makeToolStack(1, "diamond");
    const d = damageTool(t);
    expect(d?.durability).toBe(1560);
    expect(d?.maxDurability).toBe(1561);
  });
});

describe("makeArmorStack", () => {
  it("makeArmorStack seeds full per-slot durability", () => {
    const s = makeArmorStack(Items.IRON_CHESTPLATE);
    expect(s.count).toBe(1);
    expect(s.maxStack).toBe(1);
    expect(s.durability).toBe(armorDurabilityOf(Items.IRON_CHESTPLATE)!);
    expect(s.maxDurability).toBe(s.durability);
  });
  it("makeArmorStack on a non-armor id → plain stack (no durability)", () => {
    expect(makeArmorStack(Items.IRON_PICKAXE).durability).toBeUndefined();
  });
});
