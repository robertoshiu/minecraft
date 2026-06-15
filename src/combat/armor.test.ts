import { describe, it, expect } from "vitest";
import { armorReduction } from "./armor";

describe("armorReduction", () => {
  it("0 defense → damage unchanged (rounded)", () => {
    expect(armorReduction(6, 0)).toBe(6);
    expect(armorReduction(7, 0)).toBe(7);
  });
  it("applies 4% per point, rounded to integer half-hearts", () => {
    // 10 damage, 5 points → 20% off → 8.0
    expect(armorReduction(10, 5)).toBe(8);
    // 7 damage, 5 points → 20% off → 5.6 → 6
    expect(armorReduction(7, 5)).toBe(6);
  });
  it("caps reduction at 80% regardless of defense", () => {
    // 20 points would be 80% exactly; 25 points must still cap at 80%.
    expect(armorReduction(10, 20)).toBe(2);
    expect(armorReduction(10, 25)).toBe(2);
    expect(armorReduction(10, 100)).toBe(2);
  });
  it("never returns below 0", () => {
    expect(armorReduction(0, 5)).toBe(0);
    expect(armorReduction(1, 25)).toBe(0); // 1 × 0.2 = 0.2 → 0
  });
  it("mid-tier armor (13 points) on a 6-damage hit", () => {
    // 13 × 4% = 52% off → 6 × 0.48 = 2.88 → 3
    expect(armorReduction(6, 13)).toBe(3);
  });
});
