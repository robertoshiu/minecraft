/**
 * use-item.ts — PURE right-click action router.
 *
 * Decides WHAT a right-click should do given the held item's definition and a
 * tiny context. It performs NO world writes, NO Babylon calls, NO stack
 * mutation — the caller (main.ts) maps the returned action to real effects.
 *
 * Block-interaction special cases (crafting table, bed, future furnace) are
 * handled by the caller BEFORE resolveUse is consulted (spec §4.2 precedence:
 * interact-block → eat-if-food-and-hungry → place-if-placeable → use-other).
 */

import type { ItemDef } from "../rules/items";

/** The action a right-click resolves to. */
export type UseAction =
  | { kind: "eat" }
  | { kind: "place" }
  | { kind: "use-other" }
  | { kind: "none" };

/** Minimal decision context (no Babylon, no world). */
export interface UseContext {
  /** True when the player can still benefit from eating (food < MAX_FOOD). */
  readonly hungry: boolean;
}

/**
 * Resolve the right-click action for a held item.
 *
 * - food + hungry  → eat
 * - food + full    → none (don't waste the food)
 * - placeable      → place
 * - anything else  → use-other (tools, materials with future behaviour)
 */
export function resolveUse(def: ItemDef, ctx: UseContext): UseAction {
  if (def.kind === "food") {
    return ctx.hungry ? { kind: "eat" } : { kind: "none" };
  }
  if (def.placesBlock !== undefined) {
    return { kind: "place" };
  }
  return { kind: "use-other" };
}
