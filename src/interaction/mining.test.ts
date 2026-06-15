import { describe, it, expect } from "vitest";
import { breakTicks } from "./mining";
import { Blocks } from "../rules/mc-1.20";
import { getItemDef, Items } from "../rules/items";

describe("breakTicks", () => {
  it("hand-breaks STONE in 30 ticks (1.5s × 20tps ÷ 1)", () => {
    expect(breakTicks(Blocks.STONE, null)).toBe(30);
  });
  it("wood pickaxe halves STONE break time (÷2 → 15 ticks)", () => {
    expect(breakTicks(Blocks.STONE, getItemDef(Items.WOODEN_PICKAXE))).toBe(15);
  });
  it("diamond pickaxe is much faster on STONE (1.5×20÷8 → ceil(3.75)=4)", () => {
    expect(breakTicks(Blocks.STONE, getItemDef(Items.DIAMOND_PICKAXE))).toBe(4);
  });
  it("BEDROCK is never breakable (Infinity → Infinity)", () => {
    expect(breakTicks(Blocks.BEDROCK, null)).toBe(Infinity);
  });
  it("missing-hardness block uses fast hand fallback (0.5s → 10 ticks)", () => {
    expect(breakTicks(Blocks.GRAVEL, null)).toBe(10);
  });
  it("never returns less than 1 tick", () => {
    expect(breakTicks(Blocks.OAK_LEAVES, getItemDef(Items.DIAMOND_AXE))).toBeGreaterThanOrEqual(1);
  });
});
