import { describe, it, expect } from "vitest";
import { armorPips, effectBadges } from "./armor-hud";
import { makeEffectState, applyEffect } from "../effects/status";
import { TICKS_PER_SECOND } from "../rules/mc-1.20";

describe("armorPips", () => {
  it("0 defense → all empty", () => {
    expect(armorPips(0)).toEqual(Array(10).fill("empty"));
  });
  it("20 defense (full diamond) → all full", () => {
    expect(armorPips(20)).toEqual(Array(10).fill("full"));
  });
  it("odd value renders a half pip at the boundary", () => {
    const pips = armorPips(3);
    expect(pips[0]).toBe("full");
    expect(pips[1]).toBe("half");
    expect(pips[2]).toBe("empty");
  });
});

describe("effectBadges", () => {
  it("empty list → no badges", () => {
    expect(effectBadges(makeEffectState())).toEqual([]);
  });
  it("maps type, level (amp+1), and ceil-seconds", () => {
    const s = makeEffectState();
    applyEffect(s, "strength", 1, TICKS_PER_SECOND * 5 + 1);
    const badges = effectBadges(s);
    expect(badges).toHaveLength(1);
    expect(badges[0]!.type).toBe("strength");
    expect(badges[0]!.label).toBe("STR");
    expect(badges[0]!.level).toBe(2);
    expect(badges[0]!.seconds).toBe(6);
  });
  it("preserves list order across multiple effects", () => {
    const s = makeEffectState();
    applyEffect(s, "regeneration", 0, 40);
    applyEffect(s, "resistance", 0, 40);
    const labels = effectBadges(s).map((b) => b.label);
    expect(labels).toEqual(["REGEN", "RESIST"]);
  });
});
