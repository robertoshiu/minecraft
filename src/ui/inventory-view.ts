/**
 * inventory-view.ts — PURE view-model helpers for the inventory screen.
 *
 * Framework-free: NO DOM, NO Babylon. Maps inventory/craft state into small
 * plain objects the DOM layer renders, and owns the click-to-pick-up /
 * click-to-place "cursor stack" transfer logic so it is unit-testable without a
 * real DOM.
 *
 * Click-drag model (MC-like):
 *  - mousedown on a slot starts a potential drag, storing sourceSlot.
 *  - mouseup on a DIFFERENT slot completes the drag via {@link applyDragMove}.
 *  - mouseup on the SAME slot (no movement) falls through to a normal click.
 *  - Escape / close returns the cursor item to its source via
 *    {@link cancelDrag}.
 */

import type { ItemStack } from "../inventory/stack";
import { canMerge, isTool } from "../inventory/stack";
import { getItemDef, maxStackOf } from "../rules/items";
import { Inventory } from "../inventory/inventory";

// ---------------------------------------------------------------------------
// Drag state helpers
// ---------------------------------------------------------------------------

/**
 * Tracks the in-progress drag: which slot the item was lifted from, and the
 * item stack that is "in the air". This is a plain data type so tests can
 * construct and inspect it without a DOM.
 */
export interface DragState {
  /** Slot index the drag started from. */
  readonly sourceSlot: number;
  /** The stack that was lifted off the source slot. */
  readonly item: ItemStack;
}

/**
 * Begin a drag from `slotIndex`. Returns a {@link DragState} and an updated
 * slot value (null — the item has been lifted), or null if the slot is empty
 * (no drag to start).
 *
 * Pure: never mutates `inventory`.
 */
export function beginDrag(
  inventory: Inventory,
  slotIndex: number,
): { drag: DragState; clearedSlot: null } | null {
  const stack = inventory.get(slotIndex);
  if (stack === null) return null;
  return {
    drag: { sourceSlot: slotIndex, item: { ...stack } },
    clearedSlot: null,
  };
}

/**
 * Complete a drag by dropping {@link DragState.item} onto `targetSlot`.
 *
 * Semantics mirror {@link applySlotClick} but operate on the drag item rather
 * than the cursor:
 *  - target empty → place the full stack.
 *  - target same mergeable item → merge (remainder goes back to source).
 *  - target different item → swap (displaced item goes back to source slot).
 *
 * Returns the new values for sourceSlot and targetSlot, plus whether anything
 * actually moved (false when source === target).
 *
 * Pure: never mutates `inventory`.
 */
export function applyDragMove(
  drag: DragState,
  targetSlot: number,
  inventory: Inventory,
): {
  moved: boolean;
  sourceSlotValue: ItemStack | null;
  targetSlotValue: ItemStack | null;
} {
  if (drag.sourceSlot === targetSlot) {
    // Drop back onto the same slot — restore it.
    return {
      moved: false,
      sourceSlotValue: { ...drag.item },
      targetSlotValue: { ...drag.item },
    };
  }

  const target = inventory.get(targetSlot);
  const r = applySlotClick(drag.item, target);

  return {
    moved: true,
    // Remainder (cursor after the drop) goes back to source slot.
    sourceSlotValue: r.cursor,
    targetSlotValue: r.slot,
  };
}

/**
 * Cancel an in-progress drag: returns the dragged item to its source slot.
 * The caller should write `item` back to `drag.sourceSlot`.
 */
export function cancelDrag(drag: DragState): ItemStack {
  return { ...drag.item };
}

/** A single rendered slot's display data. */
export interface SlotView {
  /** Empty-slot sentinel. */
  empty: boolean;
  /** Short uppercase label (first word, 3 letters) — "" when empty. */
  label: string;
  /** Stack count (0 when empty). */
  count: number;
  /** Full item name for tooltip/aria — "" when empty. */
  name: string;
}

/** An empty slot view (shared constant shape). */
const EMPTY_SLOT: SlotView = { empty: true, label: "", count: 0, name: "" };

