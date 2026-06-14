/**
 * furnace.ts — a single furnace's smelting state machine (simplified MC 1.20).
 *
 * State:
 *  - `input`   the stack being smelted (e.g. iron ore).
 *  - `fuel`    the stack burned for heat (e.g. coal).
 *  - `output`  where smelted results accumulate.
 *  - `burnTicksRemaining`  ticks of fuel heat left before another unit must burn.
 *  - `cookProgress`        ticks of the current item smelted (0..TICKS_PER_ITEM).
 *
 * Each {@link tick}:
 *  1. If currently burning, decrement `burnTicksRemaining`.
 *  2. Determine whether the input is smeltable AND the output has room for the
 *     result. If not, cooking stalls (progress decays toward 0) and no fuel is
 *     consumed.
 *  3. If smeltable and not burning, try to ignite one unit of fuel.
 *  4. While burning + smeltable, advance `cookProgress`. On reaching
 *     `SMELT.TICKS_PER_ITEM`, consume 1 input and produce 1 output (respecting
 *     stacking caps), then reset progress.
 *
 * Ordering note: we ignite fuel at the START of a tick if needed so that the
 * same tick can make cooking progress (matches the intuitive "tick enough →
 * produces output" test expectation).
 */

import { SMELT } from "../rules/mc-1.20";
import {
  type ItemStack,
  makeStack,
} from "../inventory/stack";
import { maxStackOf } from "../rules/items";
import { findSmelting, fuelBurnTicks } from "./matcher";

export class Furnace {
  input: ItemStack | null = null;
  fuel: ItemStack | null = null;
  output: ItemStack | null = null;
  /** Ticks of fuel heat remaining (0 = not currently burning). */
  burnTicksRemaining = 0;
  /** Progress (in ticks) of the current item being smelted. */
  cookProgress = 0;

  /** True iff currently burning (has heat left). */
  private get burning(): boolean {
    return this.burnTicksRemaining > 0;
  }

  /**
   * Whether the input is smeltable AND the result can be placed in `output`
   * (empty, or a matching stack with room). Returns the result id or null.
   */
  private smeltableResult(): number | null {
    if (this.input === null || this.input.count <= 0) return null;
    const result = findSmelting(this.input.itemId);
    if (result === null) return null;
    if (this.output === null) return result;
    if (this.output.itemId !== result) return null;
    if (this.output.count >= this.output.maxStack) return null;
    return result;
  }

  /** Consume one unit of fuel, starting a new burn. Returns true on success. */
  private igniteFuel(): boolean {
    if (this.fuel === null || this.fuel.count <= 0) return false;
    const ticks = fuelBurnTicks(this.fuel.itemId);
    if (ticks <= 0) return false;
    this.burnTicksRemaining += ticks;
    const remaining = this.fuel.count - 1;
    this.fuel = remaining <= 0 ? null : { ...this.fuel, count: remaining };
    return true;
  }

  /** Place one smelted unit of `result` into `output`, respecting the cap. */
  private produce(result: number): void {
    if (this.output === null) {
      this.output = makeStack(result, 1, maxStackOf(result));
    } else {
      this.output = { ...this.output, count: this.output.count + 1 };
    }
  }

  /** Advance the furnace by one game tick. */
  tick(): void {
    const result = this.smeltableResult();

    // Nothing smeltable (no input / not smeltable / output full): no fuel is
    // consumed and any in-flight cooking progress decays toward 0.
    if (result === null) {
      if (this.cookProgress > 0) this.cookProgress -= 1;
      return;
    }

    // Need heat to cook: if not already burning, ignite a fresh unit of fuel.
    if (!this.burning) {
      this.igniteFuel();
    }

    // Still no heat → cannot cook this tick; progress decays.
    if (!this.burning) {
      if (this.cookProgress > 0) this.cookProgress -= 1;
      return;
    }

    // We are burning AND smelting: spend exactly one burn tick (every cooking
    // tick costs one, including the tick a fresh fuel unit was ignited) and
    // advance cooking progress.
    this.burnTicksRemaining -= 1;
    this.cookProgress += 1;
    if (this.cookProgress >= SMELT.TICKS_PER_ITEM) {
      this.cookProgress = 0;
      // Consume one input.
      if (this.input !== null) {
        const remaining = this.input.count - 1;
        this.input = remaining <= 0 ? null : { ...this.input, count: remaining };
      }
      this.produce(result);
    }
  }
}
