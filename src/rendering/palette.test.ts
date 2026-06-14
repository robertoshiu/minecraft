import { describe, it, expect } from "vitest";
import { tileColor } from "./palette";

describe("tileColor — palette", () => {
  it("every tile index 0..35 returns 3 components in [0,1]", () => {
    for (let i = 0; i <= 35; i++) {
      const c = tileColor(i);
      expect(c).toHaveLength(3);
      for (const comp of c) {
        expect(comp).toBeGreaterThanOrEqual(0);
        expect(comp).toBeLessThanOrEqual(1);
      }
    }
  });

  it("unknown indices return a fallback of 3 components in [0,1]", () => {
    const c = tileColor(9999);
    expect(c).toHaveLength(3);
    for (const comp of c) {
      expect(comp).toBeGreaterThanOrEqual(0);
      expect(comp).toBeLessThanOrEqual(1);
    }
  });

  it("bed tile (index 35) returns warm-red color, not the magenta debug fallback", () => {
    const [r, g, b] = tileColor(35);
    // palette entry: [0.78, 0.16, 0.18] — red dominant, not magenta [0.8, 0.2, 0.8]
    // Confirm it is NOT the magenta fallback (which has B ≈ R and G ≈ 0.2).
    // In the real entry, B is tiny (≈ 0.18) while in magenta B ≈ R ≈ 0.8.
    expect(r).toBeGreaterThan(0.5);   // strongly red
    expect(g).toBeLessThan(0.35);     // low green
    expect(b).toBeLessThan(0.35);     // low blue (not magenta-high)
    // Specifically not the fallback: magenta has B > 0.5
    expect(b).not.toBeCloseTo(0.8, 1);
  });

  it("returns a fresh array each call (safe to mutate)", () => {
    const a = tileColor(1);
    const b = tileColor(1);
    expect(a).not.toBe(b);
    a[0] = 0.123;
    expect(b[0]).not.toBe(0.123);
  });
});
