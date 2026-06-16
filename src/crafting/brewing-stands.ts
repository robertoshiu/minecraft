/**
 * brewing-stands.ts — the live registry of placed brewing stands (Phase 6b).
 *
 * Block-entity-style: a Map keyed by "x,y,z" (mirroring how the world columns
 * Map keys by "cx,cz") whose values are per-placed-stand BrewingStand logic
 * objects. Placed stands are sparse, so the whole registry serializes to a
 * small JSON blob — added to the save behind SAVE_VERSION 6→7, exactly like the
 * mobs blob was added in container format 2.
 */

import { BrewingStand, type BrewingStandSave } from "./brewing-stand";

/** A persisted stand: its block coords + its flattened contents. */
export interface BrewingStandEntrySave {
  x: number;
  y: number;
  z: number;
  stand: BrewingStandSave;
}

/** The "x,y,z" key for a stand at integer block coords. */
function keyOf(x: number, y: number, z: number): string {
  return `${String(x)},${String(y)},${String(z)}`;
}

export class BrewingStands {
  private readonly stands = new Map<string, BrewingStand>();

  /** The live stand at these coords, creating + registering one if absent. */
  getOrCreate(x: number, y: number, z: number): BrewingStand {
    const key = keyOf(x, y, z);
    let stand = this.stands.get(key);
    if (stand === undefined) {
      stand = new BrewingStand();
      this.stands.set(key, stand);
    }
    return stand;
  }

  /** The live stand at these coords, or null if none is registered. */
  peek(x: number, y: number, z: number): BrewingStand | null {
    return this.stands.get(keyOf(x, y, z)) ?? null;
  }

  /** Remove the stand at these coords (e.g. when the block is broken). */
  remove(x: number, y: number, z: number): boolean {
    return this.stands.delete(keyOf(x, y, z));
  }

  /** Advance every registered stand by one game tick. */
  tickAll(): void {
    for (const stand of this.stands.values()) stand.tick();
  }

  /** Number of registered stands (for tests / diagnostics). */
  count(): number {
    return this.stands.size;
  }

  /** Flatten the whole registry into plain-data save entries. */
  toSave(): BrewingStandEntrySave[] {
    const out: BrewingStandEntrySave[] = [];
    for (const [key, stand] of this.stands) {
      const [x, y, z] = key.split(",").map(Number) as [number, number, number];
      out.push({ x, y, z, stand: stand.toSave() });
    }
    return out;
  }

  /** Rebuild a registry from saved entries (defensive: skips bad rows). */
  static fromSave(entries: readonly BrewingStandEntrySave[]): BrewingStands {
    const reg = new BrewingStands();
    for (const e of entries) {
      if (
        typeof e.x !== "number" ||
        typeof e.y !== "number" ||
        typeof e.z !== "number" ||
        e.stand === undefined
      ) {
        continue; // skip malformed row — never throw
      }
      reg.stands.set(keyOf(e.x, e.y, e.z), BrewingStand.fromSave(e.stand));
    }
    return reg;
  }
}
