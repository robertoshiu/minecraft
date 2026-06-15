/**
 * default-inventory.ts — the single source of truth for the starter loadout.
 *
 * Centralizing this (spec §4.2) keeps the real-tool ids + food in one place so
 * test churn is localized and the old fake block-id "tools" bug can't recur.
 */

import { Inventory } from "./inventory";
import { makeStack, makeToolStack, makeArmorStack } from "./stack";
import { Blocks } from "../rules/mc-1.20";
import { Items } from "../rules/items";

/** Build a fresh inventory with the starter loadout (real tools + food). */
export function makeDefaultInventory(): Inventory {
  const inv = new Inventory();
  inv.set(0, makeStack(Blocks.OAK_PLANKS, 64));
  inv.set(1, makeStack(Blocks.STONE, 64));
  inv.set(2, makeStack(Blocks.GLASS, 64));
  inv.set(3, makeStack(Blocks.COBBLESTONE, 64));
  // Real tool items (were fake Blocks.OAK_LOG / Blocks.STONE block-id "tools").
  inv.set(4, makeToolStack(Items.WOODEN_PICKAXE, "wood"));
  inv.set(5, makeToolStack(Items.STONE_PICKAXE, "stone"));
  inv.set(6, makeStack(Blocks.CRAFTING_TABLE, 4));
  inv.set(7, makeStack(Blocks.BED, 1));
  // Food (previously absent entirely).
  inv.set(8, makeStack(Items.BREAD, 8));
  // Starter armor (Phase 4) — lets the player actually use the equipment system.
  inv.set(9, makeArmorStack(Items.IRON_HELMET));
  inv.set(10, makeArmorStack(Items.IRON_CHESTPLATE));
  inv.set(11, makeArmorStack(Items.IRON_LEGGINGS));
  inv.set(12, makeArmorStack(Items.IRON_BOOTS));
  return inv;
}
