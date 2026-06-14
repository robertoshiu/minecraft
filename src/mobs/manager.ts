/**
 * manager.ts — owns the set of live mobs.
 *
 * Spawning assigns a monotonically increasing id. Counts back the spawn-cap
 * logic (MOB_CAP) without this module needing to know the caps itself.
 */

import { Mob, type Vec3 } from "./entity";
import type { MobType } from "../rules/mob-stats";

/** The registry of all live mobs, keyed by id. */
export class MobManager {
  /** Live mobs by id. */
  readonly mobs: Map<number, Mob> = new Map();

  /** Next id to hand out (monotonic; never reused). */
  private nextId = 1;

  /** Spawn a mob of `type` at `pos`; returns the created mob. */
  spawn(type: MobType, pos: Vec3): Mob {
    const id = this.nextId++;
    const mob = new Mob(id, type, pos);
    this.mobs.set(id, mob);
    return mob;
  }

  /**
   * Replace the live set with `mobs` (e.g. on save restore). Clears any existing
   * mobs first and advances the id counter past every restored id so future
   * spawns can never collide with a restored mob's id.
   */
  load(mobs: Mob[]): void {
    this.mobs.clear();
    let maxId = 0;
    for (const mob of mobs) {
      this.mobs.set(mob.id, mob);
      if (mob.id > maxId) maxId = mob.id;
    }
    this.nextId = maxId + 1;
  }

  /** Remove a mob by id. Returns true iff a mob was removed. */
  despawn(id: number): boolean {
    return this.mobs.delete(id);
  }

  /** Look up a mob by id, or undefined if none. */
  get(id: number): Mob | undefined {
    return this.mobs.get(id);
  }

  /** All live mobs (snapshot array). */
  all(): Mob[] {
    return [...this.mobs.values()];
  }

  /** Number of live passive mobs. */
  countPassive(): number {
    let n = 0;
    for (const mob of this.mobs.values()) {
      if (mob.isPassive()) n++;
    }
    return n;
  }

  /** Number of live hostile mobs. */
  countHostile(): number {
    let n = 0;
    for (const mob of this.mobs.values()) {
      if (mob.isHostile()) n++;
    }
    return n;
  }

  /** Total number of live mobs. */
  count(): number {
    return this.mobs.size;
  }
}
