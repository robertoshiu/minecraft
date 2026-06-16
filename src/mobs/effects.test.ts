import { describe, it, expect } from "vitest";
import { Mob } from "./entity";
import { tickMobEffects } from "./effects";
import { applyEffect } from "../effects/status";
import { EFFECT_TUNING } from "../rules/mc-1.20";

describe("tickMobEffects", () => {
  it("poison ticks a mob's health down on its period boundary", () => {
    const mob = new Mob(1, "cow", { x: 0, y: 0, z: 0 }); // maxHealth 10
    mob.health = 10;
    applyEffect(mob.effects, "poison", 0, 1000);
    // Advance past one poison interval; health must have dropped by at least 1.
    const interval = EFFECT_TUNING.POISON_INTERVAL;
    for (let i = 0; i < interval; i++) tickMobEffects(mob, i);
    expect(mob.health).toBeLessThan(10);
  });

  it("poison never kills a mob (floors at 1)", () => {
    const mob = new Mob(1, "chicken", { x: 0, y: 0, z: 0 }); // maxHealth 4
    mob.health = 2;
    applyEffect(mob.effects, "poison", 4, 100000); // high amplifier → fast ticks
    for (let i = 0; i < 5000; i++) tickMobEffects(mob, i);
    expect(mob.health).toBe(1);
    expect(mob.isDead()).toBe(false);
  });

  it("regeneration heals a damaged mob over time", () => {
    const mob = new Mob(1, "cow", { x: 0, y: 0, z: 0 }); // maxHealth 10
    mob.health = 4;
    applyEffect(mob.effects, "regeneration", 0, 1000);
    const interval = EFFECT_TUNING.REGEN_INTERVAL;
    for (let i = 0; i < interval; i++) tickMobEffects(mob, i);
    expect(mob.health).toBeGreaterThan(4);
  });

  it("effects expire and are removed", () => {
    const mob = new Mob(1, "pig", { x: 0, y: 0, z: 0 });
    applyEffect(mob.effects, "poison", 0, 3); // 3 ticks then gone
    for (let i = 0; i < 4; i++) tickMobEffects(mob, i);
    expect(mob.effects.list).toHaveLength(0);
  });

  it("is a no-op (does not throw) when the mob has no effects", () => {
    const mob = new Mob(1, "sheep", { x: 0, y: 0, z: 0 });
    const healthBefore = mob.health;
    expect(() => tickMobEffects(mob, 0)).not.toThrow();
    expect(mob.health).toBe(healthBefore);
  });
});
