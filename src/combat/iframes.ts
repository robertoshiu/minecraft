/**
 * iframes.ts — PURE invulnerability-frame predicate.
 *
 * After a real hit the player is immune for INVULNERABLE_TICKS. This stops a
 * mob standing inside the player from dealing damage on every 20 Hz tick (and
 * multiple mobs from each landing a hit the same tick). Starvation bypasses
 * this entirely (it does not go through the damage chokepoint).
 */

/** Immunity window in ticks (~0.5 s at 20 Hz — matches MC's 10-tick hurt cooldown). */
export const INVULNERABLE_TICKS = 10;

/**
 * True iff a hit at `currentTick` should be IGNORED because the last damage at
 * `lastDamageTick` is still within the immunity window. A never-damaged
 * sentinel (negative / very old tick) is never invulnerable.
 */
export function isInvulnerable(
  lastDamageTick: number,
  currentTick: number,
  iframeTicks: number = INVULNERABLE_TICKS,
): boolean {
  if (lastDamageTick < 0) return false;
  return currentTick - lastDamageTick < iframeTicks;
}