/** Short, uppercase 3-letter label for an item id (best-effort, HUD style). */
export function shortLabel(itemId: number): string {
  let name: string;
  try {
    name = getItemDef(itemId).name;
  } catch {
    return String(itemId);
  }
  const word = name.split(" ")[0] ?? name;
  return word.slice(0, 3).toUpperCase();
}

/** Map a stack (or null) into its {@link SlotView}. */
export function slotView(stack: ItemStack | null): SlotView {
  if (stack === null || stack.count <= 0) return EMPTY_SLOT;
  let name = String(stack.itemId);
  try {
    name = getItemDef(stack.itemId).name;
  } catch {
    /* keep numeric fallback */
  }
  return {
    empty: false,
    label: shortLabel(stack.itemId),
    count: stack.count,
    name,
  };
}

/**
 * Outcome of a click on a slot holding `slot`, while the cursor holds `cursor`.
 * Both fields are the NEW values (either may be null = empty). Pure: callers
 * write these back; this function never mutates its inputs.
 *
 * Semantics (MC-like, simplified — whole-stack moves):
 *  - cursor empty, slot has items → pick up the whole slot stack.
 *  - cursor has items, slot empty → drop the whole cursor stack.
 *  - both same mergeable item   → merge as much as fits into the slot; the
 *                                  remainder stays on the cursor.
 *  - both present, not mergeable → swap.
 */
export function applySlotClick(
  cursor: ItemStack | null,
  slot: ItemStack | null,
): { cursor: ItemStack | null; slot: ItemStack | null } {
  // Nothing in hand, nothing in slot → no-op.
  if (cursor === null && slot === null) {
    return { cursor: null, slot: null };
  }

  // Pick up the slot stack.
  if (cursor === null && slot !== null) {
    return { cursor: { ...slot }, slot: null };
  }

  // Drop the cursor stack into an empty slot.
  if (cursor !== null && slot === null) {
    return { cursor: null, slot: { ...cursor } };
  }

  // Both present.
  if (cursor !== null && slot !== null) {
    // Mergeable: top up the slot, keep the remainder on the cursor.
    if (
      cursor.itemId === slot.itemId &&
      !isTool(cursor) &&
      !isTool(slot) &&
      canMerge(slot, cursor)
    ) {
      const room = slot.maxStack - slot.count;
      const moved = Math.min(room, cursor.count);
      const newSlot: ItemStack = { ...slot, count: slot.count + moved };
      const remaining = cursor.count - moved;
      const newCursor: ItemStack | null =
        remaining > 0 ? { ...cursor, count: remaining } : null;
      return { cursor: newCursor, slot: newSlot };
    }
    // Otherwise swap.
    return { cursor: { ...slot }, slot: { ...cursor } };
  }

  return { cursor, slot };
}

/**
 * Right-click action on a slot:
 *  - cursor empty, slot has items → pick up HALF (floor(count/2), min 1) into cursor.
 *  - cursor has items, slot empty → drop ONE item from cursor into slot.
 *  - cursor has items, slot has SAME mergeable item → drop ONE if there is room.
 *  - otherwise (different items or tools) → fall back to the same swap as left-click.
 *
 * Pure: callers write the returned values back; this function never mutates.
 */
export function applyRightClick(
  cursor: ItemStack | null,
  slot: ItemStack | null,
): { cursor: ItemStack | null; slot: ItemStack | null } {
  // Both empty — no-op.
  if (cursor === null && slot === null) {
    return { cursor: null, slot: null };
  }

  // Pick up half the slot into an empty cursor.
  if (cursor === null && slot !== null) {
    const half = Math.max(1, Math.floor(slot.count / 2));
    const remaining = slot.count - half;
    const newSlot: ItemStack | null =
      remaining > 0 ? { ...slot, count: remaining } : null;
    return { cursor: { ...slot, count: half }, slot: newSlot };
  }

  // Drop one item from the cursor into the slot.
  if (cursor !== null && slot === null) {
    const newCursor: ItemStack | null =
      cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null;
    return {
      cursor: newCursor,
      slot: { ...cursor, count: 1 },
    };
  }

  // Both present.
  if (cursor !== null && slot !== null) {
    // Drop one if same mergeable type and slot has room.
    if (
      cursor.itemId === slot.itemId &&
      !isTool(cursor) &&
      !isTool(slot) &&
      slot.count < slot.maxStack
    ) {
      const newCursor: ItemStack | null =
        cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null;
      return {
        cursor: newCursor,
        slot: { ...slot, count: slot.count + 1 },
      };
    }
    // Different items / tools / full slot → swap (same as left-click).
    return { cursor: { ...slot }, slot: { ...cursor } };
  }

  return { cursor, slot };
}

