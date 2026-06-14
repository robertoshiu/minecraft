import { describe, it, expect } from "vitest";
import { distanceAttenuation, stereoPan } from "./spatial";

describe("distanceAttenuation", () => {
  it("returns 1 at distance 0", () => {
    expect(distanceAttenuation(0)).toBe(1);
  });

  it("returns 1 at distance equal to refDist", () => {
    expect(distanceAttenuation(1)).toBe(1);
    expect(distanceAttenuation(2, 2)).toBe(1);
  });

  it("returns 0 at maxDist", () => {
    expect(distanceAttenuation(48)).toBe(0);
    expect(distanceAttenuation(100, 1, 100)).toBe(0);
  });

  it("returns 0 beyond maxDist", () => {
    expect(distanceAttenuation(60)).toBe(0);
    expect(distanceAttenuation(200)).toBe(0);
  });

  it("is monotonically decreasing from refDist to maxDist", () => {
    const vals: number[] = [];
    for (let d = 0; d <= 48; d += 4) {
      vals.push(distanceAttenuation(d));
    }
    for (let i = 1; i < vals.length; i++) {
      const prev = vals[i - 1];
      const curr = vals[i];
      expect(prev).toBeGreaterThanOrEqual(curr ?? 0);
    }
  });

  it("stays within [0, 1]", () => {
    for (let d = 0; d <= 60; d++) {
      const v = distanceAttenuation(d);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("respects custom refDist and maxDist", () => {
    expect(distanceAttenuation(5, 5, 20)).toBe(1);
    expect(distanceAttenuation(20, 5, 20)).toBe(0);
    // midpoint should be ~0.5
    const mid = distanceAttenuation(12.5, 5, 20);
    expect(mid).toBeCloseTo(0.5, 5);
  });
});

describe("stereoPan", () => {
  const listener = { x: 0, y: 0, z: 0 };

  it("returns ~0 when source is directly ahead (yaw 0, source at +Z)", () => {
    // yaw=0, forward = +Z; source is ahead → pan ≈ 0
    const pan = stereoPan(listener, 0, { x: 0, y: 0, z: 10 });
    expect(Math.abs(pan)).toBeLessThan(0.05);
  });

  it("returns ~0 when source is directly behind", () => {
    const pan = stereoPan(listener, 0, { x: 0, y: 0, z: -10 });
    expect(Math.abs(pan)).toBeLessThan(0.05);
  });

  it("returns positive (right) when source is to the listener's right", () => {
    // yaw=0 → right direction is +X; source at (+10, 0, 0)
    const pan = stereoPan(listener, 0, { x: 10, y: 0, z: 0 });
    expect(pan).toBeGreaterThan(0.9);
  });

  it("returns negative (left) when source is to the listener's left", () => {
    // yaw=0 → left direction is -X; source at (-10, 0, 0)
    const pan = stereoPan(listener, 0, { x: -10, y: 0, z: 0 });
    expect(pan).toBeLessThan(-0.9);
  });

  it("returns value in [-1, 1]", () => {
    const positions = [
      { x: 100, y: 0, z: 0 },
      { x: -100, y: 0, z: 0 },
      { x: 0, y: 0, z: 100 },
      { x: 50, y: 0, z: 50 },
    ];
    for (const pos of positions) {
      const pan = stereoPan(listener, 0, pos);
      expect(pan).toBeGreaterThanOrEqual(-1);
      expect(pan).toBeLessThanOrEqual(1);
    }
  });

  it("returns 0 when source is at the same position as listener", () => {
    const pan = stereoPan(listener, 0, { x: 0, y: 0, z: 0 });
    expect(pan).toBe(0);
  });

  it("accounts for listener yaw rotation — right rotates with the camera", () => {
    // Rotate listener 90° right (facing +X). Source at +Z should now be LEFT.
    const pan = stereoPan(listener, Math.PI / 2, { x: 0, y: 0, z: 10 });
    expect(pan).toBeLessThan(-0.5);
  });
});
