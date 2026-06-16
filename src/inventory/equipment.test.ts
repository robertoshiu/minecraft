import { describe, it, expect } from "vitest";
import { Equipment, ARMOR_SLOTS } from "./equipment";
import { Items } from "../rules/items";
import { makeStack } from "./stack";

describe("Equipment", () => {
  it("has 4 slots, all empty initially", () => {
    expect(Equipment.SLOTS).toBe(4);
    const eq = new Equipment();
    for (const slot of ARMOR_SLOTS) expect(eq.get(slot)).toBeNull();
    expect(eq.totalDefense()).toBe(0);
  });
  it("equip sets the slot and returns the previous piece", () => {
    const eq = new Equipment();
    const iron = makeStack(Items.IRON_CHESTPLATE, 1, 1);
    const diamond = makeStack(Items.DIAMOND_CHESTPLATE, 1, 1);
    expect(eq.equip("chestplate", iron)).toBeNull();
    expect(eq.get("chestplate")).toBe(iron);
    expect(eq.equip("chestplate", diamond)).toBe(iron);
    expect(eq.get("chestplate")).toBe(diamond);
  });
  it("totalDefense sums worn pieces", () => {
    const eq = new Equipment();
    eq.equip("helmet", makeStack(Items.IRON_HELMET, 1, 1)); // 2
    eq.equip("chestplate", makeStack(Items.IRON_CHESTPLATE, 1, 1)); // 6
    expect(eq.totalDefense()).toBe(8);
  });
  it("slotFor maps armor ids to slots, null otherwise", () => {
    expect(Equipment.slotFor(Items.DIAMOND_BOOTS)).toBe("boots");
    expect(Equipment.slotFor(Items.IRON_PICKAXE)).toBeNull();
  });
  it("off-hand starts empty and is settable independently of armor", () => {
    const eq = new Equipment();
    expect(eq.getOffhand()).toBeNull();
    const bow = makeStack(Items.BOW, 1, 1);
    eq.setOffhand(bow);
    expect(eq.getOffhand()).toBe(bow);
    // Armor slots are unaffected by the off-hand.
    for (const slot of ARMOR_SLOTS) expect(eq.get(slot)).toBeNull();
  });
  it("off-hand is NOT an armor slot: SLOTS stays 4 and it never feeds totalDefense", () => {
    const eq = new Equipment();
    // Even an armor piece carried in the off-hand confers no defense.
    eq.setOffhand(makeStack(Items.DIAMOND_CHESTPLATE, 1, 1));
    expect(Equipment.SLOTS).toBe(4);
    expect(ARMOR_SLOTS).toHaveLength(4);
    expect(eq.totalDefense()).toBe(0);
  });
  it("setOffhand(null) clears the slot", () => {
    const eq = new Equipment();
    eq.setOffhand(makeStack(Items.ARROW, 5));
    eq.setOffhand(null);
    expect(eq.getOffhand()).toBeNull();
  });
});
