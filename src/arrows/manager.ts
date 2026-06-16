/**
 * manager.ts — the registry of live arrows (Phase 5). Mirrors MobManager: a
 * Map<number, Arrow> with monotonic, never-reused ids; spawn/despawn/all/count.
 * The cap (ARROW_CAP) is enforced by the CALLER via canFireArrow(count) before
 * spawn — the manager itself is a pure registry.
 */

import type { Vec3 } from "../mobs/entity";
import { Arrow } from "./entity";
import { ARROW_CAP } from "../rules/mc-1.20";

/** True iff another arrow may be fired given the current live count. */
export function canFireArrow(currentCount: number): boolean {
  return currentCount < ARROW_CAP;
}

export class ArrowManager {
  /** Live arrows by id. */
  readonly arrows: Map<number, Arrow> = new Map();
  /** Next id to hand out (monotonic; never reused). */
  private nextId = 1;

  /** Spawn an arrow; returns it. Caller must gate on canFireArrow() first. */
  spawn(origin: Vec3, velocity: Vec3, shooterId = -1): Arrow {
    const id = this.nextId++;
    const arrow = new Arrow(id, origin, velocity, shooterId);
    this.arrows.set(id, arrow);
    return arrow;
  }

  /** Remove an arrow by id. Returns true iff one was removed. */
  despawn(id: number): boolean {
    return this.arrows.delete(id);
  }

  /** All live arrows (snapshot array). */
  all(): Arrow[] {
    return [...this.arrows.values()];
  }

  /** Number of live arrows. */
  count(): number {
    return this.arrows.size;
  }
}
