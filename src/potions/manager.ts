/**
 * manager.ts — registry of live splash potions (Phase 6b). Mirrors ArrowManager
 * (Map<number, SplashPotion>, monotonic ids) with its OWN cap (SPLASH_POTION_CAP,
 * separate from ARROW_CAP).
 */

import type { Vec3 } from "../mobs/entity";
import { SplashPotion, type SplashEffect } from "./entity";
import { SPLASH_POTION_CAP } from "../rules/mc-1.20";

/** True iff another splash potion may be thrown given the current live count. */
export function canThrowSplash(currentCount: number): boolean {
  return currentCount < SPLASH_POTION_CAP;
}

export class SplashPotionManager {
  readonly potions: Map<number, SplashPotion> = new Map();
  private nextId = 1;

  spawn(origin: Vec3, velocity: Vec3, effect: SplashEffect): SplashPotion {
    const id = this.nextId++;
    const p = new SplashPotion(id, origin, velocity, effect);
    this.potions.set(id, p);
    return p;
  }

  despawn(id: number): boolean {
    return this.potions.delete(id);
  }

  all(): SplashPotion[] {
    return [...this.potions.values()];
  }

  count(): number {
    return this.potions.size;
  }
}
