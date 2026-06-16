import { describe, it, expect } from "vitest";
import { isInvulnerable, INVULNERABLE_TICKS } from "./iframes";

describe("isInvulnerable", () => {
  it("never-damaged sentinel is not invulnerable", () => {
    expect(isInvulnerable(-1, 0)).toBe(false);
  });
  it("within the window → invulnerable", () => {
    expect(isInvulnerable(100, 100)).toBe(true);
    expect(isInvulnerable(100, 100 + INVULNERABLE_TICKS - 1)).toBe(true);
  });
  it("at and beyond the window → vulnerable again", () => {
    expect(isInvulnerable(100, 100 + INVULNERABLE_TICKS)).toBe(false);
    expect(isInvulnerable(100, 200)).toBe(false);
  });
});
