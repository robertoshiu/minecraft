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
  it("seeds Phase-6b brewing stand in slot 18", () => {
    const inv = makeDefaultInventory();
    const stand = inv.get(18);
    expect(stand?.itemId).toBe(Blocks.BREWING_STAND);
    expect(stand?.count).toBe(4);
  });
  it("seeds Phase-6b brewing ingredients in slots 19-23", () => {
    const inv = makeDefaultInventory();
    expect(inv.get(19)?.itemId).toBe(Items.WATER_BOTTLE);
    expect(inv.get(19)?.count).toBe(8);
    expect(inv.get(20)?.itemId).toBe(Items.NETHER_WART);
    expect(inv.get(20)?.count).toBe(8);
    expect(inv.get(21)?.itemId).toBe(Items.BLAZE_POWDER);
    expect(inv.get(21)?.count).toBe(8);
    expect(inv.get(22)?.itemId).toBe(Items.BLAZE_ROD);
    expect(inv.get(22)?.count).toBe(4);
    expect(inv.get(23)?.itemId).toBe(Items.GLASS_BOTTLE);
    expect(inv.get(23)?.count).toBe(8);
  });
  it("seeds Phase-6b splash potions (3 per type, one per slot) in slots 24-32", () => {
    const inv = makeDefaultInventory();
    expect(inv.get(24)?.itemId).toBe(Items.SPLASH_POTION_POISON);
    expect(inv.get(25)?.itemId).toBe(Items.SPLASH_POTION_POISON);
    expect(inv.get(26)?.itemId).toBe(Items.SPLASH_POTION_POISON);
    expect(inv.get(27)?.itemId).toBe(Items.SPLASH_POTION_HARMING);
    expect(inv.get(28)?.itemId).toBe(Items.SPLASH_POTION_HARMING);
    expect(inv.get(29)?.itemId).toBe(Items.SPLASH_POTION_HARMING);
    expect(inv.get(30)?.itemId).toBe(Items.SPLASH_POTION_HEALING);
    expect(inv.get(31)?.itemId).toBe(Items.SPLASH_POTION_HEALING);
    expect(inv.get(32)?.itemId).toBe(Items.SPLASH_POTION_HEALING);
    // Each splash potion is maxStack:1 (count:1).
    for (const slot of [24, 25, 26, 27, 28, 29, 30, 31, 32]) {
      expect(inv.get(slot)?.count).toBe(1);
      expect(inv.get(slot)?.maxStack).toBe(1);
    }
  });
  it("seeds Phase-6b tipped arrows (×16) in slot 33", () => {
    const inv = makeDefaultInventory();
    expect(inv.get(33)?.itemId).toBe(Items.TIPPED_ARROW);
    expect(inv.get(33)?.count).toBe(16);
  });
});
