/**
 * status.ts — PURE status-effect engine (Phase 5).
 *
 * Effects live in an EffectState (a list of ActiveEffect) carried on the Player
 * (player.effects) — deliberately SEPARATE from SurvivalState, whose strict
 * makeSurvivalState() toEqual shape test forbids new fields and whose 13
 * regen/starve tests must stay byte-identical.
 *
 * Stack rules (MC-style): applying an effect of the same type REPLACES the
 * stored one when the incoming amplifier is HIGHER, REFRESHES the duration when
 * the amplifier is EQUAL (keeps the longer remaining), and is IGNORED when the
 * incoming amplifier is LOWER. tickEffects runs the periodic regen/poison and
 * reverse-iterates to expire finished effects in place.
 *
 * Instant effects (instant_health / instant_damage) apply ONCE on drink (handled
 * by applyEffect's caller via applyInstant) and are never stored with a duration.
 *
 * No Babylon, no world. Imports the survival heal()/SurvivalState only to mutate
 * health for regen/poison/instant — it NEVER calls tickSurvival or damage().
 */

import { EFFECT_TUNING } from "../rules/mc-1.20";
import { heal, type SurvivalState } from "../survival/stats";

/** The Phase-5 effect roster. Numeric values are STABLE — they persist to disk. */
export type EffectType =
  | "regeneration"
  | "instant_health"
  | "instant_damage"
  | "poison"
  | "resistance"
  | "strength"
  | "swiftness"
  | "fire_resistance";

/** Stable type→int map for persistence (do NOT renumber existing entries). */
export const EFFECT_TYPE_IDS: Record<EffectType, number> = {
  regeneration: 0,
  instant_health: 1,
  instant_damage: 2,
  poison: 3,
  resistance: 4,
  strength: 5,
  swiftness: 6,
  fire_resistance: 7,
};

const ID_TO_EFFECT: readonly EffectType[] = [
  "regeneration",
  "instant_health",
  "instant_damage",
  "poison",
  "resistance",
  "strength",
  "swiftness",
  "fire_resistance",
];

/** Map a persisted int back to its EffectType, or null if unknown. */
export function effectTypeFromId(id: number): EffectType | null {
  return ID_TO_EFFECT[id] ?? null;
}

/** Instant effects apply once and are never stored with a duration. */
export function isInstant(type: EffectType): boolean {
  return type === "instant_health" || type === "instant_damage";
}

/**
 * One active effect on the player.
 * - `amplifier` is 0-based (0 = level I, 1 = level II, …).
 * - `ticksRemaining` counts DOWN; an effect at 0 is expired and removed.
 * - `periodTimer` accumulates UP toward the next periodic tick (regen/poison);
 *   it is scratch state, not persisted (defaults to 0 on load).
 */
export interface ActiveEffect {
  type: EffectType;
  amplifier: number;
  ticksRemaining: number;
  periodTimer: number;
}

/** The player's whole set of active effects. */
export interface EffectState {
  list: ActiveEffect[];
}

/** A fresh, empty effect state. */
export function makeEffectState(): EffectState {
  return { list: [] };
}

/** Find the active effect of `type`, or undefined. */
export function getEffect(s: EffectState, type: EffectType): ActiveEffect | undefined {
  return s.list.find((e) => e.type === type);
}

/** True iff `type` is active. */
export function hasEffect(s: EffectState, type: EffectType): boolean {
  return getEffect(s, type) !== undefined;
}

/** The amplifier of the active effect of `type`, or -1 if absent. */
export function effectAmplifier(s: EffectState, type: EffectType): number {
  return getEffect(s, type)?.amplifier ?? -1;
}

/**
 * Apply a (non-instant) effect with MC stack rules:
 *  - higher amplifier REPLACES (new amplifier + new duration),
 *  - equal amplifier REFRESHES (keeps the LONGER remaining duration),
 *  - lower amplifier is IGNORED.
 * Instant effects must NOT be passed here — route them through applyInstant.
 */
export function applyEffect(
  s: EffectState,
  type: EffectType,
  amplifier: number,
  ticks: number,
): void {
  if (isInstant(type)) return; // instants are not stored
  const existing = getEffect(s, type);
  if (existing === undefined) {
    s.list.push({ type, amplifier, ticksRemaining: ticks, periodTimer: 0 });
    return;
  }
  if (amplifier > existing.amplifier) {
    existing.amplifier = amplifier;
    existing.ticksRemaining = ticks;
    existing.periodTimer = 0;
  } else if (amplifier === existing.amplifier) {
    existing.ticksRemaining = Math.max(existing.ticksRemaining, ticks);
  }
  // amplifier < existing → ignored
}

