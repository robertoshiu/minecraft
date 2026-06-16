/**
 * passive-ai.ts — wander / breeding behaviour for passive mobs (cow, pig,
 * sheep, chicken).
 *
 * Passive mobs have no target-seeking: they idle, then pick a random heading and
 * amble in that direction for a while, repeating forever. Feeding the right item
 * puts a mob "in love"; two in-love mobs of the same type can breed, producing a
 * baby at their midpoint and entering a long breeding cooldown.
 *
 * Movement reuses the size-aware mob physics (mobStep + tryStepUp). Speed in
 * MOB_STATS is blocks/SECOND, so it is converted to blocks/tick here.
 */

import { Mob, type Vec3 } from "./entity";
import { mobStep, tryStepUp, type SolidQuery } from "./physics";
import { MOB_STATS, type MobType } from "../rules/mob-stats";
import { Items } from "../rules/items";
import { TICKS_PER_SECOND, BABY_SCALE } from "../rules/mc-1.20";

/** Source of randomness in [0, 1). Injected so tests can seed it. */
export type Rng = () => number;

/** Minimum/maximum duration (ticks) of a single wander leg. */
const WANDER_MIN_TICKS = 80;
const WANDER_MAX_TICKS = 160;

/** Duration (ticks) of an idle pause between wander legs. */
const IDLE_MIN_TICKS = 40;
const IDLE_MAX_TICKS = 100;

/**
 * Probability that, when choosing a new action, the mob idles instead of
 * picking a fresh heading to wander toward.
 */
const IDLE_CHANCE = 0.3;

/** Ticks of breeding cooldown applied to both parents after they breed. */
export const BREED_COOLDOWN_TICKS = 6000;

/** `extra` keys used by passive mobs for their per-type production counters. */
const EXTRA_WOOL = "woolGrowth";
const EXTRA_EGG = "eggTimer";

/** Pick an integer in the inclusive range [lo, hi] from `rng`. */
function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * The item that puts a mob of `type` into love mode.
 *
 * Minecraft uses carrots/potatoes/beetroot for pigs, but the item registry has
 * none of those, so pigs fall back to WHEAT (see deviations).
 */
function breedingItem(type: MobType): number {
  switch (type) {
    case "chicken":
      return Items.SEEDS;
    case "cow":
    case "sheep":
    case "pig":
      return Items.WHEAT;
    default:
      return -1; // hostile mobs do not breed
  }
}

/**
 * Advance a passive mob's wander state machine by one tick and apply movement.
 *
 *  - When `aiTimer` runs out, the mob either idles (random pause) or picks a new
 *    random horizontal heading and a wander duration.
 *  - While wandering it walks at its type's speed via `mobStep`, auto-jumping a
 *    1-block ledge via `tryStepUp`; while idle it still falls under gravity.
 *  - Per-tick bookkeeping: decrement `aiTimer`/`breedCooldown`, increment `age`,
 *    and tick the sheep wool / chicken egg production counters.
 */
export function tickPassive(mob: Mob, isSolid: SolidQuery, rng: Rng): void {
  // --- Bookkeeping ---------------------------------------------------------
  mob.age += 1;
  if (mob.breedCooldown > 0) mob.breedCooldown -= 1;

  // Per-type production counters live in `extra` (always non-negative).
  if (mob.type === "sheep") {
    mob.extra[EXTRA_WOOL] = (mob.extra[EXTRA_WOOL] ?? 0) + 1;
  } else if (mob.type === "chicken") {
    mob.extra[EXTRA_EGG] = (mob.extra[EXTRA_EGG] ?? 0) + 1;
  }

  // --- Choose a new action when the current one expires --------------------
  if (mob.aiTimer <= 0) {
    if (rng() < IDLE_CHANCE) {
      mob.aiState = "idle";
      mob.aiTimer = randInt(rng, IDLE_MIN_TICKS, IDLE_MAX_TICKS);
      mob.target = null;
    } else {
      mob.aiState = "wander";
      mob.aiTimer = randInt(rng, WANDER_MIN_TICKS, WANDER_MAX_TICKS);
      // Random heading on the full circle.
      mob.yaw = rng() * Math.PI * 2;
    }
  }

  mob.aiTimer -= 1;

  // --- Apply movement ------------------------------------------------------
  const speedPerTick = MOB_STATS[mob.type].speed / TICKS_PER_SECOND;

  let desired: Vec3;
  if (mob.aiState === "wander") {
    desired = {
      x: Math.cos(mob.yaw) * speedPerTick,
      y: 0,
      z: Math.sin(mob.yaw) * speedPerTick,
    };
    // Auto-jump a 1-block ledge in the direction of travel before stepping.
    tryStepUp(mob, isSolid, desired);
  } else {
    desired = { x: 0, y: 0, z: 0 };
  }

  mobStep(mob, desired, isSolid);
}

/**
 * Feed `itemId` to `mob`. If it is the correct breeding item for the mob's type
 * and the mob is off breeding cooldown, the mob enters love mode and `true` is
 * returned. Otherwise nothing changes and `false` is returned.
 */
export function feed(mob: Mob, itemId: number): boolean {
  if (mob.breedCooldown > 0) return false;
  if (itemId !== breedingItem(mob.type)) return false;
  mob.inLove = true;
  return true;
}

/**
 * Breed two mobs. Succeeds only when both are the same type, both are in love,
 * and both are off breeding cooldown. On success: a baby of the same type is
 * created at the parents' midpoint, both parents enter the breeding cooldown and
 * leave love mode, and the baby is returned. Otherwise returns `null`.
 *
 * @param nextId      Source of a fresh, unique mob id for the baby.
 * @param currentTick Current world tick (recorded on the baby's age baseline).
 */
export function breed(
  a: Mob,
  b: Mob,
  nextId: () => number,
  currentTick: number,
): Mob | null {
  if (a === b) return null;
  if (a.type !== b.type) return null;
  if (!a.inLove || !b.inLove) return null;
  if (a.breedCooldown > 0 || b.breedCooldown > 0) return null;

  const midpoint: Vec3 = {
    x: (a.feet.x + b.feet.x) / 2,
    y: (a.feet.y + b.feet.y) / 2,
    z: (a.feet.z + b.feet.z) / 2,
  };

  const baby = new Mob(nextId(), a.type, midpoint);
  // A freshly bred baby also starts on cooldown so it cannot instantly re-breed.
  baby.breedCooldown = BREED_COOLDOWN_TICKS;
  // Real baby: stamp the per-instance scale so BOTH the hitbox (aabb/physics)
  // and the render root (mob-renderer reads the same key) shrink to BABY_SCALE.
  baby.extra["babyScale"] = BABY_SCALE;

  a.inLove = false;
  b.inLove = false;
  a.breedCooldown = BREED_COOLDOWN_TICKS;
  b.breedCooldown = BREED_COOLDOWN_TICKS;

  // `currentTick` is accepted for callers that timestamp breeding; the Mob's age
  // is measured from spawn, so the baby starts at age 0 regardless.
  void currentTick;

  return baby;
}
