import { describe, it, expect } from "vitest";
import { makeClock, tickOfDay, dayNumber } from "../time/clock";
import { canSleep, sleepToDawn } from "./bed";

describe("canSleep", () => {
  it("returns true at a night tod (14000)", () => {
    const clock = makeClock(14000);
    expect(canSleep(clock)).toBe(true);
  });

  it("returns true at NIGHT_START (13000)", () => {
    const clock = makeClock(13000);
    expect(canSleep(clock)).toBe(true);
  });

  it("returns true just before SUNRISE_START (22999)", () => {
    const clock = makeClock(22999);
    expect(canSleep(clock)).toBe(true);
  });

  it("returns false at a day tod (6000)", () => {
    const clock = makeClock(6000);
    expect(canSleep(clock)).toBe(false);
  });

  it("returns false at dawn/sunrise tod (23000)", () => {
    const clock = makeClock(23000);
    expect(canSleep(clock)).toBe(false);
  });

  it("returns false at midday (12000)", () => {
    const clock = makeClock(12000);
    expect(canSleep(clock)).toBe(false);
  });
});

describe("sleepToDawn", () => {
  it("advances totalTicks FORWARD (strictly greater)", () => {
    const clock = makeClock(14000);
    const before = clock.totalTicks;
    sleepToDawn(clock);
    expect(clock.totalTicks).toBeGreaterThan(before);
  });

  it("lands tickOfDay in the morning band [0..1000)", () => {
    const clock = makeClock(14000);
    sleepToDawn(clock);
    const tod = tickOfDay(clock);
    expect(tod).toBeGreaterThanOrEqual(0);
    expect(tod).toBeLessThan(1000);
  });

  it("increments the day number", () => {
    const clock = makeClock(14000);
    const dayBefore = dayNumber(clock);
    sleepToDawn(clock);
    expect(dayNumber(clock)).toBeGreaterThan(dayBefore);
  });

  it("calling from very early night (13001) also moves forward", () => {
    const clock = makeClock(13001);
    const before = clock.totalTicks;
    sleepToDawn(clock);
    expect(clock.totalTicks).toBeGreaterThan(before);
    const tod = tickOfDay(clock);
    expect(tod).toBe(0);
  });

  it("calling from late night (22500) moves forward", () => {
    const clock = makeClock(22500);
    const before = clock.totalTicks;
    sleepToDawn(clock);
    expect(clock.totalTicks).toBeGreaterThan(before);
  });

  it("never moves time backward", () => {
    // Call multiple times — each call must keep moving forward.
    const clock = makeClock(14000);
    for (let i = 0; i < 5; i++) {
      const before = clock.totalTicks;
      sleepToDawn(clock);
      expect(clock.totalTicks).toBeGreaterThan(before);
    }
  });

  it("tickOfDay is exactly 0 after sleep (start of new day)", () => {
    const clock = makeClock(18000); // deep night
    sleepToDawn(clock);
    expect(tickOfDay(clock)).toBe(0);
  });
});
