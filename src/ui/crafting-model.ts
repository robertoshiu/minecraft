/**
 * crafting-model.ts — PURE hand-crafting (2×2) and workbench (3×3) interaction models.
 *
 * Framework-free: NO Babylon, NO DOM. This module owns the logic of the
 * survival-inventory hand-crafting grid: a flat 4-cell grid of item ids (or
 * null), the recipe lookup that pads the 2×2 into the shape {@link findRecipe}
 * expects, and the craft consume/produce step that operates on an
 * {@link Inventory}.
 *
 * The DOM screen (inventory-screen.ts) drives this model; keeping the logic
 * here means it is fully unit-testable under node with no DOM dependency.
 */

import { findRecipe } from "../crafting/matcher";
import type { ItemId } from "../rules/items";
import { maxStackOf } from "../rules/items";
import { Inventory } from "../inventory/inventory";
import { makeStack, type ItemStack } from "../inventory/stack";

/** The 2×2 hand-craft grid as a flat 4-element array (row-major). */
export type HandCraftGrid = (ItemId | null)[];

/** Number of cells in the 2×2 hand-craft grid. */
export const HAND_GRID_CELLS = 4;

/**
 * A 2×2 hand-crafting grid plus the operations the inventory screen needs.
 *
 * The grid holds only item *ids* (a single item per cell, MC-style); the actual
 * counts of inputs live in the {@link Inventory}, mirroring how each crafting
 * cell visually shows one item while the player keeps a larger stack.
 */
export class HandCraftModel {
  /** Row-major 2×2 grid of item ids (or null for an empty cell). */
  readonly grid: HandCraftGrid;

  constructor() {
    this.grid = new Array<ItemId | null>(HAND_GRID_CELLS).fill(null);
  }

  /** Read a cell (0..3); returns null for empty or out-of-range indices. */
  cell(i: number): ItemId | null {
    if (i < 0 || i >= HAND_GRID_CELLS) return null;
    return this.grid[i] ?? null;
  }

  /** Set a cell (0..3). Out-of-range writes are ignored. */
  setCell(i: number, item: ItemId | null): void {
    if (i < 0 || i >= HAND_GRID_CELLS) return;
    this.grid[i] = item;
  }

  /** True when every cell is empty. */
  isEmpty(): boolean {
    return this.grid.every((c) => c === null || c === undefined);
  }

  /** Clear all four cells. */
  clear(): void {
    for (let i = 0; i < HAND_GRID_CELLS; i++) this.grid[i] = null;
  }

  /** The current crafting result, or null if the grid matches no recipe. */
  output(): { result: ItemId; count: number } | null {
    return outputFor(this.grid);
  }
}

/**
 * Pad a flat 2×2 grid into the 3×3-friendly nested shape the matcher trims.
 * The matcher trims empty border rows/cols, so a 2×2 placed in the top-left of
 * a 3×3 matches identically to a bare 2×2.
 */
function pad2x2(flat: HandCraftGrid): (ItemId | null)[][] {
  const a = flat[0] ?? null;
  const b = flat[1] ?? null;
  const c = flat[2] ?? null;
  const d = flat[3] ?? null;
  return [
    [a, b, null],
    [c, d, null],
    [null, null, null],
  ];
}

/**
 * The crafting result for a flat 2×2 grid, or null if it matches no recipe.
 * Pads the grid into the shape {@link findRecipe} expects (which then trims it).
 */
export function outputFor(
  flat: HandCraftGrid,
): { result: ItemId; count: number } | null {
  const allEmpty = flat.every((c) => c === null || c === undefined);
  if (allEmpty) return null;
  return findRecipe(pad2x2(flat));
}

/**
 * Perform one craft against `model`'s current grid, depositing the result into
 * `inventory` and consuming exactly one item from each non-empty grid cell.
 *
 * Returns true if a craft happened. A craft is refused (returns false, no
 * mutation) when: there is no matching recipe; the result does not fit in the
 * inventory; or any required input is no longer backed by a stack in the
 * inventory (defensive — the grid id should always be backed while shown).
 *
 * After a successful craft, each consumed cell whose backing stack hits zero is
 * cleared from the grid so the screen can re-resolve the output.
 */
