/**
 * stack.ts — the inventory item-stack data model.
 *
 * An {@link ItemStack} is a generic (itemId, count) pair plus stacking and
 * (optional) tool-durability metadata. `itemId` is deliberately a bare number:
 * block items reuse block ids from {@link Blocks}, and tools use whatever ids a
 * future item registry assigns — this module hardcodes no item table.
 *
 * Tool durability is the only "behaviour" here: a tool is simply a stack with a
 * defined `durability`. {@link damageTool} returns a NEW stack (or null when the
 * tool breaks) and never mutates its input, so callers can treat stacks as
 * immutable values.
 */

import { TOOL_DURABILITY } from "../rules/mc-1.20";

/**
 * A single inventory slot's worth of items.
 *
 * `durability`/`maxDurability` are present only on tools; with
 * `exactOptionalPropertyTypes` enabled they are omitted entirely (not set to
 * `undefined`) on ordinary item stacks.
 */
export interface ItemStack {
  itemId: number;
  count: number;
  maxStack: number;
  durability?: number;
  maxDurability?: number;
}

/** Tool material tiers that carry durability (see {@link TOOL_DURABILITY}). */
export type ToolTier = "wood" | "stone" | "iron" | "diamond" | "gold";

/** Default maximum stack size for ordinary items. */
const DEFAULT_MAX_STACK = 64;

/** Create an ordinary (non-tool) item stack. */
export function makeStack(
  itemId: number,
  count: number,
  maxStack: number = DEFAULT_MAX_STACK,
): ItemStack {
  return { itemId, count, maxStack };
}

/** Create a single tool with full durability for the given tier. */
export function makeToolStack(itemId: number, tier: ToolTier): ItemStack {
  const max = TOOL_DURABILITY[tier];
  return {
    itemId,
    count: 1,
    maxStack: 1,
    durability: max,
    maxDurability: max,
  };
}

/** A tool is any stack with a defined durability. */
export function isTool(s: ItemStack): boolean {
  return s.durability !== undefined;
}

/**
 * Whether `b` can be merged into `a`: same itemId, neither is a tool, and `a`
 * still has room. (The count actually transferable is `a.maxStack - a.count`.)
 */
export function canMerge(a: ItemStack, b: ItemStack): boolean {
  return (
    a.itemId === b.itemId &&
    !isTool(a) &&
    !isTool(b) &&
    a.count < a.maxStack
  );
}

/**
 * Apply one point of wear to a tool.
 *
 * - Non-tools are returned unchanged (same reference).
 * - Tools return a NEW stack with durability reduced by one.
 * - When durability would reach 0 the tool breaks and `null` is returned.
 */
export function damageTool(s: ItemStack): ItemStack | null {
  if (s.durability === undefined) return s;
  const next = s.durability - 1;
  if (next <= 0) return null;
  return { ...s, durability: next };
}
