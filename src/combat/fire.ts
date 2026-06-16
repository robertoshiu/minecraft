/**
 * fire.ts — PURE burning-timer reducers for lava/fire damage-over-time
 * (Phase 6b).
 *
 * The burning timer is TRANSIENT loop state (it lives in main.ts module scope,
 * NOT on Player / SurvivalState / PhysicsState — mirroring how the knockback
 * channel sits outside PhysicsState). These reducers keep the ignite/decay and
 * the damage cadence testable without the engine. The fire_resistance NEGATION
 * is enforced at the applyPlayerDamage("fire") call site (Task 1), NOT here —
 * these functions describe the timer only.
 */

/**
 * Advance the burning timer one tick.
 *  - If `inLava`, the timer is REFRESHED to at least `igniteTicks` (standing in
 *    lava keeps you alight; leaving lets it count down).
 *  - Otherwise it decays by one tick, floored at 0.
 *
 * Refresh-then-decay-net: when inLava we return `max(current, igniteTicks)` (so
 * a longer existing burn is kept; the caller always gets back the post-advance
 * value, never the raw igniteTicks constant unconditionally).
 */
export function nextBurningTicks(
  current: number,
  inLava: boolean,
  igniteTicks: number,
): number {
  if (inLava) return Math.max(current, igniteTicks);
  return current > 0 ? current - 1 : 0;
}

/**
 * Whether a fire-damage application is due THIS tick, given the burning timer
 * value AFTER this tick's advance/decrement (the post-advance value) and the
 * damage interval. Fires on every `interval`-th tick of remaining burn. With
 * IGNITE_TICKS=30, INTERVAL=10 a single dip in lava yields hits at
 * burningTicks 30, 20, 10 → 3 applications, then none at 0 (clean tail).
 *
 * NOTE: while in sustained lava contact the timer is held at IGNITE_TICKS by
 * `nextBurningTicks`, so `IGNITE_TICKS % interval === 0` is TRUE every tick at
 * the function level (e.g. 30 % 10 === 0). The once-per-interval cadence for
 * sustained contact is enforced by the i-frame layer at the call site, NOT by
 * this function — which is why `DAMAGE_INTERVAL >= 10` (the i-frame window) is
 * load-bearing.
 */
export function fireDamageDue(burningTicks: number, interval: number): boolean {
  if (burningTicks <= 0) return false;
  return burningTicks % interval === 0;
}
