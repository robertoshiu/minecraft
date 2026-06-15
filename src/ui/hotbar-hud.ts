/**
 * hotbar-hud.ts — minimal hotbar HUD updater.
 *
 * Reflects the 9 hotbar slots into the existing `#hotbar .slot` DOM elements:
 * each slot shows a block icon (from the procedural atlas) + count span, or
 * falls back to a short text label when the atlas icon is unavailable (headless
 * / non-block items / canvas not supported). The currently selected slot is
 * highlighted.
 *
 * DOM is optional: when the elements are absent (NullEngine / unit tests) the
 * updater is a silent no-op, so it never breaks headless runs.
 */

import type { Inventory, Hotbar } from "../inventory/inventory";
import { BLOCK_REGISTRY } from "../rules/block-registry";
import { getAtlasIconStyle } from "./item-icon";

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
 * Apply an atlas icon background + count span to a populated slot, or fall
 * back to text label+count when the icon is unavailable.
 */
function renderSlotContent(el: HTMLElement, itemId: number, count: number): void {
  // Clear any existing icon/count children from previous render.
  el.textContent = "";
  el.style.backgroundImage = "";
  el.style.backgroundSize = "";
  el.style.backgroundPosition = "";
  el.style.imageRendering = "";

  const iconStyle = getAtlasIconStyle(itemId);
  if (iconStyle !== null) {
    // Icon path: apply atlas background + absolutely-positioned count span.
    el.style.backgroundImage = iconStyle.backgroundImage;
    el.style.backgroundSize = iconStyle.backgroundSize;
    el.style.backgroundPosition = iconStyle.backgroundPosition;
    el.style.imageRendering = iconStyle.imageRendering;
    el.style.position = "relative";

    const countSpan = document.createElement("span");
    countSpan.className = "slot-count";
    countSpan.textContent = String(count);
    el.appendChild(countSpan);
  } else {
    // Text fallback: short label + count (matches original behavior).
    el.textContent = `${shortLabel(itemId)} ${String(count)}`;
  }
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
    if (stack === null || stack.count <= 0) {
      // Empty slot: clear content and backgrounds.
      el.textContent = "";
      el.style.backgroundImage = "";
    } else {
      renderSlotContent(el, stack.itemId, stack.count);
    }

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
