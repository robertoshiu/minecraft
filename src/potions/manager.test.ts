import { describe, it, expect } from "vitest";
import { SplashPotionManager, canThrowSplash } from "./manager";
import { SPLASH_POTION_CAP } from "../rules/mc-1.20";
import type { SplashEffect } from "./entity";

const FX: SplashEffect = { type: "poison", amplifier: 0, durationTicks: 200 };

describe("SplashPotionManager", () => {
  it("spawns with monotonic ids and tracks count", () => {
    const m = new SplashPotionManager();
    const a = m.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, FX);
    const b = m.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, FX);
    expect(a.id).not.toBe(b.id);
    expect(m.count()).toBe(2);
    m.despawn(a.id);
    expect(m.count()).toBe(1);
  });
  it("canThrowSplash gates at the cap", () => {
    expect(canThrowSplash(0)).toBe(true);
    expect(canThrowSplash(SPLASH_POTION_CAP)).toBe(false);
  });
});
