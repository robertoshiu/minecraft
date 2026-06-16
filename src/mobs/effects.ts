/**
 * effects.ts — per-mob status-effect tick (Phase 6c).
 *
 * Mobs carry a real EffectState (mob.effects) and reuse the EXACT player
 * machinery (effects/status.ts): applyEffect to add, tickEffects to advance.
 * Mobs have no survival economy (no food/saturation), so tickMobEffects runs
 * tickEffects against a SCRATCH SurvivalState seeded from mob.health and copies
 * the mutated health back. This reuses the player's poison/regen rules verbatim:
 *   - poison floors health at 1 (CANNOT kill via poison),
 *   - regeneration heals on its own period timer,
 * with no food drain (potion regen never charged food for the player either).
 *
 * v1 imperfection (accepted, documented): SurvivalState has no per-mob maxHealth
 * field; heal() inside tickEffects clamps to HEALTH.MAX (=20). A mob whose
 * MOB_STATS maxHealth is below 20 (e.g. a cow at 10) can over-heal up to 20 via
 * regen. Poison (the common case from tipped arrows / splash) is unaffected
 * (it floors at 1). If a precise per-mob cap is wanted later, add:
 *   mob.health = Math.min(MOB_STATS[mob.type].maxHealth, mob.health);
 * after the tick — do NOT add a field to SurvivalState.
 *
 * Pure: no Babylon, no world. Mutates only mob.health and mob.effects.
 */

import type { Mob } from "./entity";
import { tickEffects } from "../effects/status";
import { makeSurvivalState } from "../survival/stats";

/**
 * Advance `mob.effects` one tick, applying poison/regen to mob.health via the
 * shared player tick. `currentTick` is forwarded for signature symmetry.
 */
export function tickMobEffects(mob: Mob, currentTick: number): void {
  if (mob.effects.list.length === 0) return; // fast-path: nothing to tick
  // Scratch carrier: real SurvivalState shape (no widening), health seeded from
  // the mob. heal()/poison in tickEffects clamp against maxHealth/0/1 the same
  // way; we only read .health back out.
  const scratch = makeSurvivalState();
  scratch.health = mob.health;
  tickEffects(mob.effects, scratch, currentTick);
  mob.health = scratch.health;
}
