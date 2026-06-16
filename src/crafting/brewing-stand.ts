/**
 * brewing-stand.ts — a single brewing stand's state machine (Phase 6b).
 *
 * Mirrors Furnace but with brewing semantics:
 *  - `base`        the base potion (water bottle / intermediate) being brewed.
 *  - `ingredient`  the reagent consumed to transform the base.
 *  - `fuel`        blaze powder; igniting one grants BREWS_PER_BLAZE_POWDER brews.
 *  - `output`      where the result potion is placed.
 *  - `brewsRemaining`  fuel measured in BREWS (NOT ticks — unlike the furnace).
 *  - `brewProgress`    ticks of the current brew (0..TICKS_PER_BREW).
 *
 * Each tick: if base+ingredient form a recipe AND output has room, ensure fuel
 * (ignite one blaze powder if brewsRemaining is 0), then advance brewProgress.
 * On reaching TICKS_PER_BREW: consume one base + one ingredient, place the
 * result, decrement brewsRemaining, reset progress. Otherwise progress decays.
 *
 * Potions stack to 1, so a single brew either fills an empty output or stalls
 * if the output already holds a potion (no count stacking).
 */

import { BREW } from "../rules/mc-1.20";
import { type ItemStack, makeStack } from "../inventory/stack";
import { maxStackOf } from "../rules/items";
import { findBrewing } from "./brew-recipes";
import type { ItemStackSave } from "../save/serialize";

/**
 * Flat, plain-data snapshot of a BrewingStand for the save system. Mirrors
 * MobSave: slots flatten to ItemStackSave|null and the two counters are kept
 * as ints. The owning coords are NOT stored here — the registry keys by coords
 * (mirroring how the columns map keys by "cx,cz").
 */
export interface BrewingStandSave {
  base: ItemStackSave | null;
  ingredient: ItemStackSave | null;
  fuel: ItemStackSave | null;
  output: ItemStackSave | null;
  brewsRemaining: number;
  brewProgress: number;
}

/** Convert a live slot into its serializable shape (durability optional). */
function slotToSave(stack: ItemStack | null): ItemStackSave | null {
  if (stack === null) return null;
  const save: ItemStackSave = {
    itemId: stack.itemId,
    count: stack.count,
    maxStack: stack.maxStack,
  };
  if (stack.durability !== undefined && stack.maxDurability !== undefined) {
    save.durability = stack.durability;
    save.maxDurability = stack.maxDurability;
  }
  return save;
}

/** Rebuild a live slot from its serializable shape. */
function slotFromSave(save: ItemStackSave | null): ItemStack | null {
  if (save === null) return null;
  const stack: ItemStack = {
    itemId: save.itemId,
    count: save.count,
    maxStack: save.maxStack,
  };
  if (save.durability !== undefined && save.maxDurability !== undefined) {
    stack.durability = save.durability;
    stack.maxDurability = save.maxDurability;
  }
  return stack;
}

export class BrewingStand {
  base: ItemStack | null = null;
  ingredient: ItemStack | null = null;
  fuel: ItemStack | null = null;
  output: ItemStack | null = null;
  /** Brews remaining from the currently-burned blaze powder (0 = unfueled). */
  brewsRemaining = 0;
  /** Progress (in ticks) of the current brew (0..BREW.TICKS_PER_BREW). */
  brewProgress = 0;

  /** True iff fuel is currently available for at least one brew. */
  private get fueled(): boolean {
    return this.brewsRemaining > 0;
  }

  /**
   * The result id if base+ingredient form a recipe AND the output can accept
   * it (empty; potions never stack), else null.
   */
  private brewableResult(): number | null {
    if (this.base === null || this.base.count <= 0) return null;
    if (this.ingredient === null || this.ingredient.count <= 0) return null;
    const result = findBrewing(this.base.itemId, this.ingredient.itemId);
    if (result === null) return null;
    if (this.output !== null) return null; // potions are maxStack 1 — no room
    return result;
  }

  /** Consume one blaze-powder unit → BREWS_PER_BLAZE_POWDER brews. */
  private igniteFuel(): boolean {
    if (this.fuel === null || this.fuel.count <= 0) return false;
    this.brewsRemaining += BREW.BREWS_PER_BLAZE_POWDER;
    const remaining = this.fuel.count - 1;
    this.fuel = remaining <= 0 ? null : { ...this.fuel, count: remaining };
    return true;
  }

  /** Place the brewed result into the (empty) output. */
  private produce(result: number): void {
    this.output = makeStack(result, 1, maxStackOf(result));
  }

  /** Advance the brewing stand by one game tick. */
  tick(): void {
    const result = this.brewableResult();

    // Nothing brewable: no fuel spent, progress decays toward 0.
    if (result === null) {
      if (this.brewProgress > 0) this.brewProgress -= 1;
      return;
    }

    // Need fuel: ignite a unit of blaze powder if none remains.
    if (!this.fueled) this.igniteFuel();

    // Still no fuel → cannot brew; progress decays.
    if (!this.fueled) {
      if (this.brewProgress > 0) this.brewProgress -= 1;
      return;
    }

    // Fueled AND brewable: advance progress. On completion, consume one base +
    // one ingredient, produce the result, spend one brew of fuel.
    this.brewProgress += 1;
    if (this.brewProgress >= BREW.TICKS_PER_BREW) {
      this.brewProgress = 0;
      this.brewsRemaining -= 1;
      if (this.base !== null) {
        const left = this.base.count - 1;
        this.base = left <= 0 ? null : { ...this.base, count: left };
      }
      if (this.ingredient !== null) {
        const left = this.ingredient.count - 1;
        this.ingredient = left <= 0 ? null : { ...this.ingredient, count: left };
      }
      this.produce(result);
    }
  }

  /** Flatten this stand's contents into a plain {@link BrewingStandSave}. */
  toSave(): BrewingStandSave {
    return {
      base: slotToSave(this.base),
      ingredient: slotToSave(this.ingredient),
      fuel: slotToSave(this.fuel),
      output: slotToSave(this.output),
      brewsRemaining: this.brewsRemaining,
      brewProgress: this.brewProgress,
    };
  }

  /** Rebuild a live stand from a saved snapshot (exact inverse of toSave). */
  static fromSave(s: BrewingStandSave): BrewingStand {
    const stand = new BrewingStand();
    stand.base = slotFromSave(s.base);
    stand.ingredient = slotFromSave(s.ingredient);
    stand.fuel = slotFromSave(s.fuel);
    stand.output = slotFromSave(s.output);
    stand.brewsRemaining = s.brewsRemaining;
    stand.brewProgress = s.brewProgress;
    return stand;
  }
}
