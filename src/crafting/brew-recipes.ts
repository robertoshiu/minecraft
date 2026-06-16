/**
 * brew-recipes.ts — brewing-stand recipe data + lookup (Phase 6b).
 *
 * A brew takes a BASE potion (water bottle or an intermediate) + one INGREDIENT
 * reagent → a RESULT potion. Modeled as a flat base→ingredient→result table,
 * mirroring the furnace's separate SMELTING table (kept OUT of recipes.ts so
 * the pinned RECIPES/SMELTING counts are untouched). Results reuse the existing
 * POTION_* item ids — no new EffectType is introduced.
 *
 * v1 tree (flattened, water-bottle-rooted):
 *   water_bottle + nether_wart  → POTION_REGENERATION (the "awkward" base; we
 *                                  collapse the awkward step for a shippable v1)
 *   water_bottle + blaze_powder → POTION_STRENGTH
 *   water_bottle + blaze_rod    → POTION_FIRE_RESISTANCE
 * Extending the tree later is additive (append rows).
 */

import { Items, type ItemId } from "../rules/items";

/** A single brewing recipe: base potion + ingredient → result potion. */
export interface BrewRecipe {
  id: string;
  base: ItemId;
  ingredient: ItemId;
  result: ItemId;
}

/** The brewing table. First match in {@link findBrewing} wins. */
export const BREWING: readonly BrewRecipe[] = [
  {
    id: "regeneration",
    base: Items.WATER_BOTTLE,
    ingredient: Items.NETHER_WART,
    result: Items.POTION_REGENERATION,
  },
  {
    id: "strength",
    base: Items.WATER_BOTTLE,
    ingredient: Items.BLAZE_POWDER,
    result: Items.POTION_STRENGTH,
  },
  {
    id: "fire_resistance",
    base: Items.WATER_BOTTLE,
    ingredient: Items.BLAZE_ROD,
    result: Items.POTION_FIRE_RESISTANCE,
  },
];

/** The result of brewing `base` with `ingredient`, or null if no recipe matches. */
export function findBrewing(base: ItemId, ingredient: ItemId): ItemId | null {
  for (const r of BREWING) {
    if (r.base === base && r.ingredient === ingredient) return r.result;
  }
  return null;
}
