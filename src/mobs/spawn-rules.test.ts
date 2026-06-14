import { describe, it, expect } from "vitest";
import {
  canSpawnHostileAt,
  canSpawnPassiveAt,
  shouldDespawn,
  randomSpawnOffset,
  canSpawnMore,
  SPAWN_RADIUS,
} from "./spawn-rules";
import { Mob } from "./entity";
import { Blocks, MOB_CAP, LIGHT } from "../rules/mc-1.20";

function makeMob(lastDamageTick: number): Mob {
  const m = new Mob(1, "zombie", { x: 0, y: 0, z: 0 });
  m.lastDamageTick = lastDamageTick;
  return m;
}

describe("canSpawnHostileAt", () => {
  it("allows spawn at night in darkness with floor + headroom", () => {
    expect(canSpawnHostileAt(LIGHT.HOSTILE_MAX, true, true, true)).toBe(true);
    expect(canSpawnHostileAt(0, true, true, true)).toBe(true);
  });

  it("rejects when it is day even in darkness", () => {
    expect(canSpawnHostileAt(0, false, true, true)).toBe(false);
  });

  it("rejects when skylight exceeds HOSTILE_MAX", () => {
    expect(canSpawnHostileAt(LIGHT.HOSTILE_MAX + 1, true, true, true)).toBe(false);
  });

  it("rejects without a floor", () => {
    expect(canSpawnHostileAt(0, true, false, true)).toBe(false);
  });

  it("rejects without headroom", () => {
    expect(canSpawnHostileAt(0, true, true, false)).toBe(false);
  });
});

describe("canSpawnPassiveAt", () => {
  it("allows spawn by day on grass in bright light with headroom", () => {
    expect(canSpawnPassiveAt(LIGHT.PASSIVE_MIN, false, Blocks.GRASS, true)).toBe(true);
    expect(canSpawnPassiveAt(LIGHT.SKY_MAX, false, Blocks.GRASS, true)).toBe(true);
  });

  it("rejects at night", () => {
    expect(canSpawnPassiveAt(LIGHT.SKY_MAX, true, Blocks.GRASS, true)).toBe(false);
  });

  it("rejects when skylight below PASSIVE_MIN", () => {
    expect(canSpawnPassiveAt(LIGHT.PASSIVE_MIN - 1, false, Blocks.GRASS, true)).toBe(false);
  });

  it("rejects on a non-grass floor block", () => {
    expect(canSpawnPassiveAt(LIGHT.SKY_MAX, false, Blocks.STONE, true)).toBe(false);
    expect(canSpawnPassiveAt(LIGHT.SKY_MAX, false, Blocks.DIRT, true)).toBe(false);
  });

  it("rejects without headroom", () => {
    expect(canSpawnPassiveAt(LIGHT.SKY_MAX, false, Blocks.GRASS, false)).toBe(false);
  });
});

describe("shouldDespawn (U4 combat grace)", () => {
  it("never despawns a mob damaged within the last 40 ticks, even when far", () => {
    const mob = makeMob(100);
    // currentTick - lastDamageTick = 39 < 40 -> in combat
    expect(shouldDespawn(mob, 1000, 10_000, 139)).toBe(false);
  });

  it("despawns when far, timed out, and not recently damaged", () => {
    const mob = makeMob(100);
    // currentTick - lastDamageTick = 40 (not < 40) -> grace over
    expect(shouldDespawn(mob, 33, 600, 140)).toBe(true);
  });

  it("does not despawn within despawn distance", () => {
    const mob = makeMob(0);
    expect(shouldDespawn(mob, 32, 100_000, 100_000)).toBe(false);
  });

  it("does not despawn before the far-timeout elapses", () => {
    const mob = makeMob(0);
    expect(shouldDespawn(mob, 1000, 599, 100_000)).toBe(false);
  });

  it("despawns exactly at distance>32 and ticksFar>=600", () => {
    const mob = makeMob(0);
    expect(shouldDespawn(mob, 32.0001, 600, 100_000)).toBe(true);
  });
});

describe("canSpawnMore (mob cap)", () => {
  it("allows hostile spawns below the hostile cap", () => {
    expect(canSpawnMore("hostile", MOB_CAP.HOSTILE - 1)).toBe(true);
  });

  it("blocks hostile spawns at the hostile cap", () => {
    expect(canSpawnMore("hostile", MOB_CAP.HOSTILE)).toBe(false);
    expect(canSpawnMore("hostile", MOB_CAP.HOSTILE + 1)).toBe(false);
  });

  it("allows passive spawns below the passive cap", () => {
    expect(canSpawnMore("passive", MOB_CAP.PASSIVE - 1)).toBe(true);
  });

  it("blocks passive spawns at the passive cap", () => {
    expect(canSpawnMore("passive", MOB_CAP.PASSIVE)).toBe(false);
  });
});

describe("randomSpawnOffset", () => {
  it("produces points whose magnitude is within the [min, max] ring", () => {
    let seed = 0;
    // Deterministic pseudo-random sequence in [0, 1).
    const rng = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let i = 0; i < 1000; i++) {
      const { dx, dz } = randomSpawnOffset(rng);
      const mag = Math.hypot(dx, dz);
      expect(mag).toBeGreaterThanOrEqual(SPAWN_RADIUS.min - 1e-9);
      expect(mag).toBeLessThanOrEqual(SPAWN_RADIUS.max + 1e-9);
    }
  });

  it("hits the min radius when the radius draw is 0", () => {
    const draws = [0, 0];
    let i = 0;
    const rng = (): number => draws[i++ % draws.length] ?? 0;
    const { dx, dz } = randomSpawnOffset(rng);
    expect(Math.hypot(dx, dz)).toBeCloseTo(SPAWN_RADIUS.min, 6);
  });

  it("is deterministic given the same rng sequence", () => {
    const make = (): (() => number) => {
      const seq = [0.1, 0.9, 0.5, 0.2];
      let i = 0;
      return () => seq[i++ % seq.length] ?? 0;
    };
    expect(randomSpawnOffset(make())).toEqual(randomSpawnOffset(make()));
  });
});
