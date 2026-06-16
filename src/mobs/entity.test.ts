import { describe, it, expect } from "vitest";
import { Mob, NEVER_DAMAGED_TICK, type AiState } from "./entity";
import { BABY_SCALE } from "../rules/mc-1.20";
import {
  MOB_STATS,
  PASSIVE_TYPES,
  HOSTILE_TYPES,
  type MobType,
} from "../rules/mob-stats";

const ALL_TYPES: readonly MobType[] = [...PASSIVE_TYPES, ...HOSTILE_TYPES];

describe("Mob construction", () => {
  it("sets health to the type's maxHealth", () => {
    for (const type of ALL_TYPES) {
      const mob = new Mob(1, type, { x: 0, y: 0, z: 0 });
      expect(mob.health).toBe(MOB_STATS[type].maxHealth);
    }
  });

  it("initializes default state", () => {
    const mob = new Mob(7, "cow", { x: 1, y: 2, z: 3 });
    expect(mob.id).toBe(7);
    expect(mob.type).toBe("cow");
    expect(mob.feet).toEqual({ x: 1, y: 2, z: 3 });
    expect(mob.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(mob.onGround).toBe(false);
    expect(mob.aiState).toBe<AiState>("idle");
    expect(mob.target).toBeNull();
    expect(mob.yaw).toBe(0);
    expect(mob.age).toBe(0);
    expect(mob.aiTimer).toBe(0);
    expect(mob.breedCooldown).toBe(0);
    expect(mob.inLove).toBe(false);
    expect(mob.fuseTimer).toBe(-1);
    expect(mob.extra).toEqual({});
  });

  it("uses a large-negative lastDamageTick sentinel so a fresh mob isn't recently-damaged", () => {
    const mob = new Mob(1, "pig", { x: 0, y: 0, z: 0 });
    expect(mob.lastDamageTick).toBe(NEVER_DAMAGED_TICK);
    const currentTick = 100;
    expect(currentTick - mob.lastDamageTick).toBeGreaterThan(1000);
  });

  it("copies the spawn vector (does not alias it)", () => {
    const spawn = { x: 5, y: 6, z: 7 };
    const mob = new Mob(1, "sheep", spawn);
    spawn.x = 999;
    expect(mob.feet.x).toBe(5);
  });
});

describe("Mob.aabb", () => {
  it("dims match MOB_STATS width (x/z) and height (y)", () => {
    for (const type of ALL_TYPES) {
      const stats = MOB_STATS[type];
      const mob = new Mob(1, type, { x: 10, y: 64, z: -4 });
      const box = mob.aabb();
      expect(box.max.x - box.min.x).toBeCloseTo(stats.width, 10);
      expect(box.max.z - box.min.z).toBeCloseTo(stats.width, 10);
      expect(box.max.y - box.min.y).toBeCloseTo(stats.height, 10);
    }
  });

  it("is centered on x/z and bottomed on y at feet", () => {
    const mob = new Mob(1, "cow", { x: 10, y: 64, z: -4 });
    const stats = MOB_STATS["cow"];
    const box = mob.aabb();
    expect(box.min.y).toBe(64);
    expect(box.max.y).toBeCloseTo(64 + stats.height, 10);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(10, 10);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(-4, 10);
  });
});

describe("Mob passive/hostile classification", () => {
  it("classifies passive types", () => {
    for (const type of PASSIVE_TYPES) {
      const mob = new Mob(1, type, { x: 0, y: 0, z: 0 });
      expect(mob.isPassive()).toBe(true);
      expect(mob.isHostile()).toBe(false);
    }
  });

  it("classifies hostile types", () => {
    for (const type of HOSTILE_TYPES) {
      const mob = new Mob(1, type, { x: 0, y: 0, z: 0 });
      expect(mob.isHostile()).toBe(true);
      expect(mob.isPassive()).toBe(false);
    }
  });
});

describe("Mob.takeDamage / isDead", () => {
  it("records lastDamageTick and reduces health", () => {
    const mob = new Mob(1, "zombie", { x: 0, y: 0, z: 0 });
    const start = mob.health;
    mob.takeDamage(5, 42);
    expect(mob.health).toBe(start - 5);
    expect(mob.lastDamageTick).toBe(42);
    expect(mob.isDead()).toBe(false);
  });

  it("clamps health at zero (no negative health) and reports dead", () => {
    const mob = new Mob(1, "chicken", { x: 0, y: 0, z: 0 });
    mob.takeDamage(999, 10);
    expect(mob.health).toBe(0);
    expect(mob.isDead()).toBe(true);
  });

  it("exact lethal damage is dead", () => {
    const mob = new Mob(1, "sheep", { x: 0, y: 0, z: 0 });
    mob.takeDamage(MOB_STATS["sheep"].maxHealth, 5);
    expect(mob.health).toBe(0);
    expect(mob.isDead()).toBe(true);
  });
});

describe("Mob.aabb — baby scale (Phase 6c)", () => {
  it("a baby's aabb is babyScale× the adult dims, still bottomed at feet", () => {
    const adult = new Mob(1, "cow", { x: 10, y: 64, z: -4 });
    const baby = new Mob(2, "cow", { x: 10, y: 64, z: -4 });
    baby.extra["babyScale"] = BABY_SCALE;

    const a = adult.aabb();
    const b = baby.aabb();
    const adultW = a.max.x - a.min.x;
    const adultH = a.max.y - a.min.y;
    expect(b.max.x - b.min.x).toBeCloseTo(adultW * BABY_SCALE, 10);
    expect(b.max.z - b.min.z).toBeCloseTo(adultW * BABY_SCALE, 10);
    expect(b.max.y - b.min.y).toBeCloseTo(adultH * BABY_SCALE, 10);

    // Still bottomed at feet and centered on x/z.
    expect(b.min.y).toBe(64);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(10, 10);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(-4, 10);
  });

  it("sizeScale defaults to 1.0 for a fresh (adult) mob", () => {
    expect(new Mob(1, "pig", { x: 0, y: 0, z: 0 }).sizeScale()).toBe(1.0);
  });
});

describe("Mob.scaledDims — cross-check with aabb (Fix 3 DRY guard)", () => {
  it("scaledDims() and aabb() agree for an adult mob (all species)", () => {
    // Guards that the single-source scaledDims() and its consumer aabb() can
    // never silently drift: aabb()-derived extents must equal scaledDims() exactly.
    for (const type of ALL_TYPES) {
      const mob = new Mob(1, type, { x: 5, y: 64, z: 3 });
      const { hw, height } = mob.scaledDims();
      const box = mob.aabb();
      expect(box.max.y - mob.feet.y).toBeCloseTo(height, 10);
      expect(box.max.x - mob.feet.x).toBeCloseTo(hw, 10);
    }
  });

  it("scaledDims() and aabb() agree for a baby mob", () => {
    const mob = new Mob(1, "cow", { x: 5, y: 64, z: 3 });
    mob.extra["babyScale"] = BABY_SCALE;
    const { hw, height } = mob.scaledDims();
    const box = mob.aabb();
    expect(box.max.y - mob.feet.y).toBeCloseTo(height, 10);
    expect(box.max.x - mob.feet.x).toBeCloseTo(hw, 10);
  });

  it("adult scaledDims() equals raw MOB_STATS (no scaling applied)", () => {
    // Pins the adult-path: scaledDims for an adult = {hw: width/2, height} exactly.
    for (const type of ALL_TYPES) {
      const mob = new Mob(1, type, { x: 0, y: 0, z: 0 });
      const stats = MOB_STATS[type];
      const { hw, height } = mob.scaledDims();
      expect(hw).toBeCloseTo(stats.width / 2, 10);
      expect(height).toBeCloseTo(stats.height, 10);
    }
  });
});
