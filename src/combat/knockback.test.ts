import { describe, it, expect } from "vitest";
import {
  knockbackImpulse,
  KNOCKBACK_HORIZONTAL,
  KNOCKBACK_UPWARD,
} from "./knockback";

describe("knockbackImpulse", () => {
  it("pushes the mob directly away from the attacker on +X", () => {
    const k = knockbackImpulse({ x: 0, z: 0 }, { x: 5, z: 0 });
    expect(k.x).toBeCloseTo(KNOCKBACK_HORIZONTAL, 6);
    expect(k.z).toBeCloseTo(0, 6);
    expect(k.y).toBeCloseTo(KNOCKBACK_UPWARD, 6);
  });
  it("normalizes the XZ direction (magnitude == strength)", () => {
    const k = knockbackImpulse({ x: 0, z: 0 }, { x: 3, z: 4 });
    expect(Math.hypot(k.x, k.z)).toBeCloseTo(KNOCKBACK_HORIZONTAL, 6);
  });
  it("zero-length separation falls back to +X", () => {
    const k = knockbackImpulse({ x: 2, z: 2 }, { x: 2, z: 2 });
    expect(k.x).toBeCloseTo(KNOCKBACK_HORIZONTAL, 6);
    expect(k.z).toBeCloseTo(0, 6);
  });
  it("always includes the upward component", () => {
    const k = knockbackImpulse({ x: 0, z: 0 }, { x: -7, z: 0 });
    expect(k.y).toBeCloseTo(KNOCKBACK_UPWARD, 6);
    expect(k.x).toBeCloseTo(-KNOCKBACK_HORIZONTAL, 6);
  });
});
