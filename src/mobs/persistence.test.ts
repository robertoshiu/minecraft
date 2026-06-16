import { describe, it, expect } from "vitest";
import { Mob } from "./entity";
import {
  toMobSave,
  fromMobSave,
  serializeMobs,
  deserializeMobs,
  encodeMobs,
  decodeMobs,
  type MobSave,
} from "./persistence";
import { applyEffect } from "../effects/status";

/** A passive cow with breeding state and a custom `extra` field set. */
function makeCow(): Mob {
  const mob = new Mob(1, "cow", { x: 10.5, y: 64, z: -3.25 });
  mob.velocity = { x: 0.1, y: -0.05, z: 0.2 };
  mob.health = 7;
  mob.aiState = "wander";
  mob.aiTimer = 12;
  mob.age = 400;
  mob.lastDamageTick = 350;
  mob.breedCooldown = 60;
  mob.inLove = true;
  mob.extra = { graze: 3, foo: -2.5 };
  return mob;
}

/** A hostile zombie that has been chasing and recently hit. */
function makeZombie(): Mob {
  const mob = new Mob(2, "zombie", { x: -8, y: 70.25, z: 100 });
  mob.velocity = { x: -0.3, y: 0, z: 0.15 };
  mob.health = 13;
  mob.aiState = "chase";
  mob.aiTimer = 5;
  mob.age = 1234;
  mob.lastDamageTick = 1200;
  mob.breedCooldown = 0;
  mob.inLove = false;
  mob.extra = {};
  return mob;
}

/** A creeper mid-fuse, carrying extra blast-radius bookkeeping. */
function makeFusingCreeper(): Mob {
  const mob = new Mob(3, "creeper", { x: 2.5, y: 65, z: 2.5 });
  mob.velocity = { x: 0, y: 0, z: 0 };
  mob.health = 20;
  mob.aiState = "fuse";
  mob.aiTimer = 0;
  mob.age = 90;
  mob.lastDamageTick = 80;
  mob.breedCooldown = 0;
  mob.inLove = false;
  mob.fuseTimer = 18;
  mob.extra = { blastRadius: 3, charged: 1, fuseLength: 30 };
  return mob;
}

/** Assert that a restored mob matches the original across all saved fields. */
function expectMobMatches(restored: Mob, original: Mob): void {
  expect(restored.id).toBe(original.id);
  expect(restored.type).toBe(original.type);
  expect(restored.feet).toEqual(original.feet);
  expect(restored.velocity).toEqual(original.velocity);
  expect(restored.health).toBe(original.health);
  expect(restored.aiState).toBe(original.aiState);
  expect(restored.aiTimer).toBe(original.aiTimer);
  expect(restored.age).toBe(original.age);
  expect(restored.lastDamageTick).toBe(original.lastDamageTick);
  expect(restored.breedCooldown).toBe(original.breedCooldown);
  expect(restored.inLove).toBe(original.inLove);
  expect(restored.fuseTimer).toBe(original.fuseTimer);
  expect(restored.extra).toEqual(original.extra);
}

describe("toMobSave / fromMobSave (single mob)", () => {
  it("flattens feet/velocity into scalar fields", () => {
    const save = toMobSave(makeCow());
    expect(save.x).toBe(10.5);
    expect(save.y).toBe(64);
    expect(save.z).toBe(-3.25);
    expect(save.vx).toBe(0.1);
    expect(save.vy).toBe(-0.05);
    expect(save.vz).toBe(0.2);
  });

  it("round-trips a single mob preserving every saved field", () => {
    const original = makeFusingCreeper();
    const restored = fromMobSave(toMobSave(original));
    expectMobMatches(restored, original);
  });

  it("produces a live Mob instance with working methods", () => {
    const restored = fromMobSave(toMobSave(makeZombie()));
    expect(restored).toBeInstanceOf(Mob);
    expect(restored.isHostile()).toBe(true);
    expect(restored.isDead()).toBe(false);
  });

  it("does not alias the live mob's extra map", () => {
    const original = makeCow();
    const save = toMobSave(original);
    original.extra["graze"] = 999;
    expect(save.extra["graze"]).toBe(3);

    const restored = fromMobSave(save);
    save.extra["graze"] = 111;
    expect(restored.extra["graze"]).toBe(3);
  });
});