export function craftOnce(model: HandCraftModel, inventory: Inventory): boolean {
  const out = model.output();
  if (out === null) return false;

  // Tally how many of each input id the recipe consumes (one per non-empty cell).
  const need = new Map<ItemId, number>();
  for (let i = 0; i < HAND_GRID_CELLS; i++) {
    const id = model.cell(i);
    if (id === null) continue;
    need.set(id, (need.get(id) ?? 0) + 1);
  }
  if (need.size === 0) return false;

  // Verify the inventory actually holds enough of every input BEFORE mutating.
  for (const [id, qty] of need) {
    if (inventory.count(id) < qty) return false;
  }

  // Verify the result fits without permanently consuming inputs: simulate the
  // add against a throwaway stack is not possible here, so we instead place the
  // result and roll back if it could not be fully stored.
  const result: ItemStack = makeStack(out.result, out.count, maxStackOf(out.result));
  // Reserve a copy to detect leftover.
  const leftover = inventory.add({ ...result });
  if (leftover > 0) {
    // Could not fully store — roll back the partial add and refuse the craft.
    removeFromInventory(inventory, out.result, out.count - leftover);
    return false;
  }

  // Result stored; now consume one of each input id from the inventory.
  for (const [id, qty] of need) {
    removeFromInventory(inventory, id, qty);
  }

  // Clear any grid cell whose backing id is no longer present in the inventory.
  for (let i = 0; i < HAND_GRID_CELLS; i++) {
    const id = model.cell(i);
    if (id !== null && inventory.count(id) === 0) {
      model.setCell(i, null);
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// WorkbenchModel — 3×3 crafting grid
// ---------------------------------------------------------------------------

/** Number of cells in the 3×3 workbench grid. */
export const WORKBENCH_GRID_CELLS = 9;

/**
 * A 3×3 workbench crafting grid.
 *
 * Same design as {@link HandCraftModel} but for 9 cells. The grid records only
 * item ids; actual stack counts live in the Inventory (same as the hand model).
 */
export class WorkbenchModel {
  /** Row-major 3×3 grid of item ids (or null for an empty cell). */
  readonly grid: (ItemId | null)[];

  constructor() {
    this.grid = new Array<ItemId | null>(WORKBENCH_GRID_CELLS).fill(null);
  }

  /** Read a cell (0..8); returns null for empty or out-of-range. */
  cell(i: number): ItemId | null {
    if (i < 0 || i >= WORKBENCH_GRID_CELLS) return null;
    return this.grid[i] ?? null;
  }

  /** Set a cell (0..8). Out-of-range writes are ignored. */
  setCell(i: number, item: ItemId | null): void {
    if (i < 0 || i >= WORKBENCH_GRID_CELLS) return;
    this.grid[i] = item;
  }

  /** True when every cell is empty. */
  isEmpty(): boolean {
    return this.grid.every((c) => c === null || c === undefined);
  }

  /** Clear all nine cells. */
  clear(): void {
    for (let i = 0; i < WORKBENCH_GRID_CELLS; i++) this.grid[i] = null;
  }

  /** The current crafting result, or null if the grid matches no recipe. */
  output(): { result: ItemId; count: number } | null {
    return outputFor3x3(this.grid);
  }
}

/**
 * Convert a flat 9-element 3×3 grid into the nested grid shape {@link findRecipe}
 * expects, then look up the result.
 */
export function outputFor3x3(
  flat: (ItemId | null)[],
): { result: ItemId; count: number } | null {
  const allEmpty = flat.every((c) => c === null || c === undefined);
  if (allEmpty) return null;
  const grid: (ItemId | null)[][] = [
    [flat[0] ?? null, flat[1] ?? null, flat[2] ?? null],
    [flat[3] ?? null, flat[4] ?? null, flat[5] ?? null],
    [flat[6] ?? null, flat[7] ?? null, flat[8] ?? null],
  ];
  return findRecipe(grid);
}

/**
 * Perform one craft against a {@link WorkbenchModel}, depositing the result
 * into `inventory` and consuming exactly one item from each non-empty cell.
 * Returns true if a craft happened (same semantics as {@link craftOnce}).
 */
export function craftOnceWorkbench(model: WorkbenchModel, inventory: Inventory): boolean {
  const out = model.output();
  if (out === null) return false;

  const need = new Map<ItemId, number>();
  for (let i = 0; i < WORKBENCH_GRID_CELLS; i++) {
    const id = model.cell(i);
    if (id === null) continue;
    need.set(id, (need.get(id) ?? 0) + 1);
  }
  if (need.size === 0) return false;

  for (const [id, qty] of need) {
    if (inventory.count(id) < qty) return false;
  }

  const result: ItemStack = makeStack(out.result, out.count, maxStackOf(out.result));
  const leftover = inventory.add({ ...result });
  if (leftover > 0) {
    removeFromInventory(inventory, out.result, out.count - leftover);
    return false;
  }

  for (const [id, qty] of need) {
    removeFromInventory(inventory, id, qty);
  }

  for (let i = 0; i < WORKBENCH_GRID_CELLS; i++) {
    const id = model.cell(i);
    if (id !== null && inventory.count(id) === 0) {
      model.setCell(i, null);
    }
  }

  return true;
}

/**
 * Remove up to `count` of `itemId` from the inventory, walking slots until the
 * amount is satisfied. Returns the amount actually removed.
 */
function removeFromInventory(
  inventory: Inventory,
  itemId: ItemId,
  count: number,
): number {
  let remaining = count;
  for (let i = 0; i < Inventory.SLOTS && remaining > 0; i++) {
    const stack = inventory.get(i);
    if (stack === null || stack.itemId !== itemId) continue;
    remaining -= inventory.removeFromSlot(i, remaining);
  }
  return count - remaining;
}
