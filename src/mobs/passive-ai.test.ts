import { describe, it, expect } from "vitest";
import { Mob } from "./entity";
import type { SolidQuery } from "./physics";
import { tickPassive, feed, breed, BREED_COOLDOWN_TICKS } from "./passive-ai";
import { Items } from "../rules/items";

/** Floor: solid for every block with by < floorTop (surface at y = floorTop). */
function flatFloor(floorTop: number): SolidQuery {
  return (_bx, by, _bz) => by < floorTop;
}

/** Deterministic seeded PRNG (mulberry32) so wander behaviour is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FLOOR_TOP = 64;

function groundedMob(type: "cow" | "pig" | "sheep" | "chicken"): Mob {
  const mob = new Mob(1, type, { x: 0.5, y: FLOOR_TOP, z: 0.5 });
  mob.onGround = true;
  return mob;
}

describe("tickPassive — wandering", () => {
  it("eventually moves the mob across many ticks", () => {
    const isSolid = flatFloor(FLOOR_TOP);
    const mob = groundedMob("cow");
    const rng = mulberry32(12345);

    const startX = mob.feet.x;
    const startZ = mob.feet.z;

    for (let i = 0; i < 600; i++) tickPassive(mob, isSolid, rng);

    const moved = Math.hypot(mob.feet.x - startX, mob.feet.z - startZ);
    expect(moved).toBeGreaterThan(0.5);
  });

  it("changes heading over time (more than one distinct heading)", () => {
    const isSolid = flatFloor(FLOOR_TOP);
    const mob = groundedMob("pig");
    const rng = mulberry32(777);

    const headings = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      tickPassive(mob, isSolid, rng);
      if (mob.aiState === "wander") headings.add(Math.round(mob.yaw * 1000));
    }

    expect(headings.size).toBeGreaterThan(1);
  });

  it("is deterministic for a fixed seed", () => {
    const isSolid = flatFloor(FLOOR_TOP);
    const a = groundedMob("cow");
    const b = groundedMob("cow");
    const rngA = mulberry32(42);
    const rngB = mulberry32(42);

    for (let i = 0; i < 300; i++) {
      tickPassive(a, isSolid, rngA);
      tickPassive(b, isSolid, rngB);
    }

    expect(a.feet.x).toBe(b.feet.x);
    expect(a.feet.z).toBe(b.feet.z);
    expect(a.yaw).toBe(b.yaw);
  });

  it("increments age and ticks the sheep wool counter", () => {
    const isSolid = flatFloor(FLOOR_TOP);
    const sheep = groundedMob("sheep");
    const rng = mulberry32(9);

    for (let i = 0; i < 50; i++) tickPassive(sheep, isSolid, rng);

    expect(sheep.age).toBe(50);
    expect(sheep.extra["woolGrowth"]).toBe(50);
  });

  it("ticks the chicken egg counter but not wool", () => {
    const isSolid = flatFloor(FLOOR_TOP);
    const chicken = groundedMob("chicken");
    const rng = mulberry32(3);

    for (let i = 0; i < 20; i++) tickPassive(chicken, isSolid, rng);

    expect(chicken.extra["eggTimer"]).toBe(20);
    expect(chicken.extra["woolGrowth"]).toBeUndefined();
  });

  it("decrements breedCooldown each tick down toward zero", () => {
    const isSolid = flatFloor(FLOOR_TOP);
    const mob = groundedMob("cow");
    mob.breedCooldown = 10;
    const rng = mulberry32(1);

    for (let i = 0; i < 4; i++) tickPassive(mob, isSolid, rng);
    expect(mob.breedCooldown).toBe(6);
  });
});

describe("feed", () => {
  it("sets inLove for the correct item (cow ← wheat)", () => {
    const cow = groundedMob("cow");
    expect(feed(cow, Items.WHEAT)).toBe(true);
    expect(cow.inLove).toBe(true);
  });

  it("sets inLove for the correct item (chicken ← seeds)", () => {
    const chicken = groundedMob("chicken");
    expect(feed(chicken, Items.SEEDS)).toBe(true);
    expect(chicken.inLove).toBe(true);
  });

  it("rejects the wrong item", () => {
    const cow = groundedMob("cow");
    expect(feed(cow, Items.SEEDS)).toBe(false);
    expect(cow.inLove).toBe(false);
  });

  it("rejects a chicken fed wheat", () => {
    const chicken = groundedMob("chicken");
    expect(feed(chicken, Items.WHEAT)).toBe(false);
    expect(chicken.inLove).toBe(false);
  });

  it("refuses while on breeding cooldown", () => {
    const cow = groundedMob("cow");
    cow.breedCooldown = 100;
    expect(feed(cow, Items.WHEAT)).toBe(false);
    expect(cow.inLove).toBe(false);
  });
});

describe("breed", () => {
  function nextIdFactory(start: number): () => number {
    let n = start;
    return () => n++;
  }

  it("produces offspring at the midpoint when both are in love and ready", () => {
    const a = new Mob(1, "cow", { x: 0, y: 64, z: 0 });
    const b = new Mob(2, "cow", { x: 4, y: 64, z: 8 });
    a.inLove = true;
    b.inLove = true;

    const baby = breed(a, b, nextIdFactory(100), 500);

    expect(baby).not.toBeNull();
    expect(baby?.type).toBe("cow");
    expect(baby?.feet).toEqual({ x: 2, y: 64, z: 4 });
  });

  it("sets cooldown on both parents and clears love", () => {
    const a = new Mob(1, "sheep", { x: 0, y: 64, z: 0 });
    const b = new Mob(2, "sheep", { x: 2, y: 64, z: 0 });
    a.inLove = true;
    b.inLove = true;

    const baby = breed(a, b, nextIdFactory(50), 0);

    expect(baby).not.toBeNull();
    expect(a.inLove).toBe(false);
    expect(b.inLove).toBe(false);
    expect(a.breedCooldown).toBe(BREED_COOLDOWN_TICKS);
    expect(b.breedCooldown).toBe(BREED_COOLDOWN_TICKS);
    expect(baby?.breedCooldown).toBe(BREED_COOLDOWN_TICKS);
  });

  it("returns null when only one is in love", () => {
    const a = new Mob(1, "pig", { x: 0, y: 64, z: 0 });
    const b = new Mob(2, "pig", { x: 1, y: 64, z: 0 });
    a.inLove = true;
    b.inLove = false;

    expect(breed(a, b, nextIdFactory(1), 0)).toBeNull();
  });

  it("returns null when a parent is on cooldown", () => {
    const a = new Mob(1, "cow", { x: 0, y: 64, z: 0 });
    const b = new Mob(2, "cow", { x: 1, y: 64, z: 0 });
    a.inLove = true;
    b.inLove = true;
    b.breedCooldown = 1;

    expect(breed(a, b, nextIdFactory(1), 0)).toBeNull();
  });

  it("does not breed across different types", () => {
    const cow = new Mob(1, "cow", { x: 0, y: 64, z: 0 });
    const pig = new Mob(2, "pig", { x: 1, y: 64, z: 0 });
    cow.inLove = true;
    pig.inLove = true;

    expect(breed(cow, pig, nextIdFactory(1), 0)).toBeNull();
  });

  it("returns null when given the same mob twice", () => {
    const cow = new Mob(1, "cow", { x: 0, y: 64, z: 0 });
    cow.inLove = true;
    expect(breed(cow, cow, nextIdFactory(1), 0)).toBeNull();
  });

  it("full feed → breed flow with assigned id", () => {
    const a = groundedMob("cow");
    const b = new Mob(2, "cow", { x: 2, y: 64, z: 0 });
    b.onGround = true;

    expect(feed(a, Items.WHEAT)).toBe(true);
    expect(feed(b, Items.WHEAT)).toBe(true);

    const baby = breed(a, b, nextIdFactory(99), 1000);
    expect(baby?.id).toBe(99);
    expect(baby?.type).toBe("cow");
  });
});