describe("serializeMobs / deserializeMobs (round-trip a list)", () => {
  it("preserves type, position, velocity, health, aiState, lastDamageTick, fuseTimer, inLove, extra exactly", () => {
    const mobs = [makeCow(), makeZombie(), makeFusingCreeper()];
    const restored = deserializeMobs(serializeMobs(mobs));

    expect(restored).toHaveLength(mobs.length);
    for (let i = 0; i < mobs.length; i++) {
      const orig = mobs[i];
      const back = restored[i];
      expect(orig).toBeDefined();
      expect(back).toBeDefined();
      if (orig === undefined || back === undefined) continue;
      expectMobMatches(back, orig);
    }
  });

  it("preserves the fusing creeper's fuseTimer and extra fields specifically", () => {
    const creeper = makeFusingCreeper();
    const restored = deserializeMobs(serializeMobs([creeper]));
    const back = restored[0];
    expect(back).toBeDefined();
    if (back === undefined) return;
    expect(back.fuseTimer).toBe(18);
    expect(back.extra).toEqual({ blastRadius: 3, charged: 1, fuseLength: 30 });
  });

  it("round-trips an empty list", () => {
    expect(deserializeMobs(serializeMobs([]))).toEqual([]);
  });
});

describe("encodeMobs / decodeMobs (byte round-trip)", () => {
  it("encodes to a Uint8Array", () => {
    const bytes = encodeMobs([makeCow()]);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("round-trips a passive + hostile + fusing creeper through bytes", () => {
    const mobs = [makeCow(), makeZombie(), makeFusingCreeper()];
    const decoded: MobSave[] = decodeMobs(encodeMobs(mobs));
    const restored = deserializeMobs(decoded);

    expect(restored).toHaveLength(mobs.length);
    for (let i = 0; i < mobs.length; i++) {
      const orig = mobs[i];
      const back = restored[i];
      expect(orig).toBeDefined();
      expect(back).toBeDefined();
      if (orig === undefined || back === undefined) continue;
      expectMobMatches(back, orig);
    }
  });

  it("decoded saves carry the exact field values", () => {
    const decoded = decodeMobs(encodeMobs([makeFusingCreeper()]));
    const save = decoded[0];
    expect(save).toBeDefined();
    if (save === undefined) return;
    expect(save.type).toBe("creeper");
    expect(save.x).toBe(2.5);
    expect(save.y).toBe(65);
    expect(save.z).toBe(2.5);
    expect(save.health).toBe(20);
    expect(save.aiState).toBe("fuse");
    expect(save.lastDamageTick).toBe(80);
    expect(save.fuseTimer).toBe(18);
    expect(save.inLove).toBe(false);
    expect(save.extra).toEqual({ blastRadius: 3, charged: 1, fuseLength: 30 });
  });

  it("round-trips an empty list through bytes", () => {
    expect(decodeMobs(encodeMobs([]))).toEqual([]);
  });

  it("throws on bytes that are not a JSON array", () => {
    const bogus = new TextEncoder().encode('{"not":"an array"}');
    expect(() => decodeMobs(bogus)).toThrow();
  });
});

describe("toMobSave / fromMobSave — status effects (Phase 6c)", () => {
  it("round-trips a mob's active effects with periodTimer reset to 0", () => {
    const mob = new Mob(1, "cow", { x: 0, y: 64, z: 0 });
    applyEffect(mob.effects, "poison", 1, 200);
    applyEffect(mob.effects, "regeneration", 0, 400);
    // Advance the timers so periodTimer is non-zero before saving.
    mob.effects.list[0]!.periodTimer = 7;

    const restored = fromMobSave(toMobSave(mob));
    expect(restored.effects.list).toHaveLength(2);
    const poison = restored.effects.list.find((e) => e.type === "poison")!;
    expect(poison.amplifier).toBe(1);
    expect(poison.ticksRemaining).toBe(200);
    expect(poison.periodTimer).toBe(0); // scratch reset on load
  });

  it("a no-effect mob omits the effects key and decodes to no effects", () => {
    const mob = new Mob(2, "pig", { x: 0, y: 0, z: 0 }); // no effects applied
    const save = toMobSave(mob);
    // toMobSave omits the optional key entirely when empty (pre-v8-blob shape).
    expect(save.effects).toBeUndefined();
    const restored = fromMobSave(save);
    expect(restored.effects.list).toEqual([]);
  });
});
