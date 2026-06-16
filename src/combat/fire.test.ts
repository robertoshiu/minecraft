import { describe, it, expect } from "vitest";
import { nextBurningTicks, fireDamageDue } from "./fire";
import { FIRE } from "../rules/mc-1.20";

describe("nextBurningTicks", () => {
  it("ignites to IGNITE_TICKS when in lava from cold", () => {
    expect(nextBurningTicks(0, true, FIRE.IGNITE_TICKS)).toBe(FIRE.IGNITE_TICKS);
  });
  it("refreshes (keeps the larger of current vs ignite) while in lava", () => {
    expect(nextBurningTicks(50, true, FIRE.IGNITE_TICKS)).toBe(50);
    expect(nextBurningTicks(5, true, FIRE.IGNITE_TICKS)).toBe(FIRE.IGNITE_TICKS);
  });
  it("decays by one per tick once out of lava, floored at 0", () => {
    expect(nextBurningTicks(2, false, FIRE.IGNITE_TICKS)).toBe(1);
    expect(nextBurningTicks(1, false, FIRE.IGNITE_TICKS)).toBe(0);
    expect(nextBurningTicks(0, false, FIRE.IGNITE_TICKS)).toBe(0);
  });
});

describe("fireDamageDue", () => {
  it("never due when not burning", () => {
    expect(fireDamageDue(0, FIRE.DAMAGE_INTERVAL)).toBe(false);
  });
  it("due exactly on interval boundaries", () => {
    expect(fireDamageDue(30, FIRE.DAMAGE_INTERVAL)).toBe(true);
    expect(fireDamageDue(20, FIRE.DAMAGE_INTERVAL)).toBe(true);
    expect(fireDamageDue(10, FIRE.DAMAGE_INTERVAL)).toBe(true);
  });
  it("not due off-boundary", () => {
    expect(fireDamageDue(25, FIRE.DAMAGE_INTERVAL)).toBe(false);
    expect(fireDamageDue(1, FIRE.DAMAGE_INTERVAL)).toBe(false);
  });
  it("interval >= i-frame window so hits are not swallowed", () => {
    expect(FIRE.DAMAGE_INTERVAL).toBeGreaterThanOrEqual(10);
  });
  it("sustained lava contact: held-at-IGNITE_TICKS value is due (i-frames enforce cadence at call site)", () => {
    expect(fireDamageDue(FIRE.IGNITE_TICKS, FIRE.DAMAGE_INTERVAL)).toBe(true);
  });
});
