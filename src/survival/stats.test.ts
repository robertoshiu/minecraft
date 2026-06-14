import { describe, it, expect } from "vitest";
import { HUNGER, HEALTH, EXHAUSTION, FOOD_VALUES } from "../rules/mc-1.20";
import {
  makeSurvivalState,
  addExhaustion,
  eat,
  damage,
  heal,
  tickSurvival,
  canSprint,
  isDead,
  type SurvivalState,
} from "./stats";

describe("makeSurvivalState", () => {
  it("starts full: health 20, food 20, saturation 5, exhaustion 0, timers 0", () => {
    expect(makeSurvivalState()).toEqual<SurvivalState>({
      health: 20,
      food: 20,
      saturation: 5,
      exhaustion: 0,
      regenTimer: 0,
      starveTimer: 0,
    });
  });

  it("returns an independent object each call", () => {
    const a = makeSurvivalState();
    const b = makeSurvivalState();
    a.health = 1;
    expect(b.health).toBe(20);
  });
});

describe("addExhaustion cascade", () => {
  it("drains 1 saturation per 4 exhaustion when saturation remains", () => {
    const s = makeSurvivalState();
    s.saturation = 3;
    addExhaustion(s, 4);
    expect(s.saturation).toBe(2);
    expect(s.exhaustion).toBe(0);
  });

  it("drains food when saturation is 0", () => {
    const s = makeSurvivalState();
    s.saturation = 0;
    s.food = 10;
    addExhaustion(s, 4);
    expect(s.food).toBe(9);
    expect(s.saturation).toBe(0);
    expect(s.exhaustion).toBe(0);
  });

  it("keeps fractional remainder below the 4.0 threshold", () => {
    const s = makeSurvivalState();
    s.saturation = 5;
    addExhaustion(s, 6); // one full cascade (-1 sat), 2 left over
    expect(s.saturation).toBe(4);
    expect(s.exhaustion).toBeCloseTo(2, 10);
  });

  it("runs multiple cascades for large amounts", () => {
    const s = makeSurvivalState();
    s.saturation = 5;
    addExhaustion(s, 12); // 3 cascades -> -3 saturation
    expect(s.saturation).toBe(2);
    expect(s.exhaustion).toBe(0);
  });

  it("never drives saturation or food below 0", () => {
    const s = makeSurvivalState();
    s.saturation = 0;
    s.food = 0;
    addExhaustion(s, 8); // 2 cascades, nothing to drain
    expect(s.food).toBe(0);
    expect(s.saturation).toBe(0);
  });
});

describe("regeneration", () => {
  it("heals 1 HP after 80 ticks when well-fed, costing 6 exhaustion (drops saturation)", () => {
    const s = makeSurvivalState();
    s.food = 20;
    s.saturation = 5;
    s.health = 10;

    for (let i = 0; i < HUNGER.REGEN_INTERVAL_TICKS; i++) tickSurvival(s);

    expect(s.health).toBe(11);
    // The 6.0 exhaustion cost cascades: floor(6/4)=1 immediate drain, 2 left
    // over -> saturation dropped from 5 by 1.
    expect(s.saturation).toBeLessThan(5);
    expect(s.saturation).toBe(4);
    expect(s.exhaustion).toBeCloseTo(2, 10);
  });

  it("does not regen when food is below the threshold (17 < 18)", () => {
    const s = makeSurvivalState();
    s.food = 17;
    s.saturation = 20;
    s.health = 10;
    for (let i = 0; i < HUNGER.REGEN_INTERVAL_TICKS * 2; i++) tickSurvival(s);
    expect(s.health).toBe(10);
  });

  it("does not regen when saturation is 0", () => {
    const s = makeSurvivalState();
    s.food = 20;
    s.saturation = 0;
    s.health = 10;
    for (let i = 0; i < HUNGER.REGEN_INTERVAL_TICKS * 2; i++) tickSurvival(s);
    expect(s.health).toBe(10);
  });

  it("does not regen when health is already full", () => {
    const s = makeSurvivalState();
    s.food = 20;
    s.saturation = 20;
    s.health = HEALTH.MAX;
    for (let i = 0; i < HUNGER.REGEN_INTERVAL_TICKS; i++) tickSurvival(s);
    expect(s.health).toBe(HEALTH.MAX);
  });

  it("full heal economy: ~19 HP needs ~1520 ticks; each HP costs ~1.5 saturation", () => {
    const s = makeSurvivalState();
    s.health = 1;
    s.food = 20;
    s.saturation = 20;

    // Keep the player well-fed so the climb isn't stalled by food dropping
    // below the regen threshold — this isolates the regen RATE and the
    // saturation cost per HP. (A single 20-saturation reserve is NOT enough to
    // heal 19 HP unaided, which is itself correct MC behaviour; see below.)
    const targetHp = 20; // climb from 1 to 20 = 19 HP
    let ticks = 0;
    let satConsumed = 0;
    while (s.health < targetHp && ticks < 5000) {
      const satBefore = s.saturation;
      tickSurvival(s);
      ticks++;
      // Top food back up to full each tick; track real saturation drained.
      if (s.saturation < satBefore) satConsumed += satBefore - s.saturation;
      s.food = 20;
      if (s.saturation < 1) s.saturation = 20; // refill reserve as if eating
    }

    expect(s.health).toBe(20);
    // 19 HP * 80 ticks = 1520, loosely bounded.
    expect(ticks).toBeGreaterThanOrEqual(1520);
    expect(ticks).toBeLessThan(1700);

    // Each HP costs 6 exhaustion -> ~1.5 saturation/HP. 19 HP -> ~28.5
    // saturation drained (loose bound).
    expect(satConsumed).toBeGreaterThanOrEqual(19); // > 1 per HP
    expect(satConsumed).toBeLessThanOrEqual(38); // < 2 per HP
  });

  it("a single 20-saturation reserve cannot fully heal 19 HP unaided (MC-correct)", () => {
    const s = makeSurvivalState();
    s.health = 1;
    s.food = 20;
    s.saturation = 20;
    for (let i = 0; i < 5000; i++) tickSurvival(s);
    // Regen stalls once exhaustion drains saturation->food below threshold 18.
    expect(s.health).toBeGreaterThan(1);
    expect(s.health).toBeLessThan(20);
  });
});

