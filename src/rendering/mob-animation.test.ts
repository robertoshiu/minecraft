/**
 * mob-animation.test.ts — unit tests for the pure mob animation math module.
 *
 * Every exported function is covered. No Babylon.js engine required.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_GAIT,
  legSwing,
  easeToRest,
  idleBob,
  tailSway,
  headPitch,
  recentlyDamaged,
  DEATH_GRACE_MS,
  deathGrace,
  deathScale,
  tintFor,
} from "./mob-animation";
import { NEVER_DAMAGED_TICK } from "../mobs/entity";

// ---------------------------------------------------------------------------
// legSwing
// ---------------------------------------------------------------------------
describe("legSwing", () => {
  it("returns ~0 at t=0, phase=0 with DEFAULT_GAIT", () => {
    expect(legSwing(0, 0, DEFAULT_GAIT)).toBeCloseTo(0);
  });

  it("phase=PI negates phase=0 at any t", () => {
    const t = 17.5;
    const a = legSwing(t, 0, DEFAULT_GAIT);
    const b = legSwing(t, Math.PI, DEFAULT_GAIT);
    expect(b).toBeCloseTo(-a);
  });

  it("respects custom gait params", () => {
    const gait = { freq: 1, amp: 1 };
    // sin(Math.PI/2 * 1 + 0) * 1 = 1
    expect(legSwing(Math.PI / 2, 0, gait)).toBeCloseTo(1);
  });
});

// ---------------------------------------------------------------------------
// easeToRest
// ---------------------------------------------------------------------------
describe("easeToRest", () => {
  it("multiplies current by 0.8 by default", () => {
    expect(easeToRest(1)).toBe(0.8);
  });

  it("uses a custom factor", () => {
    expect(easeToRest(2, 0.5)).toBe(1);
  });

  it("returns 0 for 0 input", () => {
    expect(easeToRest(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// idleBob
// ---------------------------------------------------------------------------
describe("idleBob", () => {
  it("returns 0 at t=0 (sin(0)=0)", () => {
    expect(idleBob(0)).toBe(0);
  });

  it("uses default amp=0.02", () => {
    // sin(t*0.12)*0.02 — at t=0 the result is 0; check a non-zero t
    const t = Math.PI / 0.12 / 2; // makes freq*t = PI/2, sin=1
    expect(idleBob(t)).toBeCloseTo(0.02);
  });

  it("respects custom amp and freq", () => {
    // sin(PI/2) * amp = amp
    const t = Math.PI / 2;
    expect(idleBob(t, 0.1, 1)).toBeCloseTo(0.1);
  });
});

// ---------------------------------------------------------------------------
// tailSway
// ---------------------------------------------------------------------------
describe("tailSway", () => {
  it("returns 0 at t=0", () => {
    expect(tailSway(0)).toBe(0);
  });

  it("peaks at amp=0.25 when freq*t=PI/2", () => {
    const t = Math.PI / 2 / 0.5;
    expect(tailSway(t)).toBeCloseTo(0.25);
  });

  it("respects custom amp and freq", () => {
    const t = Math.PI / 2;
    expect(tailSway(t, 0.5, 1)).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// headPitch
// ---------------------------------------------------------------------------
describe("headPitch", () => {
  it("returns ~0 when dyEyes=0", () => {
    expect(headPitch(0)).toBeCloseTo(0);
  });

  it("clamps at +0.6 for a very large positive dyEyes", () => {
    expect(headPitch(1000)).toBeCloseTo(0.6);
  });

  it("clamps at -0.6 for a very large negative dyEyes", () => {
    expect(headPitch(-1000)).toBeCloseTo(-0.6);
  });

  it("returns atan2 value unclamped for a small input within bounds", () => {
    const dy = 0.5;
    const expected = Math.atan2(dy, 1);
    expect(headPitch(dy)).toBeCloseTo(expected);
  });
});

// ---------------------------------------------------------------------------
// recentlyDamaged
// ---------------------------------------------------------------------------
describe("recentlyDamaged", () => {
  it("returns true when damage is within graceTicks", () => {
    expect(recentlyDamaged(10, 12, 4)).toBe(true);
  });

  it("returns false when damage is outside graceTicks", () => {
    expect(recentlyDamaged(10, 20, 4)).toBe(false);
  });

  it("returns false for a never-damaged mob (NEVER_DAMAGED_TICK)", () => {
    // currentTick=0, lastDamageTick=NEVER_DAMAGED_TICK (-1_000_000)
    // dt = 0 - (-1_000_000) = 1_000_000, which is >> any graceTicks
    expect(recentlyDamaged(NEVER_DAMAGED_TICK, 0)).toBe(false);
  });

  it("returns false when dt === graceTicks (exclusive upper bound)", () => {
    // dt = 14 - 10 = 4, not < 4
    expect(recentlyDamaged(10, 14, 4)).toBe(false);
  });

  it("returns false when lastDamageTick is in the future (dt < 0)", () => {
    expect(recentlyDamaged(100, 50, 4)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DEATH_GRACE_MS
// ---------------------------------------------------------------------------
describe("DEATH_GRACE_MS", () => {
  it("is 450", () => {
    expect(DEATH_GRACE_MS).toBe(450);
  });
});

// ---------------------------------------------------------------------------
// deathGrace
// ---------------------------------------------------------------------------
describe("deathGrace", () => {
  it("progress===0 at elapsedMs=0", () => {
    expect(deathGrace(0).progress).toBe(0);
  });

  it("expired===true at elapsedMs===DEATH_GRACE_MS", () => {
    expect(deathGrace(450).expired).toBe(true);
  });

  it("expired===false before totalMs", () => {
    expect(deathGrace(200).expired).toBe(false);
  });

  it("progress clamps to 1 beyond totalMs", () => {
    expect(deathGrace(9999).progress).toBe(1);
  });

  it("progress is 0.5 at half totalMs", () => {
    expect(deathGrace(225).progress).toBeCloseTo(0.5);
  });

  it("respects custom totalMs", () => {
    expect(deathGrace(500, 1000).progress).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// deathScale
// ---------------------------------------------------------------------------
describe("deathScale", () => {
  it("returns 1 when progress=0 (fully alive)", () => {
    expect(deathScale(0)).toBe(1);
  });

  it("returns 0 when progress=1 (fully dead)", () => {
    expect(deathScale(1)).toBe(0);
  });

  it("returns 0.5 at progress=0.5", () => {
    expect(deathScale(0.5)).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// tintFor
// ---------------------------------------------------------------------------
describe("tintFor", () => {
  it("is deterministic — two calls for same id produce identical results", () => {
    expect(tintFor(7)).toEqual(tintFor(7));
  });

  it("each channel is in [0.85, 1.0] for several ids", () => {
    for (const id of [1, 2, 3, 7, 42, 100]) {
      const [r, g, b] = tintFor(id);
      expect(r).toBeGreaterThanOrEqual(0.85);
      expect(r).toBeLessThanOrEqual(1.0);
      expect(g).toBeGreaterThanOrEqual(0.85);
      expect(g).toBeLessThanOrEqual(1.0);
      expect(b).toBeGreaterThanOrEqual(0.85);
      expect(b).toBeLessThanOrEqual(1.0);
    }
  });

  it("returns a tuple of exactly 3 numbers", () => {
    const result = tintFor(42);
    expect(result).toHaveLength(3);
    result.forEach((v) => expect(typeof v).toBe("number"));
  });

  it("different ids produce different tints — id 1 differs from id 2 in at least one channel", () => {
    const [r1, g1, b1] = tintFor(1);
    const [r2, g2, b2] = tintFor(2);
    const differs = r1 !== r2 || g1 !== g2 || b1 !== b2;
    expect(differs).toBe(true);
  });

  it("tints for ids 1..12 are not all identical — distinct set size > 1", () => {
    const seen = new Set<string>();
    for (let i = 1; i <= 12; i++) {
      seen.add(JSON.stringify(tintFor(i)));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
