/**
 * stats.ts — pure SURVIVAL stats logic (hunger, saturation, exhaustion,
 * health, eating) for the player.
 *
 * Framework-free: NO Babylon, NO world/collision/inventory access. This module
 * owns only the math of a single player's survival economy as verified against
 * the Minecraft 1.20 reference (see src/rules/mc-1.20.ts).
 *
 * The verified MC economy modelled here:
 *   - Activity adds *exhaustion*. Every 4.0 exhaustion drains 1 saturation
 *     (if any), otherwise 1 food. This is the exhaustion -> saturation -> food
 *     cascade.
 *   - When well-fed (food >= 18) and not at full health, the player slowly
 *     regenerates: +1 HP every 80 ticks, which itself costs 6.0 exhaustion
 *     (so each regenerated heart drains ~1.5 saturation via the cascade).
 *   - At 0 food the player starves: -1 HP every 80 ticks.
 *
 * All magic numbers originate in src/rules/mc-1.20.ts.
 */

import { HUNGER, EXHAUSTION, HEALTH } from "../rules/mc-1.20";

/**
 * Mutable per-player survival state.
 *
 * - `health`      current health in half-heart points (0..HEALTH.MAX = 20).
 * - `food`        current food/hunger level (0..HUNGER.MAX_FOOD = 20).
 * - `saturation`  hidden saturation reserve (0..food; never exceeds food).
 * - `exhaustion`  accumulated activity cost (0..HUNGER.MAX_EXHAUSTION = 4);
 *                 each full 4.0 is consumed to drain saturation/food.
 * - `regenTimer`  ticks accumulated toward the next natural-regen heart.
 * - `starveTimer` ticks accumulated toward the next starvation-damage tick.
 * - `lastDamageTick` absolute tick of the last hit through the damage chokepoint (i-frames). -1 = never.
 */
export interface SurvivalState {
  health: number;
  food: number;
  saturation: number;
  exhaustion: number;
  regenTimer: number;
  starveTimer: number;
  /** Absolute tick of the last hit through the damage chokepoint (i-frames). -1 = never. */
  lastDamageTick: number;
}

/**
 * Create a fresh, full survival state: health 20, food 20, saturation 5,
 * exhaustion 0, both timers 0. (Matches a freshly-spawned MC player.)
 */
export function makeSurvivalState(): SurvivalState {
  return {
    health: HEALTH.MAX,
    food: HUNGER.MAX_FOOD,
    saturation: 5,
    exhaustion: 0,
    regenTimer: 0,
    starveTimer: 0,
    lastDamageTick: -1,
  };
}

/**
 * Add `amount` of exhaustion, then run the MC exhaustion cascade: while
 * exhaustion >= MAX_EXHAUSTION (4), consume 4 exhaustion and drain 1 point of
 * saturation if any remains, otherwise 1 point of food.
 */
export function addExhaustion(s: SurvivalState, amount: number): void {
  s.exhaustion += amount;
  while (s.exhaustion >= HUNGER.MAX_EXHAUSTION) {
    s.exhaustion -= HUNGER.MAX_EXHAUSTION;
    if (s.saturation > 0) {
      s.saturation = Math.max(0, s.saturation - 1);
    } else {
      s.food = Math.max(0, s.food - 1);
    }
  }
}

/**
 * Eat a food item: raise food by `hunger` (capped at MAX_FOOD), then raise
 * saturation by `saturation` — but MC caps the resulting saturation at the new
 * food level (saturation can never exceed food).
 */
export function eat(s: SurvivalState, hunger: number, saturation: number): void {
  s.food = Math.min(HUNGER.MAX_FOOD, s.food + hunger);
  s.saturation = Math.min(s.food, s.saturation + saturation);
}

/**
 * Apply `amount` of damage: reduce health (floored at 0) and add the
 * take-damage exhaustion cost (which feeds the cascade).
 */
export function damage(s: SurvivalState, amount: number): void {
  s.health = Math.max(0, s.health - amount);
  addExhaustion(s, EXHAUSTION.TAKE_DAMAGE);
}

/** Heal `amount` of health, capped at HEALTH.MAX. */
export function heal(s: SurvivalState, amount: number): void {
  s.health = Math.min(HEALTH.MAX, s.health + amount);
}

/**
 * Advance one game tick (20 TPS): handle natural regeneration and starvation.
 *
 * Regen: when food >= REGEN_FOOD_THRESHOLD (18) AND saturation > 0 AND health
 * below max, accumulate regenTimer; on reaching REGEN_INTERVAL_TICKS (80) heal
 * 1, add REGEN_EXHAUSTION_COST (6) exhaustion, and reset the timer. Otherwise
 * the regen timer resets.
 *
 * Starvation: when food === 0, accumulate starveTimer; on reaching
 * STARVE_INTERVAL_TICKS (80) deal 1 damage (floored at 0) and reset the timer.
 * Otherwise the starve timer resets.
 */
export function tickSurvival(s: SurvivalState): void {
  // Natural regeneration.
  if (
    s.food >= HUNGER.REGEN_FOOD_THRESHOLD &&
    s.saturation > 0 &&
    s.health < HEALTH.MAX
  ) {
    s.regenTimer++;
    if (s.regenTimer >= HUNGER.REGEN_INTERVAL_TICKS) {
      heal(s, 1);
      addExhaustion(s, HUNGER.REGEN_EXHAUSTION_COST);
      s.regenTimer = 0;
    }
  } else {
    s.regenTimer = 0;
  }

  // Starvation.
  if (s.food === 0) {
    s.starveTimer++;
    if (s.starveTimer >= HUNGER.STARVE_INTERVAL_TICKS) {
      s.health = Math.max(0, s.health - 1);
      s.starveTimer = 0;
    }
  } else {
    s.starveTimer = 0;
  }
}

/** Sprinting is allowed only while food is strictly above SPRINT_DISABLE_FOOD (6). */
export function canSprint(s: SurvivalState): boolean {
  return s.food > HUNGER.SPRINT_DISABLE_FOOD;
}

/** True once health has reached 0. */
export function isDead(s: SurvivalState): boolean {
  return s.health <= 0;
}
