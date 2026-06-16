import { describe, it, expect } from "vitest";
import { SplashPotion, launchSplashFrom, type SplashEffect } from "./entity";
import { SPLASH } from "../rules/mc-1.20";

const FX: SplashEffect = { type: "poison", amplifier: 0, durationTicks: 200 };

describe("SplashPotion", () => {
  it("carries its effect and is not burst at spawn", () => {
    const p = new SplashPotion(1, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, FX);
    expect(p.effect).toBe(FX);
    expect(p.burst).toBe(false);
    expect(p.isDone(SPLASH.MAX_AGE)).toBe(false);
  });
  it("isDone once burst", () => {
    const p = new SplashPotion(1, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, FX);
    p.burst = true;
    expect(p.isDone(SPLASH.MAX_AGE)).toBe(true);
  });
});

describe("launchSplashFrom", () => {
  it("normalizes aim and offsets the origin past the eye", () => {
    const { origin, velocity } = launchSplashFrom({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 });
    expect(origin.z).toBeCloseTo(SPLASH.SPAWN_OFFSET, 6);
    expect(velocity.z).toBeCloseTo(SPLASH.SPEED, 6);
    expect(velocity.x).toBeCloseTo(0, 6);
  });
});
