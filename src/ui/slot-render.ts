import type { ItemStack } from "../inventory/stack";
import { slotView } from "./inventory-view";
import { getAtlasIconStyle } from "./item-icon";

/** Render a stack (or null) into a slot element via the pure view-model. */
export function fillSlot(el: HTMLElement, stack: ItemStack | null): void {
  const v = slotView(stack);
  el.title = v.name;
  el.setAttribute(
    "aria-label",
    v.empty ? "Empty slot" : `${v.name}, ${v.count} items`,
  );

  el.style.backgroundImage = "";
  el.style.backgroundSize = "";
  el.style.backgroundPosition = "";
  el.style.imageRendering = "";

  if (v.empty) {
    el.textContent = "";
    return;
  }

  const iconStyle = getAtlasIconStyle(stack!.itemId);
  if (iconStyle !== null) {
    el.textContent = "";
    el.style.backgroundImage = iconStyle.backgroundImage;
    el.style.backgroundSize = iconStyle.backgroundSize;
    el.style.backgroundPosition = iconStyle.backgroundPosition;
    el.style.imageRendering = iconStyle.imageRendering;
    el.style.position = "relative";

    const countSpan = document.createElement("span");
    countSpan.className = "slot-count";
    countSpan.textContent = String(v.count);
    el.appendChild(countSpan);
  } else {
    el.textContent = `${v.label} ${String(v.count)}`;
  }
}
