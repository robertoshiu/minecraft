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
  // Ranged + potions (Phase 5) — bow + a quiver + a few drinkables to try.
  inv.set(13, makeStack(Items.BOW, 1, 1));
  inv.set(14, makeStack(Items.ARROW, 32));
  inv.set(15, makeStack(Items.POTION_HEALING, 1, 1));
  inv.set(16, makeStack(Items.POTION_STRENGTH, 1, 1));
  inv.set(17, makeStack(Items.POTION_SWIFTNESS, 1, 1));
  // Brewing machinery + ingredients (Phase 6b) — seed so the feature is
  // reachable in play and Task-13 live-QA prerequisites are satisfied.
  inv.set(18, makeStack(Blocks.BREWING_STAND, 4));
  inv.set(19, makeStack(Items.WATER_BOTTLE, 8));
  inv.set(20, makeStack(Items.NETHER_WART, 8));
  inv.set(21, makeStack(Items.BLAZE_POWDER, 8));
  inv.set(22, makeStack(Items.BLAZE_ROD, 4));
  inv.set(23, makeStack(Items.GLASS_BOTTLE, 8));
  // Splash potions (Phase 6b) — maxStack:1, so one per slot.
  inv.set(24, makeStack(Items.SPLASH_POTION_POISON, 1, 1));
  inv.set(25, makeStack(Items.SPLASH_POTION_POISON, 1, 1));
  inv.set(26, makeStack(Items.SPLASH_POTION_POISON, 1, 1));
  inv.set(27, makeStack(Items.SPLASH_POTION_HARMING, 1, 1));
  inv.set(28, makeStack(Items.SPLASH_POTION_HARMING, 1, 1));
  inv.set(29, makeStack(Items.SPLASH_POTION_HARMING, 1, 1));
  inv.set(30, makeStack(Items.SPLASH_POTION_HEALING, 1, 1));
  inv.set(31, makeStack(Items.SPLASH_POTION_HEALING, 1, 1));
  inv.set(32, makeStack(Items.SPLASH_POTION_HEALING, 1, 1));
  // Tipped arrows (Phase 6b) — stackable material, 16 in one slot.
  inv.set(33, makeStack(Items.TIPPED_ARROW, 16));
  return inv;
}
