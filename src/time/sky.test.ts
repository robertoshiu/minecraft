import { describe, it, expect } from "vitest";
import { TIME } from "../rules/mc-1.20";
import {
  skyColorAt,
  sunLightIntensityAt,
  sunDirectionAt,
  type RGB,
} from "./sky";

const { TICKS_PER_DAY } = TIME;

describe("skyColorAt", () => {
  it("returns all channels in [0,1] across a full-day sweep", () => {
    for (let tod = 0; tod < TICKS_PER_DAY; tod += 100) {
      const [r, g, b] = skyColorAt(tod);
      for (const ch of [r, g, b]) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is circular: color at tod 24000 deep-equals color at tod 0 (U5 no boundary pop)", () => {
    expect(skyColorAt(TICKS_PER_DAY % TICKS_PER_DAY)).toEqual(skyColorAt(0));
    // tod 24000 (== 0 on the circle) must equal tod 0 exactly
    expect(skyColorAt(TICKS_PER_DAY)).toEqual(skyColorAt(0));
  });

  it("is continuous across the wrap: tod 23999 ~= tod 0 within a small delta", () => {
    const a = skyColorAt(23999);
    const b = skyColorAt(0);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs((a[i] ?? 0) - (b[i] ?? 0))).toBeLessThan(0.02);
    }
  });

  it("midnight (18000) is dark: blue channel < 0.15", () => {
    const [, , blue] = skyColorAt(18000);
    expect(blue).toBeLessThan(0.15);
  });

  it("noon (6000) is bright: a vivid daytime sky-blue", () => {
    const [r, g, b] = skyColorAt(6000);
    expect(b).toBeGreaterThan(0.7);
    expect(g).toBeGreaterThan(0.4);
    expect(b).toBeGreaterThan(r);
  });

  it("sunset (~12500) is warm (red dominant over blue)", () => {
    const [r, , b] = skyColorAt(12500);
    expect(r).toBeGreaterThan(b);
  });

  it("is deterministic / pure", () => {
    expect(skyColorAt(8123)).toEqual(skyColorAt(8123));
  });
});

describe("sunLightIntensityAt", () => {
  it("is ~1.0 at noon (6000)", () => {
    expect(sunLightIntensityAt(6000)).toBeGreaterThan(0.95);
    expect(sunLightIntensityAt(6000)).toBeLessThanOrEqual(1);
  });

  it("is ~0 at midnight (18000)", () => {
    expect(sunLightIntensityAt(18000)).toBeLessThan(0.05);
    expect(sunLightIntensityAt(18000)).toBeGreaterThanOrEqual(0);
  });

  it("stays within [0,1] across a full-day sweep", () => {
    for (let tod = 0; tod < TICKS_PER_DAY; tod += 50) {
      const v = sunLightIntensityAt(tod);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("ramps smoothly at dawn/dusk (dusk between full and dark)", () => {
    const dusk = sunLightIntensityAt(12500);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(1);
  });

  it("is circular at the wrap boundary", () => {
    expect(sunLightIntensityAt(TICKS_PER_DAY)).toBeCloseTo(
      sunLightIntensityAt(0),
      6,
    );
  });
});

describe("sunDirectionAt", () => {
  const len = (v: RGB): number =>
    Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

  it("returns a ~unit vector across the day", () => {
    for (let tod = 0; tod < TICKS_PER_DAY; tod += 250) {
      expect(len(sunDirectionAt(tod))).toBeCloseTo(1, 5);
    }
  });

  it("y is high (>0.5) near noon (6000)", () => {
    const [, y] = sunDirectionAt(6000);
    expect(y).toBeGreaterThan(0.5);
  });

  it("y is negative near midnight (18000)", () => {
    const [, y] = sunDirectionAt(18000);
    expect(y).toBeLessThan(0);
  });

  it("is circular at the wrap boundary", () => {
    const a = sunDirectionAt(TICKS_PER_DAY);
    const b = sunDirectionAt(0);
    for (let i = 0; i < 3; i++) {
      expect(a[i]).toBeCloseTo(b[i] ?? 0, 5);
    }
  });
});
