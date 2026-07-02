import { describe, it, expect } from "vitest";
import { miningFraction } from "./mining-hud";

describe("miningFraction", () => {
  it("0 elapsed → 0", () => {
    expect(miningFraction(0, 30)).toBe(0);
  });
  it("halfway → 0.5", () => {
    expect(miningFraction(15, 30)).toBe(0.5);
  });
  it("elapsed === total → 1", () => {
    expect(miningFraction(30, 30)).toBe(1);
  });
  it("elapsed beyond total clamps to 1", () => {
    expect(miningFraction(45, 30)).toBe(1);
  });
  it("negative elapsed clamps to 0", () => {
    expect(miningFraction(-5, 30)).toBe(0);
  });
  it("Infinity total (unbreakable block, e.g. bedrock) → 0", () => {
    expect(miningFraction(5, Infinity)).toBe(0);
  });
  it("total <= 0 → 0 (defensive; breakTicks never returns this)", () => {
    expect(miningFraction(5, 0)).toBe(0);
    expect(miningFraction(5, -1)).toBe(0);
  });
});
