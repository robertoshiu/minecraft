import { describe, it, expect } from "vitest";
import { Mob, NEVER_DAMAGED_TICK, type AiState } from "./entity";
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
