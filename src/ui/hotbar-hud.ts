/**
 * hotbar-hud.ts — minimal hotbar HUD updater.
 *
 * Reflects the 9 hotbar slots into the existing `#hotbar .slot` DOM elements:
 * each slot shows a short item label + count, and the currently selected slot
 * is highlighted. The base look (border / glass background) comes from hud.css;
 * the selected-slot highlight is applied inline here (per-frame) so any slot —
 * not just the first — can be the active one without touching the stylesheet.
 *
 * DOM is optional: when the elements are absent (NullEngine / unit tests) the
 * updater is a silent no-op, so it never breaks headless runs.
 */

import type { Inventory, Hotbar } from "../inventory/inventory";
import { BLOCK_REGISTRY } from "../rules/block-registry";

/** Number of hotbar slots reflected into the HUD. */
const HOTBAR_SLOTS = 9;

/** Short, uppercase 3-letter label for an item id (best-effort, for the HUD). */
function shortLabel(itemId: number): string {
  const def = BLOCK_REGISTRY[itemId];
  if (def === undefined) return String(itemId);
  // First three letters of the first word of the block name, uppercased.
  const word = def.name.split(" ")[0] ?? def.name;
  return word.slice(0, 3).toUpperCase();
}

/**
 * Update the hotbar DOM to mirror `inv` + `hotbar`. Guarded so it is inert when
 * the HUD DOM is not present.
 */
export function updateHotbarHud(inv: Inventory, hotbar: Hotbar): void {
  if (typeof document === "undefined") return;
  const container = document.getElementById("hotbar");
  if (container === null) return;

  const slots = container.querySelectorAll<HTMLElement>(".slot");
  const selected = hotbar.selected;

  for (let i = 0; i < HOTBAR_SLOTS; i++) {
    const el = slots[i];
    if (el === undefined) continue;

    const stack = inv.get(i);
    el.textContent =
      stack === null || stack.count <= 0
        ? ""
        : `${shortLabel(stack.itemId)} ${stack.count}`;

    // Lightweight content styling (CSS only sizes/borders the empty slot).
    el.style.display = "flex";
    el.style.flexDirection = "column";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";
    el.style.fontSize = "10px";
    el.style.lineHeight = "1.1";
    el.style.color = "#e8e6e1";

    if (i === selected) {
      el.style.borderColor = "#d4a843";
      el.style.boxShadow = "0 0 8px #d4a843, 0 0 2px #d4a843 inset";
    } else {
      el.style.borderColor = "#3a3d45";
      el.style.boxShadow = "none";
    }
  }
}
