import { describe, it, expect } from "vitest";
import { makeDefaultInventory } from "./default-inventory";
import { Items, isTool, isArmor } from "../rules/items";
import { Blocks } from "../rules/mc-1.20";

describe("makeDefaultInventory", () => {
  it("seeds real tool items, not fake block-id tools", () => {
    const inv = makeDefaultInventory();
    expect(inv.get(4)?.itemId).toBe(Items.WOODEN_PICKAXE);
    expect(inv.get(5)?.itemId).toBe(Items.STONE_PICKAXE);
    expect(inv.get(4)?.itemId).not.toBe(Blocks.OAK_LOG);
    expect(inv.get(5)?.itemId).not.toBe(Blocks.STONE);
  });
  it("tools carry durability and are single-stack", () => {
    const pick = makeDefaultInventory().get(4);
    expect(pick).not.toBeNull();
    if (pick !== null) {
      expect(isTool(pick.itemId)).toBe(true);
      expect(pick.maxStack).toBe(1);
    }
  });
  it("includes food in the starter loadout", () => {
    const food = makeDefaultInventory().get(8);
    expect(food?.itemId).toBe(Items.BREAD);
    expect(food?.count).toBe(8);
  });
  it("seeds the placeable starter blocks", () => {
    const inv = makeDefaultInventory();
    expect(inv.get(0)?.itemId).toBe(Blocks.OAK_PLANKS);
    expect(inv.get(7)?.itemId).toBe(Blocks.BED);
  });
  it("includes starter iron armor set in slots 9–12 (Phase 4)", () => {
    const inv = makeDefaultInventory();
    expect(inv.get(9)?.itemId).toBe(Items.IRON_HELMET);
    expect(inv.get(10)?.itemId).toBe(Items.IRON_CHESTPLATE);
    expect(inv.get(11)?.itemId).toBe(Items.IRON_LEGGINGS);
    expect(inv.get(12)?.itemId).toBe(Items.IRON_BOOTS);
    // Each armor piece is count:1 and carries durability.
    for (const slot of [9, 10, 11, 12]) {
      const piece = inv.get(slot);
      expect(piece).not.toBeNull();
      if (piece !== null) {
        expect(piece.count).toBe(1);
        expect(piece.maxStack).toBe(1);
        expect(isArmor(piece.itemId)).toBe(true);
        expect(piece.durability).toBeGreaterThan(0);
      }
    }
  });
  it("seeds the Phase-5 bow, arrows, and potions in slots 13-17", () => {
    const inv = makeDefaultInventory();
    expect(inv.get(13)?.itemId).toBe(Items.BOW);
    expect(inv.get(14)?.itemId).toBe(Items.ARROW);
    expect(inv.get(14)?.count).toBe(32);
    expect(inv.get(15)?.itemId).toBe(Items.POTION_HEALING);
    expect(inv.get(16)?.itemId).toBe(Items.POTION_STRENGTH);
    expect(inv.get(17)?.itemId).toBe(Items.POTION_SWIFTNESS);
  });
});