/**
 * Shift-click quick-move: move a stack from one inventory region to the other.
 *
 * Slot layout: 0..8 = hotbar, 9..35 = main area.
 *  - Hotbar → main (9..35): fill partial stacks, then first empty slot.
 *  - Main  → hotbar (0..8): fill partial stacks, then first empty slot.
 *
 * Returns the updated inventory (new Inventory object with mutations applied)
 * so the caller can write it back, or null if the move was a no-op.
 *
 * Pure: operates on a copy of the slot data; never mutates the original.
 */
export function applyShiftClick(
  inventory: Inventory,
  slotIndex: number,
): { moved: boolean; slots: Array<ItemStack | null> } {
  const stack = inventory.get(slotIndex);
  if (stack === null) return { moved: false, slots: [] };

  // Determine source region and target range.
  const isHotbar = slotIndex < Inventory.HOTBAR_SLOTS;
  const targetStart = isHotbar ? Inventory.HOTBAR_SLOTS : 0;
  const targetEnd = isHotbar ? Inventory.SLOTS : Inventory.HOTBAR_SLOTS;

  // Build a mutable snapshot of all slots.
  const slots: Array<ItemStack | null> = [];
  for (let i = 0; i < Inventory.SLOTS; i++) {
    const s = inventory.get(i);
    slots[i] = s !== null ? { ...s } : null;
  }

  let remaining = stack.count;

  // Pass 1: top up partial stacks of the same item in the target range.
  for (let i = targetStart; i < targetEnd && remaining > 0; i++) {
    const s = slots[i] ?? null;
    if (s === null || s.itemId !== stack.itemId || isTool(stack) || isTool(s)) continue;
    if (!canMerge(s, stack)) continue;
    const room = s.maxStack - s.count;
    const moved = Math.min(room, remaining);
    s.count += moved;
    remaining -= moved;
  }

  // Pass 2: fill empty slots in the target range.
  const ms = maxStackOf(stack.itemId);
  for (let i = targetStart; i < targetEnd && remaining > 0; i++) {
    if ((slots[i] ?? null) !== null) continue;
    const moved = Math.min(ms, remaining);
    slots[i] = { ...stack, count: moved };
    remaining -= moved;
  }

  if (remaining === stack.count) {
    // Nothing moved.
    return { moved: false, slots: [] };
  }

  // Update the source slot.
  slots[slotIndex] = remaining > 0 ? { ...stack, count: remaining } : null;

  return { moved: true, slots };
}

/**
 * The first stack of `itemId` in the inventory, or a synthetic display stack
 * (count 1) when none is found — so a craft cell always shows something.
 */
export function firstStackOf(inventory: Inventory, itemId: number): ItemStack {
  for (let i = 0; i < Inventory.SLOTS; i++) {
    const stack = inventory.get(i);
    if (stack !== null && stack.itemId === itemId) {
      return { itemId, count: 1, maxStack: stack.maxStack };
    }
  }
  return { itemId, count: 1, maxStack: 64 };
}

/**
 * Return a cursor-held stack into the inventory; returns the new cursor value
 * (leftover that didn't fit, or null). Pure: caller writes the result back.
 */
export function returnStackToInventory(
  cursor: ItemStack | null,
  inventory: Inventory | null,
): ItemStack | null {
  if (cursor === null || inventory === null) return cursor;
  const leftover = inventory.add(cursor);
  return leftover > 0 ? { ...cursor, count: leftover } : null;
}