describe("starvation", () => {
  it("deals 1 damage after 80 ticks at 0 food", () => {
    const s = makeSurvivalState();
    s.food = 0;
    s.saturation = 0;
    s.health = 10;
    for (let i = 0; i < HUNGER.STARVE_INTERVAL_TICKS; i++) tickSurvival(s);
    expect(s.health).toBe(9);
  });

  it("repeats every 80 ticks", () => {
    const s = makeSurvivalState();
    s.food = 0;
    s.saturation = 0;
    s.health = 10;
    for (let i = 0; i < HUNGER.STARVE_INTERVAL_TICKS * 3; i++) tickSurvival(s);
    expect(s.health).toBe(7);
  });

  it("can starve down to 0 (L3: no easy-mode floor at 1)", () => {
    const s = makeSurvivalState();
    s.food = 0;
    s.saturation = 0;
    s.health = 1;
    for (let i = 0; i < HUNGER.STARVE_INTERVAL_TICKS; i++) tickSurvival(s);
    expect(s.health).toBe(0);
    expect(isDead(s)).toBe(true);
  });

  it("does not starve when food is above 0", () => {
    const s = makeSurvivalState();
    s.food = 1;
    s.saturation = 0;
    s.health = 10;
    for (let i = 0; i < HUNGER.STARVE_INTERVAL_TICKS * 2; i++) tickSurvival(s);
    expect(s.health).toBe(10);
  });
});

describe("eat", () => {
  it("steak from food 6 / sat 0 -> food 14, saturation min(14, 12.8) = 12.8", () => {
    const s = makeSurvivalState();
    s.food = 6;
    s.saturation = 0;
    const steak = FOOD_VALUES["steak"];
    if (steak === undefined) throw new Error("steak missing from FOOD_VALUES");
    eat(s, steak.hunger, steak.saturation);
    expect(s.food).toBe(14);
    expect(s.saturation).toBeCloseTo(12.8, 10);
  });

  it("caps food at MAX_FOOD and saturation at the new food level", () => {
    const s = makeSurvivalState();
    s.food = 18;
    s.saturation = 0;
    // Eating 8 hunger would overshoot 20 -> capped at 20; saturation capped
    // at the new food level (20) even though raw gain is larger.
    eat(s, 8, 30);
    expect(s.food).toBe(HUNGER.MAX_FOOD);
    expect(s.saturation).toBe(HUNGER.MAX_FOOD);
  });

  it("adds saturation on top of existing saturation, capped at food", () => {
    const s = makeSurvivalState();
    s.food = 20;
    s.saturation = 5;
    eat(s, 0, 6); // food stays 20, saturation 5 + 6 = 11 (<= 20)
    expect(s.food).toBe(20);
    expect(s.saturation).toBe(11);
  });
});

describe("canSprint", () => {
  it("is false at food 6 (boundary, must be strictly above)", () => {
    const s = makeSurvivalState();
    s.food = HUNGER.SPRINT_DISABLE_FOOD; // 6
    expect(canSprint(s)).toBe(false);
  });

  it("is true at food 7", () => {
    const s = makeSurvivalState();
    s.food = 7;
    expect(canSprint(s)).toBe(true);
  });
});

describe("damage and heal", () => {
  it("reduces health and adds take-damage exhaustion", () => {
    const s = makeSurvivalState();
    s.health = 20;
    s.saturation = 5;
    s.exhaustion = 0;
    damage(s, 6);
    expect(s.health).toBe(14);
    expect(s.exhaustion).toBeCloseTo(EXHAUSTION.TAKE_DAMAGE, 10);
  });

  it("floors health at 0 and reports dead", () => {
    const s = makeSurvivalState();
    s.health = 3;
    damage(s, 10);
    expect(s.health).toBe(0);
    expect(isDead(s)).toBe(true);
  });

  it("heal caps at HEALTH.MAX", () => {
    const s = makeSurvivalState();
    s.health = 18;
    heal(s, 5);
    expect(s.health).toBe(HEALTH.MAX);
  });

  it("isDead is false above 0 health", () => {
    const s = makeSurvivalState();
    s.health = 1;
    expect(isDead(s)).toBe(false);
  });
});
