import { describe, it, expect } from "vitest";
import { resolveUse } from "./use-item";
import { getItemDef, Items } from "../rules/items";
import { Blocks } from "../rules/mc-1.20";

describe("resolveUse", () => {
  it("food while hungry → eat", () => {
    expect(resolveUse(getItemDef(Items.BREAD), { hungry: true })).toEqual({ kind: "eat" });
  });
  it("food while full → none (don't waste it)", () => {
    expect(resolveUse(getItemDef(Items.BREAD), { hungry: false })).toEqual({ kind: "none" });
  });
  it("placeable block → place (regardless of hunger)", () => {
    const def = getItemDef(Blocks.OAK_PLANKS);
    expect(resolveUse(def, { hungry: true })).toEqual({ kind: "place" });
    expect(resolveUse(def, { hungry: false })).toEqual({ kind: "place" });
  });
  it("tool → use-other (not placeable, not food)", () => {
    expect(resolveUse(getItemDef(Items.IRON_PICKAXE), { hungry: true })).toEqual({ kind: "use-other" });
  });
  it("material → use-other", () => {
    expect(resolveUse(getItemDef(Items.STICK), { hungry: false })).toEqual({ kind: "use-other" });
  });
  it("armor → equip (regardless of hunger)", () => {
    const def = getItemDef(Items.IRON_CHESTPLATE);
    expect(resolveUse(def, { hungry: true })).toEqual({ kind: "equip" });
    expect(resolveUse(def, { hungry: false })).toEqual({ kind: "equip" });
  });
  it("potion → drink (regardless of hunger)", () => {
    const def = getItemDef(Items.POTION_HEALING);
    expect(resolveUse(def, { hungry: true })).toEqual({ kind: "drink" });
    expect(resolveUse(def, { hungry: false })).toEqual({ kind: "drink" });
  });
  it("bow → use-other (no right-click action; charge is mousedown glue)", () => {
    const def = getItemDef(Items.BOW);
    expect(resolveUse(def, { hungry: true })).toEqual({ kind: "use-other" });
  });
});
