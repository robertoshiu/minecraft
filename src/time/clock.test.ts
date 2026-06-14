import { describe, it, expect } from "vitest";
import { TIME } from "../rules/mc-1.20";
import {
  makeClock,
  advance,
  tickOfDay,
  dayNumber,
  phase,
  isNight,
  type Clock,
  type Phase,
} from "./clock";

describe("makeClock", () => {
  it("defaults to totalTicks 0", () => {
    const c = makeClock();
    expect(c.totalTicks).toBe(0);
  });

  it("accepts an explicit start tick", () => {
    const c = makeClock(5000);
    expect(c.totalTicks).toBe(5000);
  });
});

describe("advance", () => {
  it("is additive", () => {
    const c = makeClock();
    advance(c, 100);
    advance(c, 50);
    expect(c.totalTicks).toBe(150);
  });

  it("is monotonic and never wraps past TICKS_PER_DAY", () => {
    const c = makeClock();
    advance(c, TIME.TICKS_PER_DAY);
    expect(c.totalTicks).toBe(TIME.TICKS_PER_DAY);
    advance(c, TIME.TICKS_PER_DAY);
    expect(c.totalTicks).toBe(2 * TIME.TICKS_PER_DAY);
    // far past a single day: counter keeps growing, never resets
    advance(c, 100000);
    expect(c.totalTicks).toBe(2 * TIME.TICKS_PER_DAY + 100000);
  });
});

describe("tickOfDay", () => {
  it("equals totalTicks within the first day", () => {
    const c = makeClock(6000);
    expect(tickOfDay(c)).toBe(6000);
  });

  it("wraps correctly for totalTicks well past 24000 (50000 -> 2000)", () => {
    const c = makeClock(50000);
    expect(tickOfDay(c)).toBe(2000);
  });

  it("returns 0 exactly at a day boundary", () => {
    const c = makeClock(TIME.TICKS_PER_DAY);
    expect(tickOfDay(c)).toBe(0);
    const c2 = makeClock(3 * TIME.TICKS_PER_DAY);
    expect(tickOfDay(c2)).toBe(0);
  });

  it("is negative-safe (always in [0, TICKS_PER_DAY))", () => {
    const c = makeClock(-1);
    const tod = tickOfDay(c);
    expect(tod).toBe(TIME.TICKS_PER_DAY - 1);
    expect(tod).toBeGreaterThanOrEqual(0);
    expect(tod).toBeLessThan(TIME.TICKS_PER_DAY);

    const c2 = makeClock(-25000);
    const tod2 = tickOfDay(c2);
    expect(tod2).toBeGreaterThanOrEqual(0);
    expect(tod2).toBeLessThan(TIME.TICKS_PER_DAY);
    expect(tod2).toBe(((-25000 % 24000) + 24000) % 24000);
  });
});

describe("dayNumber", () => {
  it("is Day 1 at start", () => {
    expect(dayNumber(makeClock())).toBe(1);
    expect(dayNumber(makeClock(100))).toBe(1);
    expect(dayNumber(makeClock(TIME.TICKS_PER_DAY - 1))).toBe(1);
  });

  it("increments to Day 2 at tick 24000", () => {
    expect(dayNumber(makeClock(TIME.TICKS_PER_DAY))).toBe(2);
  });

  it("increments each 24000 ticks", () => {
    const c = makeClock();
    expect(dayNumber(c)).toBe(1);
    advance(c, TIME.TICKS_PER_DAY);
    expect(dayNumber(c)).toBe(2);
    advance(c, TIME.TICKS_PER_DAY);
    expect(dayNumber(c)).toBe(3);
    advance(c, TIME.TICKS_PER_DAY * 10);
    expect(dayNumber(c)).toBe(13);
  });
});

describe("phase boundaries", () => {
  const phaseAt = (tod: number): Phase => {
    const c: Clock = makeClock(tod);
    return phase(c);
  };

  it("tod 0 and 6000 are 'day'", () => {
    expect(phaseAt(0)).toBe("day");
    expect(phaseAt(6000)).toBe("day");
  });

  it("tod 12000 begins 'sunset', 12500 is 'sunset'", () => {
    expect(phaseAt(12000)).toBe("sunset");
    expect(phaseAt(12500)).toBe("sunset");
  });

  it("tod 13000 begins 'night', 18000 is 'night'", () => {
    expect(phaseAt(13000)).toBe("night");
    expect(phaseAt(18000)).toBe("night");
  });

  it("tod 23000 begins 'sunrise', 23500 is 'sunrise'", () => {
    expect(phaseAt(23000)).toBe("sunrise");
    expect(phaseAt(23500)).toBe("sunrise");
  });

  it("phase derives across day boundaries (monotonic clock)", () => {
    expect(phase(makeClock(TIME.TICKS_PER_DAY + 6000))).toBe("day");
    expect(phase(makeClock(TIME.TICKS_PER_DAY + 18000))).toBe("night");
  });
});

describe("isNight", () => {
  it("is true at 18000 and false at 6000", () => {
    expect(isNight(makeClock(18000))).toBe(true);
    expect(isNight(makeClock(6000))).toBe(false);
  });

  it("matches the 'night' phase boundaries [13000, 23000)", () => {
    expect(isNight(makeClock(12999))).toBe(false);
    expect(isNight(makeClock(13000))).toBe(true);
    expect(isNight(makeClock(22999))).toBe(true);
    expect(isNight(makeClock(23000))).toBe(false);
  });
});
