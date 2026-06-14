/**
 * a11y.test.ts — Unit tests for accessibility helpers.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ColorblindMode,
  adjustOreColor,
  clampUIScale,
  applyUIScale,
  getColorblindMode,
  setColorblindMode,
  getUIScale,
  setUIScale,
  initA11y,
  type RGB,
} from "./a11y";
import { Blocks } from "../rules/mc-1.20";
import { MemoryStore } from "../save/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A non-ore block ID that must never be adjusted. */
const NON_ORE_BLOCK = Blocks.STONE;

/** Confirm two RGB triples are equal component-by-component (within float epsilon). */
function rgbEqual(a: RGB, b: RGB, eps = 1e-9): boolean {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;
}

// ---------------------------------------------------------------------------
// Reset module state between tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await initA11y(new MemoryStore());
});

// ---------------------------------------------------------------------------
// ColorblindMode enum values
// ---------------------------------------------------------------------------

describe("ColorblindMode", () => {
  it("has NONE value", () => {
    expect(ColorblindMode.NONE).toBe("none");
  });

  it("has PROTANOPIA value", () => {
    expect(ColorblindMode.PROTANOPIA).toBe("protanopia");
  });

  it("has DEUTERANOPIA value", () => {
    expect(ColorblindMode.DEUTERANOPIA).toBe("deuteranopia");
  });

  it("has TRITANOPIA value", () => {
    expect(ColorblindMode.TRITANOPIA).toBe("tritanopia");
  });

  it("has exactly four modes", () => {
    expect(Object.keys(ColorblindMode)).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// adjustOreColor — NONE mode returns original
// ---------------------------------------------------------------------------

describe("adjustOreColor — NONE mode", () => {
  it("returns unchanged RGB for redstone ore in NONE mode", () => {
    const r = 0.6;
    const g = 0.32;
    const b = 0.32;
    const result = adjustOreColor(Blocks.REDSTONE_ORE, r, g, b, ColorblindMode.NONE);
    expect(rgbEqual(result, [r, g, b])).toBe(true);
  });

  it("returns unchanged RGB for diamond ore in NONE mode", () => {
    const r = 0.4;
    const g = 0.62;
    const b = 0.64;
    const result = adjustOreColor(Blocks.DIAMOND_ORE, r, g, b, ColorblindMode.NONE);
    expect(rgbEqual(result, [r, g, b])).toBe(true);
  });

  it("returns unchanged RGB for all ore types in NONE mode", () => {
    const ores = [
      Blocks.COAL_ORE,
      Blocks.IRON_ORE,
      Blocks.GOLD_ORE,
      Blocks.REDSTONE_ORE,
      Blocks.DIAMOND_ORE,
      Blocks.LAPIS_ORE,
    ];
    for (const blockId of ores) {
      const result = adjustOreColor(blockId, 0.5, 0.3, 0.4, ColorblindMode.NONE);
      expect(rgbEqual(result, [0.5, 0.3, 0.4])).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// adjustOreColor — non-ore blocks are unchanged
// ---------------------------------------------------------------------------

describe("adjustOreColor — non-ore blocks unchanged", () => {
  const nonOreBlocks = [
    Blocks.STONE,
    Blocks.DIRT,
    Blocks.GRASS,
    Blocks.SAND,
    Blocks.WATER,
    Blocks.OAK_LOG,
    Blocks.GLASS,
    Blocks.BEDROCK,
  ];

  const modes: ColorblindMode[] = [
    ColorblindMode.NONE,
    ColorblindMode.PROTANOPIA,
    ColorblindMode.DEUTERANOPIA,
    ColorblindMode.TRITANOPIA,
  ];

  it("leaves non-ore blocks unchanged in all modes", () => {
    for (const blockId of nonOreBlocks) {
      for (const mode of modes) {
        const r = 0.5;
        const g = 0.3;
        const b = 0.7;
        const result = adjustOreColor(blockId, r, g, b, mode);
        expect(rgbEqual(result, [r, g, b])).toBe(
          true,
        );
      }
    }
  });

  it("specifically leaves STONE unchanged in PROTANOPIA", () => {
    const result = adjustOreColor(NON_ORE_BLOCK, 0.5, 0.5, 0.5, ColorblindMode.PROTANOPIA);
    expect(rgbEqual(result, [0.5, 0.5, 0.5])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// adjustOreColor — PROTANOPIA shifts
// ---------------------------------------------------------------------------

describe("adjustOreColor — PROTANOPIA", () => {
  it("shifts red-dominant ore toward yellow (increases green)", () => {
    // REDSTONE_ORE is red-dominant (r=0.6, g=0.32, b=0.32)
    const [_r, ng, _b] = adjustOreColor(Blocks.REDSTONE_ORE, 0.6, 0.32, 0.32, ColorblindMode.PROTANOPIA);
    expect(ng).toBeGreaterThan(0.32);
  });

  it("shifts green-dominant ore toward blue (increases blue)", () => {
    // Use a hypothetically green-dominant ore color
    const [_r, _g, nb] = adjustOreColor(Blocks.LAPIS_ORE, 0.2, 0.7, 0.1, ColorblindMode.PROTANOPIA);
    expect(nb).toBeGreaterThan(0.1);
  });

  it("result stays in [0, 1] range for extreme inputs", () => {
    const [r, g, b] = adjustOreColor(Blocks.REDSTONE_ORE, 1.0, 0.0, 0.0, ColorblindMode.PROTANOPIA);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// adjustOreColor — DEUTERANOPIA shifts
// ---------------------------------------------------------------------------

describe("adjustOreColor — DEUTERANOPIA", () => {
  it("shifts green-dominant ore toward blue (increases blue)", () => {
    const [_r, _g, nb] = adjustOreColor(Blocks.LAPIS_ORE, 0.2, 0.7, 0.1, ColorblindMode.DEUTERANOPIA);
    expect(nb).toBeGreaterThan(0.1);
  });

  it("shifts red-dominant ore toward orange (slightly boosts green)", () => {
    // REDSTONE_ORE: r=0.6 dominant
    const [_r, ng, _b] = adjustOreColor(Blocks.REDSTONE_ORE, 0.6, 0.2, 0.2, ColorblindMode.DEUTERANOPIA);
    expect(ng).toBeGreaterThan(0.2);
  });

  it("result stays in [0, 1] range for extreme inputs", () => {
    const [r, g, b] = adjustOreColor(Blocks.DIAMOND_ORE, 0.0, 1.0, 0.0, ColorblindMode.DEUTERANOPIA);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// adjustOreColor — TRITANOPIA shifts
// ---------------------------------------------------------------------------

describe("adjustOreColor — TRITANOPIA", () => {
  it("shifts blue-dominant ore toward red (increases red)", () => {
    // LAPIS_ORE is blue-leaning; use pure blue-dominant input
    const [nr, _g, _b] = adjustOreColor(Blocks.LAPIS_ORE, 0.1, 0.2, 0.8, ColorblindMode.TRITANOPIA);
    expect(nr).toBeGreaterThan(0.1);
  });

  it("shifts yellow-ish ore toward pink (increases red, reduces green)", () => {
    // GOLD_ORE is yellow-tinted (r≈g, low b)
    const [nr, ng, _b] = adjustOreColor(Blocks.GOLD_ORE, 0.66, 0.7, 0.1, ColorblindMode.TRITANOPIA);
    // Green-dominant path: g >= r and not blue-dominant → pinkify
    expect(nr).toBeGreaterThan(0.66);
    expect(ng).toBeLessThan(0.7);
  });

  it("result stays in [0, 1] range for extreme inputs", () => {
    const [r, g, b] = adjustOreColor(Blocks.DIAMOND_ORE, 0.0, 0.0, 1.0, ColorblindMode.TRITANOPIA);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// UI scale clamping
// ---------------------------------------------------------------------------

describe("clampUIScale", () => {
  it("clamps below 0.5 to 0.5", () => {
    expect(clampUIScale(0.1)).toBe(0.5);
    expect(clampUIScale(0)).toBe(0.5);
    expect(clampUIScale(-1)).toBe(0.5);
  });

  it("clamps above 2.0 to 2.0", () => {
    expect(clampUIScale(3.0)).toBe(2.0);
    expect(clampUIScale(100)).toBe(2.0);
  });

  it("passes through valid values unchanged", () => {
    expect(clampUIScale(1.0)).toBe(1.0);
    expect(clampUIScale(0.5)).toBe(0.5);
    expect(clampUIScale(2.0)).toBe(2.0);
    expect(clampUIScale(1.5)).toBe(1.5);
  });

  it("returns default for NaN", () => {
    expect(clampUIScale(NaN)).toBe(1.0);
  });

  it("returns default (1.0) for Infinity and -Infinity (non-finite)", () => {
    // clampUIScale treats non-finite values as invalid and returns the default.
    expect(clampUIScale(Infinity)).toBe(1.0);
    expect(clampUIScale(-Infinity)).toBe(1.0);
  });
});

describe("applyUIScale", () => {
  it("scales a base size correctly", () => {
    expect(applyUIScale(100, 1.5)).toBe(150);
    expect(applyUIScale(100, 2.0)).toBe(200);
    expect(applyUIScale(100, 0.5)).toBe(50);
  });

  it("clamps the scale before applying", () => {
    expect(applyUIScale(100, 0.1)).toBe(50); // 0.1 → 0.5 → 50
    expect(applyUIScale(100, 5.0)).toBe(200); // 5.0 → 2.0 → 200
  });

  it("rounds to nearest integer", () => {
    expect(applyUIScale(10, 1.5)).toBe(15);
    expect(applyUIScale(7, 1.5)).toBe(11); // 7*1.5=10.5 → 11
  });
});

// ---------------------------------------------------------------------------
// getColorblindMode / setColorblindMode — persist via preferences
// ---------------------------------------------------------------------------

describe("getColorblindMode / setColorblindMode", () => {
  it("defaults to NONE after init", () => {
    expect(getColorblindMode()).toBe(ColorblindMode.NONE);
  });

  it("reflects mode after setColorblindMode", async () => {
    await setColorblindMode(ColorblindMode.PROTANOPIA);
    expect(getColorblindMode()).toBe(ColorblindMode.PROTANOPIA);
  });

  it("persists to store — reloading reflects saved mode", async () => {
    const store = new MemoryStore();
    await initA11y(store);
    await setColorblindMode(ColorblindMode.DEUTERANOPIA);

    await initA11y(store);
    expect(getColorblindMode()).toBe(ColorblindMode.DEUTERANOPIA);
  });

  it("can cycle through all modes", async () => {
    const modes: ColorblindMode[] = [
      ColorblindMode.NONE,
      ColorblindMode.PROTANOPIA,
      ColorblindMode.DEUTERANOPIA,
      ColorblindMode.TRITANOPIA,
    ];
    for (const mode of modes) {
      await setColorblindMode(mode);
      expect(getColorblindMode()).toBe(mode);
    }
  });
});

// ---------------------------------------------------------------------------
// getUIScale / setUIScale
// ---------------------------------------------------------------------------

describe("getUIScale / setUIScale", () => {
  it("defaults to 1.0 after init", () => {
    expect(getUIScale()).toBe(1.0);
  });

  it("reflects scale after setUIScale", async () => {
    await setUIScale(1.5);
    expect(getUIScale()).toBe(1.5);
  });

  it("clamps out-of-range values on set", async () => {
    await setUIScale(0.1);
    expect(getUIScale()).toBe(0.5);

    await setUIScale(10.0);
    expect(getUIScale()).toBe(2.0);
  });

  it("persists to store — reloading reflects saved scale", async () => {
    const store = new MemoryStore();
    await initA11y(store);
    await setUIScale(1.75);

    await initA11y(store);
    expect(getUIScale()).toBe(1.75);
  });
});
