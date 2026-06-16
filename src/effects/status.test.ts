import { describe, it, expect } from "vitest";
import {
  makeEffectState,
  applyEffect,
  applyInstant,
  tickEffects,
  hasEffect,
  effectAmplifier,
  resistanceFraction,
  strengthBonus,
  swiftnessMultiplier,
  isInstant,
  effectTypeFromId,
  EFFECT_TYPE_IDS,
  mobEffectAction,
} from "./status";
import { makeSurvivalState } from "../survival/stats";
import { EFFECT_TUNING } from "../rules/mc-1.20";

describe("applyEffect stacking", () => {
  it("adds a new effect", () => {
    const s = makeEffectState();
    applyEffect(s, "strength", 0, 100);
    expect(effectAmplifier(s, "strength")).toBe(0);
  });
  it("higher amplifier REPLACES (amp + duration)", () => {
    const s = makeEffectState();
    applyEffect(s, "strength", 0, 100);
    applyEffect(s, "strength", 1, 50);
    expect(effectAmplifier(s, "strength")).toBe(1);
    const e = s.list.find((x) => x.type === "strength")!;
    expect(e.ticksRemaining).toBe(50);
  });
  it("equal amplifier REFRESHES to the longer remaining duration", () => {
    const s = makeEffectState();
    applyEffect(s, "strength", 0, 30);
    applyEffect(s, "strength", 0, 80);
    expect(s.list.find((x) => x.type === "strength")!.ticksRemaining).toBe(80);
    applyEffect(s, "strength", 0, 10);
    expect(s.list.find((x) => x.type === "strength")!.ticksRemaining).toBe(80);
  });
  it("lower amplifier is IGNORED", () => {
    const s = makeEffectState();
    applyEffect(s, "strength", 2, 100);
    applyEffect(s, "strength", 0, 999);
    expect(effectAmplifier(s, "strength")).toBe(2);
    expect(s.list.find((x) => x.type === "strength")!.ticksRemaining).toBe(100);
  });
  it("never stores an instant effect", () => {
    const s = makeEffectState();
    applyEffect(s, "instant_health", 0, 100);
    expect(s.list).toHaveLength(0);
  });
});

describe("tickEffects expiry (reverse-iterate)", () => {
  it("decrements duration and removes expired effects", () => {
    const s = makeEffectState();
    const survival = makeSurvivalState();
    applyEffect(s, "strength", 0, 2);
    applyEffect(s, "swiftness", 0, 1);
    tickEffects(s, survival, 0);
    expect(hasEffect(s, "swiftness")).toBe(false);
    expect(effectAmplifier(s, "strength")).toBe(0);
    tickEffects(s, survival, 1);
    expect(hasEffect(s, "strength")).toBe(false);
    expect(s.list).toHaveLength(0);
  });
});

describe("regeneration effect", () => {
  it("heals 1 HP every REGEN_INTERVAL ticks, independent of food", () => {
    const s = makeEffectState();
    const survival = makeSurvivalState();
    survival.health = 10;
    survival.food = 0;
    applyEffect(s, "regeneration", 0, 10_000);
    for (let i = 0; i < EFFECT_TUNING.REGEN_INTERVAL; i++) {
      tickEffects(s, survival, i);
    }
    expect(survival.health).toBe(11);
  });
  it("does not charge exhaustion (MC potions don't drain food)", () => {
    const s = makeEffectState();
    const survival = makeSurvivalState();
    survival.health = 10;
    const startExhaustion = survival.exhaustion;
    applyEffect(s, "regeneration", 0, 10_000);
    for (let i = 0; i < EFFECT_TUNING.REGEN_INTERVAL; i++) tickEffects(s, survival, i);
    expect(survival.exhaustion).toBe(startExhaustion);
  });
  it("regeneration II heals on the faster amplifier-scaled interval (25 ticks)", () => {
    const s = makeEffectState();
    const survival = makeSurvivalState();
    survival.health = 10;
    applyEffect(s, "regeneration", 1, 10_000); // Regen II → 50 - 25 = 25
    for (let i = 0; i < 25; i++) tickEffects(s, survival, i);
    expect(survival.health).toBe(11);
  });
  it("regeneration interval floors at 10 ticks for high amplifiers", () => {
    const s = makeEffectState();
    const survival = makeSurvivalState();
    survival.health = 10;
    applyEffect(s, "regeneration", 5, 10_000); // 50 - 125 → floored to 10
    for (let i = 0; i < 10; i++) tickEffects(s, survival, i);
    expect(survival.health).toBe(11);
  });
});

