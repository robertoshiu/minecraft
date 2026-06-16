import { describe, it, expect } from "vitest";
import { Arrow, bowChargeToSpeed, launchFrom } from "./entity";
import { ARROW } from "../rules/mc-1.20";

describe("bowChargeToSpeed", () => {
  it("clamps to MIN_SPEED at zero charge", () => {
    expect(bowChargeToSpeed(0)).toBeCloseTo(ARROW.MIN_SPEED, 6);
  });
  it("clamps to MAX_SPEED at/after full charge", () => {
    expect(bowChargeToSpeed(ARROW.FULL_CHARGE_MS)).toBeCloseTo(ARROW.MAX_SPEED, 6);
    expect(bowChargeToSpeed(ARROW.FULL_CHARGE_MS * 5)).toBeCloseTo(ARROW.MAX_SPEED, 6);
  });
  it("is monotonic in between", () => {
    expect(bowChargeToSpeed(250)).toBeLessThan(bowChargeToSpeed(750));
  });
});

describe("launchFrom", () => {
  it("offsets the origin along the (normalized) aim and scales velocity by speed", () => {
    const { origin, velocity } = launchFrom({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -2 }, 3);
    expect(origin.z).toBeCloseTo(-ARROW.SPAWN_OFFSET, 6);
    expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeCloseTo(3, 6);
    expect(velocity.z).toBeCloseTo(-3, 6);
  });
});

describe("Arrow.isDone", () => {
  it("is done when landed, hit, or aged out", () => {
    const a = new Arrow(1, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(a.isDone(ARROW.MAX_AGE)).toBe(false);
    a.age = ARROW.MAX_AGE;
    expect(a.isDone(ARROW.MAX_AGE)).toBe(true);
    const b = new Arrow(2, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    b.landed = true;
    expect(b.isDone(ARROW.MAX_AGE)).toBe(true);
  });
});
