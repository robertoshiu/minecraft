/**
 * inventory.ts — the player inventory and hotbar selection model.
 *
 * {@link Inventory} is a flat array of 36 slots (0..8 = hotbar, 9..35 = main
 * storage) holding `ItemStack | null`. With `noUncheckedIndexedAccess` enabled
 * every raw array read is `ItemStack | null | undefined`, so all access goes
 * through {@link Inventory.get}, which normalises out-of-range / unset slots to
 * `null`.
 *
 * {@link Hotbar} tracks only the selected hotbar index (0..8) and is decoupled
 * from any particular Inventory instance — {@link Hotbar.selectedStack} reads
 * the live stack from whatever inventory it is handed.
 */

import { type ItemStack, canMerge } from "./stack";

export class Inventory {
  /** Total slot count: 0..8 hotbar, 9..35 main. */
  static readonly SLOTS = 36;

  /** Number of hotbar slots at the front of the slot array. */
  static readonly HOTBAR_SLOTS = 9;

  private readonly slots: (ItemStack | null)[];

  constructor() {
    this.slots = new Array<ItemStack | null>(Inventory.SLOTS).fill(null);
  }

  /** Read a slot, returning null for empty or out-of-range indices. */
  get(slot: number): ItemStack | null {
    if (slot < 0 || slot >= Inventory.SLOTS) return null;
    return this.slots[slot] ?? null;
  }

  /** Overwrite a slot. Out-of-range writes are ignored. */
  set(slot: number, stack: ItemStack | null): void {
    if (slot < 0 || slot >= Inventory.SLOTS) return;
    this.slots[slot] = stack;
  }

  /**
   * Insert `stack`'s items, merging into compatible partial stacks first and
   * then filling empty slots. Returns the leftover count that did not fit
   * (0 when everything was stored).
   */
  add(stack: ItemStack): number {
    let remaining = stack.count;
    if (remaining <= 0) return 0;

    // Pass 1: top up existing compatible (non-tool) stacks.
    for (let i = 0; i < Inventory.SLOTS && remaining > 0; i++) {
      const slot = this.slots[i];
      if (slot === null || slot === undefined) continue;
      if (!canMerge(slot, stack)) continue;
      const room = slot.maxStack - slot.count;
      const moved = Math.min(room, remaining);
      slot.count += moved;
      remaining -= moved;
    }

    // Pass 2: spill the remainder into empty slots, respecting maxStack.
    for (let i = 0; i < Inventory.SLOTS && remaining > 0; i++) {
      const slot = this.slots[i];
      if (slot !== null && slot !== undefined) continue;
      const moved = Math.min(stack.maxStack, remaining);
      this.slots[i] = { ...stack, count: moved };
      remaining -= moved;
    }

    return remaining;
  }

  /**
   * Remove up to `count` items from `slot`. Returns the amount actually
   * removed; clears the slot when its count reaches 0.
   */
  removeFromSlot(slot: number, count: number): number {
    const stack = this.get(slot);
    if (stack === null || count <= 0) return 0;
    const removed = Math.min(stack.count, count);
    stack.count -= removed;
    if (stack.count <= 0) this.slots[slot] = null;
    return removed;
  }

  /** Exchange the contents of two slots. Out-of-range indices are ignored. */
  swap(i: number, j: number): void {
    if (i < 0 || i >= Inventory.SLOTS) return;
    if (j < 0 || j >= Inventory.SLOTS) return;
    const a = this.slots[i] ?? null;
    const b = this.slots[j] ?? null;
    this.slots[i] = b;
    this.slots[j] = a;
  }

  /** Index of the first empty slot, or null if the inventory is full. */
  findFreeSlot(): number | null {
    for (let i = 0; i < Inventory.SLOTS; i++) {
      const slot = this.slots[i];
      if (slot === null || slot === undefined) return i;
    }
    return null;
  }

  /** Total quantity of `itemId` across every slot. */
  count(itemId: number): number {
    let total = 0;
    for (let i = 0; i < Inventory.SLOTS; i++) {
      const slot = this.slots[i];
      if (slot !== null && slot !== undefined && slot.itemId === itemId) {
        total += slot.count;
      }
    }
    return total;
  }
}

/** Number of hotbar slots a {@link Hotbar} cycles through. */
const HOTBAR_SIZE = 9;

/** Tracks the currently selected hotbar slot (0..8). */
export class Hotbar {
  private index = 0;

  /** The currently selected hotbar index (0..8). */
  get selected(): number {
    return this.index;
  }

  /** Select an explicit hotbar slot; ignored if out of 0..8. */
  select(i: number): void {
    if (i < 0 || i >= HOTBAR_SIZE) return;
    this.index = i;
  }

  /** Advance the selection by `delta`, wrapping within 0..8. */
  cycle(delta: number): void {
    const n = HOTBAR_SIZE;
    this.index = (((this.index + delta) % n) + n) % n;
  }

  /** The stack at the selected hotbar slot of `inv` (null if empty). */
  selectedStack(inv: Inventory): ItemStack | null {
    return inv.get(this.index);
  }
}