describe("poison effect", () => {
  it("poison II damages on the faster amplifier-scaled interval (13 ticks)", () => {
    const s = makeEffectState();
    const survival = makeSurvivalState();
    survival.health = 10;
    applyEffect(s, "poison", 1, 10_000); // 25 - 12 = 13
    for (let i = 0; i < 13; i++) tickEffects(s, survival, i);
    expect(survival.health).toBe(9);
  });
  it("deals 1 HP every POISON_INTERVAL ticks and cannot kill (floors at 1)", () => {
    const s = makeEffectState();
    const survival = makeSurvivalState();
    survival.health = 2;
    applyEffect(s, "poison", 0, 10_000);
    for (let i = 0; i < EFFECT_TUNING.POISON_INTERVAL; i++) tickEffects(s, survival, i);
    expect(survival.health).toBe(1);
    for (let i = 0; i < EFFECT_TUNING.POISON_INTERVAL; i++) tickEffects(s, survival, i);
    expect(survival.health).toBe(1);
  });
  it("does not add take-damage exhaustion (bypasses damage())", () => {
    const s = makeEffectState();
    const survival = makeSurvivalState();
    survival.health = 10;
    const startExhaustion = survival.exhaustion;
    applyEffect(s, "poison", 0, 10_000);
    for (let i = 0; i < EFFECT_TUNING.POISON_INTERVAL; i++) tickEffects(s, survival, i);
    expect(survival.exhaustion).toBe(startExhaustion);
  });
});

describe("instant effects", () => {
  it("instant_health heals INSTANT_HEALTH_PER_LEVEL × level", () => {
    const survival = makeSurvivalState();
    survival.health = 4;
    applyInstant(survival, "instant_health", 0);
    expect(survival.health).toBe(4 + EFFECT_TUNING.INSTANT_HEALTH_PER_LEVEL);
  });
  it("instant_damage subtracts directly, floored at 0, no exhaustion", () => {
    const survival = makeSurvivalState();
    survival.health = 5;
    const startExhaustion = survival.exhaustion;
    applyInstant(survival, "instant_damage", 0);
    expect(survival.health).toBe(0);
    expect(survival.exhaustion).toBe(startExhaustion);
  });
  it("isInstant flags only the two instant types", () => {
    expect(isInstant("instant_health")).toBe(true);
    expect(isInstant("instant_damage")).toBe(true);
    expect(isInstant("poison")).toBe(false);
  });
});

describe("accessor math", () => {
  it("resistanceFraction is 0.2 per level, capped at 0.8", () => {
    const s = makeEffectState();
    expect(resistanceFraction(s)).toBe(0);
    applyEffect(s, "resistance", 0, 100);
    expect(resistanceFraction(s)).toBeCloseTo(0.2, 6);
    applyEffect(s, "resistance", 9, 100);
    expect(resistanceFraction(s)).toBe(0.8);
  });
  it("strengthBonus adds per level", () => {
    const s = makeEffectState();
    expect(strengthBonus(s)).toBe(0);
    applyEffect(s, "strength", 1, 100);
    expect(strengthBonus(s)).toBe(EFFECT_TUNING.STRENGTH_PER_LEVEL * 2);
  });
  it("swiftnessMultiplier is 1 when absent, >1 when active", () => {
    const s = makeEffectState();
    expect(swiftnessMultiplier(s)).toBe(1);
    applyEffect(s, "swiftness", 0, 100);
    expect(swiftnessMultiplier(s)).toBeCloseTo(1.2, 6);
  });
});

describe("type-id mapping (persistence)", () => {
  it("round-trips every roster type through its stable int id", () => {
    for (const [type, id] of Object.entries(EFFECT_TYPE_IDS)) {
      expect(effectTypeFromId(id)).toBe(type);
    }
  });
});

describe("mobEffectAction — splash/arrow routing table (Phase 6c Task 4)", () => {
  // Pins the flat-vs-DoT trichotomy for every EffectType.
  // A mutation that maps instant_health → "effect" causes the last assertion
  // in the "none" test to fail; flipping instant_damage → "effect" fails the
  // "harm" test; flipping any non-instant to "harm"/"none" fails the "effect" test.

  it('instant_damage → "harm"', () => {
    expect(mobEffectAction("instant_damage")).toBe("harm");
  });

  it('instant_health → "none"', () => {
    expect(mobEffectAction("instant_health")).toBe("none");
  });

  it('all non-instant types → "effect"', () => {
    const nonInstant: Parameters<typeof mobEffectAction>[0][] = [
      "poison",
      "regeneration",
      "strength",
      "swiftness",
      "resistance",
      "fire_resistance",
    ];
    for (const type of nonInstant) {
      expect(mobEffectAction(type), `${type} should be "effect"`).toBe("effect");
    }
  });
});
