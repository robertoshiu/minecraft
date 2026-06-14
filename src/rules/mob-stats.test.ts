import { describe, it, expect } from "vitest";
import {
  MOB_STATS,
  MOB_DROPS,
  PASSIVE_TYPES,
  HOSTILE_TYPES,
  type MobType,
} from "./mob-stats";
import { ITEM_REGISTRY } from "./items";

const ALL_TYPES: readonly MobType[] = [...PASSIVE_TYPES, ...HOSTILE_TYPES];

describe("mob-stats — type partitioning", () => {
  it("passive and hostile sets are disjoint and cover every MOB_STATS key", () => {
    const overlap = PASSIVE_TYPES.filter((t) => HOSTILE_TYPES.includes(t));
    expect(overlap).toHaveLength(0);
    const union = new Set<MobType>(ALL_TYPES);
    expect(union.size).toBe(Object.keys(MOB_STATS).length);
    for (const key of Object.keys(MOB_STATS)) {
      expect(union.has(key as MobType)).toBe(true);
    }
  });
});

describe("mob-stats — stat values", () => {
  it("has positive size, health and speed for every mob", () => {
    for (const type of ALL_TYPES) {
      const s = MOB_STATS[type];
      expect(s.width).toBeGreaterThan(0);
      expect(s.height).toBeGreaterThan(0);
      expect(s.maxHealth).toBeGreaterThan(0);
      expect(s.speed).toBeGreaterThan(0);
    }
  });

  it("hostiles have a detection range; passives do not need combat fields", () => {
    for (const type of HOSTILE_TYPES) {
      expect(MOB_STATS[type].detectionRange).toBeGreaterThan(0);
    }
    expect(MOB_STATS["cow"].detectionRange).toBeUndefined();
  });

  it("matches the documented reference numbers", () => {
    expect(MOB_STATS["cow"]).toMatchObject({
      width: 0.9,
      height: 1.4,
      maxHealth: 10,
      speed: 2,
    });
    expect(MOB_STATS["chicken"]).toMatchObject({
      width: 0.4,
      height: 0.7,
      maxHealth: 4,
    });
    expect(MOB_STATS["zombie"]).toMatchObject({
      maxHealth: 20,
      speed: 2.3,
      detectionRange: 16,
      attackDamage: 3,
      attackRangeBlocks: 1.6,
      burnsInSun: true,
    });
    expect(MOB_STATS["skeleton"].attackRangeBlocks).toBe(12);
    expect(MOB_STATS["creeper"].attackDamage).toBeUndefined();
  });
});

describe("mob-stats — drops", () => {
  it("every drop entry references an item id that exists in the registry", () => {
    for (const type of ALL_TYPES) {
      for (const drop of MOB_DROPS[type]) {
        expect(ITEM_REGISTRY[drop.item], `unknown item ${drop.item}`).toBeDefined();
        expect(drop.min).toBeLessThanOrEqual(drop.max);
        expect(drop.min).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("passive mobs drop loot; hostiles have no matching items so drop nothing", () => {
    expect(MOB_DROPS["cow"].length).toBeGreaterThan(0);
    expect(MOB_DROPS["pig"].length).toBeGreaterThan(0);
    expect(MOB_DROPS["sheep"].length).toBeGreaterThan(0);
    expect(MOB_DROPS["chicken"].length).toBeGreaterThan(0);
    expect(MOB_DROPS["zombie"]).toHaveLength(0);
    expect(MOB_DROPS["skeleton"]).toHaveLength(0);
    expect(MOB_DROPS["creeper"]).toHaveLength(0);
  });
});
