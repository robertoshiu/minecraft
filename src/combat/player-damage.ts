/**
 * player-damage.ts — the player-side combat chokepoint (Phase 6a/6b).
 *
 * EXTRACTED from mob-driver.ts so controller.ts can route fall damage through
 * the chokepoint WITHOUT a controller → mob-driver → controller import cycle
 * (mob-driver imports `type { Player }` from controller; a runtime import back
 * would be circular). mob-driver re-exports both functions so its existing
 * tests/imports are unchanged.
 *
 * applyPlayerDamage applies, in order: armor reduction (skipped for fall/fire) →
 * resistance → clamp → i-frame gate → durability wear (skipped for fall/fire) →
 * survival damage. `source` defaults to "melee" so pre-Phase-6a call sites are
 * byte-identical. Fall damage (MC-accurate) ignores armor and does not wear it,
 * but still honours Resistance and i-frames. Fire damage also skips armor and
 * durability wear, and is FULLY negated (not merely reduced) when fire_resistance
 * is active. Poison/starvation do NOT pass through here (they write health directly).
 */

import type { Player } from "../player/controller";
import { damage } from "../survival/stats";
import { damageTool } from "../inventory/stack";
import { armorReduction } from "./armor";
import { isInvulnerable } from "./iframes";
import { resistanceFraction, hasEffect } from "../effects/status";
import { knockbackImpulse } from "./knockback";
import { ARMOR_SLOTS } from "../inventory/equipment";

/**
 * Where a hit came from. Drives whether armor (and its wear) applies.
 * - "melee" / "explosion": armor reduces damage and wears on hit.
 * - "fall": skips armor and durability wear; still honours Resistance and i-frames.
 * - "fire": skips armor and durability wear like fall, AND is FULLY negated
 *   (not merely reduced) when the fire_resistance effect is active.
 */
export type DamageSource = "melee" | "explosion" | "fall" | "fire";

export function applyPlayerDamage(
  player: Player,
  rawAmount: number,
  currentTick: number,
  source: DamageSource = "melee",
): void {
  // Environmental hits clear any lingering mob attribution so a fall/fire death
  // is never mis-attributed to an earlier mob hit.
  if (source === "fall" || source === "fire") {
    player.lastDamageMobType = null;
  }

  // Fire is FULLY negated (not merely reduced) when fire_resistance is active.
  // Keyed on source === "fire" only, so all other sources are byte-identical.
  if (source === "fire" && hasEffect(player.effects, "fire_resistance")) return;
  const applyArmor = source !== "fall" && source !== "fire";
  const defense = player.equipment.totalDefense();
  const armored = applyArmor ? armorReduction(rawAmount, defense) : rawAmount;
  const fraction = resistanceFraction(player.effects);
  const effective =
    fraction > 0 ? Math.max(0, Math.round(armored * (1 - fraction))) : armored;
  if (effective <= 0) return; // fully absorbed — no health loss, no durability wear
  if (isInvulnerable(player.survival.lastDamageTick, currentTick)) return;
  if (applyArmor) {
    for (const slot of ARMOR_SLOTS) {
      const piece = player.equipment.get(slot);
      if (piece !== null) {
        player.equipment.set(slot, damageTool(piece));
      }
    }
  }
  damage(player.survival, effective);
  player.survival.lastDamageTick = currentTick;
}

/**
 * Add a horizontal knockback impulse to the player, pushing AWAY from `fromXZ`.
 * Reuses the pure knockbackImpulse. XZ feeds the decaying knockback channel
 * (blended in controller.update, Task 5); the upward component is written to
 * physics.vy, mirroring attackMob.
 */
export function applyPlayerKnockback(
  player: Player,
  fromXZ: { x: number; z: number },
  strength?: number,
): void {
  const k = knockbackImpulse(fromXZ, player.feet, strength);
  player.knockbackX += k.x;
  player.knockbackZ += k.z;
  player.physics.vy = k.y;
}
