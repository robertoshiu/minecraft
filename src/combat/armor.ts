/**
 * armor.ts — PURE armor damage-reduction math.
 *
 * MC-style additive model: each defense point reduces incoming damage by
 * ARMOR_REDUCTION_PER_POINT (4%), capped at ARMOR_MAX_REDUCTION (80%). The
 * health economy is integer half-hearts, so the result is rounded to an
 * integer. Resistance/status-effects are DEFERRED (Phase 5), so the order is
 * simply armor → clamp.
 *
 * No Babylon, no game state — a single pure function.
 */

import {
  ARMOR_REDUCTION_PER_POINT,
  ARMOR_MAX_REDUCTION,
} from "../rules/mc-1.20";

/**
 * Reduce `damage` (half-hearts) by `defensePoints` of armor.
 *
 * - Reduction fraction = min(defensePoints × 4%, 80%).
 * - Result rounded to the nearest integer half-heart (never below 0).
 * - 0 defense → damage unchanged (still rounded to an integer).
 */
export function armorReduction(damage: number, defensePoints: number): number {
  const fraction = Math.min(
    defensePoints * ARMOR_REDUCTION_PER_POINT,
    ARMOR_MAX_REDUCTION,
  );
  const reduced = damage * (1 - fraction);
  return Math.max(0, Math.round(reduced));
}
