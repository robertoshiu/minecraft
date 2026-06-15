/**
 * mining.ts — PURE break-time calculation (tools matter, spec §4.3).
 *
 * breakTicks(blockId, heldDef) returns the whole number of fixed 20 Hz ticks a
 * block takes to break: base seconds (BLOCK_HARDNESS) ÷ tier speed multiplier,
 * converted to ticks and rounded up to at least one. No Babylon, no world, no
 * mutation — the caller accumulates these on the fixed tick.
 *
 *  - Infinity hardness (e.g. BEDROCK) → Infinity ticks (never breaks).
 *  - Missing hardness → a fast hand-break fallback (~0.5 s) so unlisted blocks
 *    aren't accidentally unbreakable.
 */

import {
  BLOCK_HARDNESS,
  TOOL_TIER_MULTIPLIER,
  TICKS_PER_SECOND,
  type BlockId,
} from "../rules/mc-1.20";
import type { ItemDef } from "../rules/items";

/** Hand-break seconds for blocks absent from BLOCK_HARDNESS. */
const DEFAULT_HARDNESS_SECONDS = 0.5;

/** Whole fixed-ticks to break `blockId` with `heldDef` (null = bare hand). */
export function breakTicks(blockId: BlockId, heldDef: ItemDef | null): number {
  const hardness = BLOCK_HARDNESS[blockId] ?? DEFAULT_HARDNESS_SECONDS;
  if (!Number.isFinite(hardness)) return Infinity; // unbreakable (e.g. bedrock)

  const tier =
    heldDef !== null && heldDef.kind === "tool" && heldDef.toolTier !== undefined
      ? heldDef.toolTier
      : "none";
  const multiplier = TOOL_TIER_MULTIPLIER[tier];

  const seconds = hardness / multiplier;
  return Math.max(1, Math.ceil(seconds * TICKS_PER_SECOND));
}
