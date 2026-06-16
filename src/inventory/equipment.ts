/**
 * equipment.ts — the player's worn-armor holder. SEPARATE from the 36-slot
 * Inventory (which is pinned at SLOTS === 36 and must never widen). Four
 * nullable armor slots keyed by ArmorSlot. Off-hand is a separate non-armor
 * carry slot (getOffhand/setOffhand), not part of ARMOR_SLOTS.
 *
 * Pure data + small accessors: no Babylon, no world. `equip` swaps the
 * incoming piece into its slot and returns whatever was previously worn (so
 * the caller can return it to the bag).
 */

import type { ItemStack } from "./stack";
import type { ArmorSlot } from "../rules/mc-1.20";
import { getItemDef, armorDefenseOf } from "../rules/items";

/** The four armor slots, in head-to-toe order (also the persistence order). */
export const ARMOR_SLOTS: readonly ArmorSlot[] = [
  "helmet",
  "chestplate",
  "leggings",
  "boots",
];

export class Equipment {
  /** Number of armor slots (helmet/chestplate/leggings/boots). */
  static readonly SLOTS = 4;

  private readonly slots: Record<ArmorSlot, ItemStack | null> = {
    helmet: null,
    chestplate: null,
    leggings: null,
    boots: null,
  };

  /** The piece worn in `slot`, or null. */
  get(slot: ArmorSlot): ItemStack | null {
    return this.slots[slot] ?? null;
  }

  /** Force-set a slot (used by the persistence loader). */
  set(slot: ArmorSlot, stack: ItemStack | null): void {
    this.slots[slot] = stack;
  }

  /**
   * The off-hand carry slot. SEPARATE from the 4 armor slots — it is NOT part
   * of ARMOR_SLOTS, does NOT count toward SLOTS (which stays 4), and confers NO
   * defense (totalDefense ignores it). It can hold ANY item; in v1 it is purely
   * a carry slot swapped via the F key.
   */
  private offhand: ItemStack | null = null;

  /** The item held in the off-hand, or null. */
  getOffhand(): ItemStack | null {
    return this.offhand ?? null;
  }

  /** Force-set the off-hand item (used by the F-key swap and the loader). */
  setOffhand(stack: ItemStack | null): void {
    this.offhand = stack;
  }

  /**
   * Wear `stack` in `slot`, returning the previously-worn piece (or null).
   * The caller is responsible for routing the returned piece back to the bag.
   */
  equip(slot: ArmorSlot, stack: ItemStack): ItemStack | null {
    const prev = this.slots[slot] ?? null;
    this.slots[slot] = stack;
    return prev;
  }

  /** Total defense points across all worn pieces. */
  totalDefense(): number {
    let sum = 0;
    for (const slot of ARMOR_SLOTS) {
      const piece = this.slots[slot];
      if (piece !== null) sum += armorDefenseOf(piece.itemId);
    }
    return sum;
  }

  /** The armor slot an item id belongs to, or null if it is not armor. */
  static slotFor(itemId: number): ArmorSlot | null {
    const def = getItemDef(itemId);
    if (def.kind !== "armor" || def.armorSlot === undefined) return null;
    return def.armorSlot;
  }
}