/**
 * Apply an INSTANT effect to `survival` immediately (drink time). Instant Health
 * heals; Instant Damage writes health directly floored at 0 WITHOUT going through
 * damage() (no take-damage exhaustion, no i-frames — matches MC instant harm).
 * Non-instant types are a no-op here.
 */
export function applyInstant(
  survival: SurvivalState,
  type: EffectType,
  amplifier: number,
): void {
  const level = amplifier + 1;
  if (type === "instant_health") {
    heal(survival, EFFECT_TUNING.INSTANT_HEALTH_PER_LEVEL * level);
  } else if (type === "instant_damage") {
    survival.health = Math.max(
      0,
      survival.health - EFFECT_TUNING.INSTANT_DAMAGE_PER_LEVEL * level,
    );
  }
}

/** Regen interval (ticks) for an amplifier, clamped to a floor of 10. */
function regenInterval(amplifier: number): number {
  return Math.max(
    10,
    EFFECT_TUNING.REGEN_INTERVAL - amplifier * EFFECT_TUNING.REGEN_INTERVAL_PER_AMP,
  );
}

/** Poison interval (ticks) for an amplifier, clamped to a floor of 5. */
function poisonInterval(amplifier: number): number {
  return Math.max(
    5,
    EFFECT_TUNING.POISON_INTERVAL - amplifier * EFFECT_TUNING.POISON_INTERVAL_PER_AMP,
  );
}

/**
 * Advance all active effects by one tick AGAINST the player's survival state.
 *
 *  - Regeneration: own periodTimer; every regenInterval(amp) ticks, heal(1).
 *    Does NOT charge exhaustion (MC potions don't drain food) and runs
 *    INDEPENDENTLY of natural regen in tickSurvival (both may fire same tick).
 *  - Poison: own periodTimer; every poisonInterval(amp) ticks, health =
 *    max(1, health - 1). Bypasses i-frames and armor; CANNOT kill (floor 1).
 *  - Other effects (resistance/strength/swiftness/fire_resistance) have no
 *    per-tick action here — they are read by accessors at the relevant sites.
 *  - After ticking, every effect's ticksRemaining is decremented; expired
 *    effects are removed by REVERSE-iterating the list (safe in-place splice).
 *
 * `currentTick` is accepted for symmetry/future use; periodic effects use their
 * own periodTimer so they are deterministic regardless of absolute tick.
 */
export function tickEffects(
  s: EffectState,
  survival: SurvivalState,
  _currentTick: number,
): void {
  for (const e of s.list) {
    if (e.type === "regeneration") {
      e.periodTimer++;
      if (e.periodTimer >= regenInterval(e.amplifier)) {
        heal(survival, 1);
        e.periodTimer = 0;
      }
    } else if (e.type === "poison") {
      e.periodTimer++;
      if (e.periodTimer >= poisonInterval(e.amplifier)) {
        survival.health = Math.max(1, survival.health - 1);
        e.periodTimer = 0;
      }
    }
  }
  // Decrement durations and expire in place (reverse iterate so splice is safe).
  for (let i = s.list.length - 1; i >= 0; i--) {
    const e = s.list[i]!;
    e.ticksRemaining--;
    if (e.ticksRemaining <= 0) s.list.splice(i, 1);
  }
}

// --- Accessors used by the combat / movement glue --------------------------

/** Resistance damage-reduction fraction (0..0.8), 0 when absent. */
export function resistanceFraction(s: EffectState): number {
  const amp = effectAmplifier(s, "resistance");
  if (amp < 0) return 0;
  return Math.min(0.8, EFFECT_TUNING.RESISTANCE_PER_LEVEL * (amp + 1));
}

/** Strength flat melee bonus (half-hearts), 0 when absent. */
export function strengthBonus(s: EffectState): number {
  const amp = effectAmplifier(s, "strength");
  if (amp < 0) return 0;
  return EFFECT_TUNING.STRENGTH_PER_LEVEL * (amp + 1);
}

/** Swiftness speed multiplier (1 when absent). */
export function swiftnessMultiplier(s: EffectState): number {
  const amp = effectAmplifier(s, "swiftness");
  if (amp < 0) return 1;
  return 1 + EFFECT_TUNING.SWIFTNESS_PER_LEVEL * (amp + 1);
}
