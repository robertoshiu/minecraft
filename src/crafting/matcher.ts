/**
 * matcher.ts — turn a crafting grid into a result, and resolve smelting/fuel.
 *
 * Crafting:
 *  - SHAPED   recipes match by SHAPE. The input grid and each recipe pattern are
 *             both trimmed of fully-empty border rows/columns, so absolute
 *             position in the grid is irrelevant. A horizontal mirror of the
 *             trimmed input is also accepted (Minecraft-style symmetry).
 *  - SHAPELESS recipes match by the MULTISET of non-null item ids, ignoring
 *             position entirely.
 *
 * The first matching recipe in {@link RECIPES} wins.
 *
 * Smelting/fuel: thin lookups over {@link SMELTING} and {@link FUEL_VALUES}.
 */

import { FUEL_VALUES, SMELT, Blocks } from "../rules/mc-1.20";
import { Items, type ItemId } from "../rules/items";
import { RECIPES, SMELTING, type Recipe } from "./recipes";

type Grid = (ItemId | null)[][];

/**
 * Trim fully-empty (all-null) leading/trailing rows and columns from a grid,
 * returning the minimal bounding sub-grid. An all-empty grid trims to `[]`.
 */
function trim(grid: Grid): Grid {
  const rows = grid.length;
  if (rows === 0) return [];
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);

  // Normalize ragged rows to a rectangle of width `cols` (missing cells = null).
  const rect: Grid = grid.map((r) => {
    const out: (ItemId | null)[] = [];
    for (let c = 0; c < cols; c++) out.push(r[c] ?? null);
    return out;
  });

  let top = 0;
  let bottom = rows - 1;
  let left = 0;
  let right = cols - 1;

  const rowEmpty = (r: number): boolean =>
    (rect[r] ?? []).every((cell) => cell === null || cell === undefined);
  const colEmpty = (c: number): boolean =>
    rect.every((row) => (row[c] ?? null) === null);

  while (top <= bottom && rowEmpty(top)) top++;
  while (bottom >= top && rowEmpty(bottom)) bottom--;
  if (top > bottom) return [];
  while (left <= right && colEmpty(left)) left++;
  while (right >= left && colEmpty(right)) right--;

  const out: Grid = [];
  for (let r = top; r <= bottom; r++) {
    const row = rect[r];
    if (row === undefined) continue;
    out.push(row.slice(left, right + 1));
  }
  return out;
}

/** Mirror a grid horizontally (reverse each row). */
function mirror(grid: Grid): Grid {
  return grid.map((row) => [...row].reverse());
}

/** Deep equality on two trimmed grids (same dimensions + same cells). */
function gridsEqual(a: Grid, b: Grid): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    const ra = a[r];
    const rb = b[r];
    if (ra === undefined || rb === undefined) return false;
    if (ra.length !== rb.length) return false;
    for (let c = 0; c < ra.length; c++) {
      if ((ra[c] ?? null) !== (rb[c] ?? null)) return false;
    }
  }
  return true;
}

/** Multiset (sorted list) of the non-null cells in a grid. */
function multiset(grid: Grid): ItemId[] {
  const items: ItemId[] = [];
  for (const row of grid) {
    for (const cell of row) {
      if (cell !== null && cell !== undefined) items.push(cell);
    }
  }
  return items.sort((x, y) => x - y);
}

/** Compare two already-sorted multisets for equality. */
function multisetEqual(a: ItemId[], b: ItemId[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function matchesShaped(recipe: Recipe, trimmedInput: Grid): boolean {
  if (recipe.pattern === undefined) return false;
  const trimmedPattern = trim(recipe.pattern);
  if (trimmedPattern.length === 0) return false;
  return (
    gridsEqual(trimmedInput, trimmedPattern) ||
    gridsEqual(mirror(trimmedInput), trimmedPattern)
  );
}

function matchesShapeless(recipe: Recipe, inputMultiset: ItemId[]): boolean {
  if (recipe.ingredients === undefined) return false;
  const wanted = [...recipe.ingredients].sort((x, y) => x - y);
  return multisetEqual(inputMultiset, wanted);
}

/**
 * Find the crafting result for a 2×2 or 3×3 grid, or null if nothing matches.
 * Returns the first matching recipe's `{ result, count }`.
 */
export function findRecipe(
  grid: Grid,
): { result: ItemId; count: number } | null {
  const trimmed = trim(grid);
  if (trimmed.length === 0) return null;
  const ms = multiset(trimmed);

  for (const recipe of RECIPES) {
    const ok =
      recipe.type === "shaped"
        ? matchesShaped(recipe, trimmed)
        : matchesShapeless(recipe, ms);
    if (ok) return { result: recipe.result, count: recipe.count };
  }
  return null;
}

/** Smelting output for a furnace input item, or null if it is not smeltable. */
export function findSmelting(input: ItemId): ItemId | null {
  for (const entry of SMELTING) {
    if (entry.input === input) return entry.output;
  }
  return null;
}

/**
 * Map an item id to its fuel name in {@link FUEL_VALUES}. Block items reuse the
 * block id (coal_block / oak_planks / oak_log); non-block items map by name.
 */
function fuelKey(itemId: ItemId): string | null {
  switch (itemId) {
    case Items.COAL:
      return "coal";
    case Items.COAL_BLOCK:
      return "coal_block";
    case Items.STICK:
      return "stick";
    case Blocks.OAK_PLANKS:
      return "oak_planks";
    case Blocks.OAK_LOG:
      return "oak_log";
    default:
      return null;
  }
}

/**
 * Total furnace burn ticks a single unit of `fuelItemId` provides.
 *
 * {@link FUEL_VALUES} stores fuel value in items-smelted (e.g. coal = 8); the
 * tick total is `itemsSmelted × SMELT.TICKS_PER_ITEM` (coal → 8 × 200 = 1600).
 * Returns 0 for non-fuel items.
 */
export function fuelBurnTicks(fuelItemId: ItemId): number {
  const key = fuelKey(fuelItemId);
  if (key === null) return 0;
  const itemsSmelted = FUEL_VALUES[key];
  if (itemsSmelted === undefined) return 0;
  return itemsSmelted * SMELT.TICKS_PER_ITEM;
}
