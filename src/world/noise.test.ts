import { describe, it, expect } from "vitest";
import {
  makeNoise2D,
  makeNoise3D,
  fbm2d,
  fbm3d,
  hash2,
  type NoiseFn2D,
  type NoiseFn3D,
} from "./noise";

const TOL = 1.05;

describe("hash2", () => {
  it("is deterministic", () => {
    expect(hash2(42, 10, 20)).toBe(hash2(42, 10, 20));
  });

  it("returns values in [0, 1)", () => {
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        const h = hash2(7, x, y);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(1);
      }
    }
  });

  it("is sensitive to seed and coordinates", () => {
    expect(hash2(1, 0, 0)).not.toBe(hash2(2, 0, 0));
    expect(hash2(1, 0, 0)).not.toBe(hash2(1, 1, 0));
    expect(hash2(1, 0, 0)).not.toBe(hash2(1, 0, 1));
  });
});

describe("makeNoise2D determinism", () => {
  it("returns the exact same value for the same input on the same instance", () => {
    const n = makeNoise2D(42);
    expect(n(10, 20)).toBe(n(10, 20));
  });

  it("returns the exact same value across the documented example", () => {
    expect(makeNoise2D(42)(10, 20)).toBe(makeNoise2D(42)(10, 20));
  });

  it("fresh instances with the same seed agree over a 100-point grid", () => {
    const a = makeNoise2D(123);
    const b = makeNoise2D(123);
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        const x = i * 1.37 + 0.5;
        const z = j * 0.91 - 3.2;
        expect(a(x, z)).toBe(b(x, z));
      }
    }
  });
});

describe("makeNoise3D determinism", () => {
  it("returns the exact same value for the same input on the same instance", () => {
    const n = makeNoise3D(42);
    expect(n(10, 20, 30)).toBe(n(10, 20, 30));
  });

  it("fresh instances with the same seed agree over a grid", () => {
    const a = makeNoise3D(999);
    const b = makeNoise3D(999);
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const x = i * 1.1;
        const y = j * 0.7;
        const z = (i + j) * 0.3;
        expect(a(x, y, z)).toBe(b(x, y, z));
      }
    }
  });
});

describe("seed sensitivity", () => {
  it("2D: seeds 42 vs 43 differ at most sampled points", () => {
    const a = makeNoise2D(42);
    const b = makeNoise2D(43);
    let differing = 0;
    let total = 0;
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        const x = i * 0.53 + 0.1;
        const z = j * 0.61 + 0.1;
        total++;
        if (a(x, z) !== b(x, z)) differing++;
      }
    }
    // The vast majority of points should differ between seeds.
    expect(differing).toBeGreaterThan(total * 0.9);
  });

  it("3D: seeds 42 vs 43 differ at most sampled points", () => {
    const a = makeNoise3D(42);
    const b = makeNoise3D(43);
    let differing = 0;
    let total = 0;
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        const x = i * 0.53 + 0.1;
        const y = j * 0.47 + 0.2;
        const z = (i - j) * 0.31 + 0.3;
        total++;
        if (a(x, y, z) !== b(x, y, z)) differing++;
      }
    }
    expect(differing).toBeGreaterThan(total * 0.9);
  });
});

describe("range", () => {
  it("2D: 1000+ sampled points stay within [-1.05, 1.05]", () => {
    const n = makeNoise2D(2024);
    for (let i = 0; i < 1000; i++) {
      const x = i * 0.123 - 50;
      const z = i * 0.077 + 13.5;
      const v = n(x, z);
      expect(v).toBeGreaterThanOrEqual(-TOL);
      expect(v).toBeLessThanOrEqual(TOL);
    }
  });

  it("3D: 1000+ sampled points stay within [-1.05, 1.05]", () => {
    const n = makeNoise3D(2024);
    for (let i = 0; i < 1000; i++) {
      const x = i * 0.123 - 50;
      const y = i * 0.041 + 2.0;
      const z = i * 0.077 + 13.5;
      const v = n(x, y, z);
      expect(v).toBeGreaterThanOrEqual(-TOL);
      expect(v).toBeLessThanOrEqual(TOL);
    }
  });
});

describe("continuity (smoothness)", () => {
  it("2D: small steps produce small changes", () => {
    const n = makeNoise2D(77);
    for (let i = 0; i < 500; i++) {
      const x = i * 0.137 - 10;
      const z = i * 0.059 + 4;
      const d = Math.abs(n(x, z) - n(x + 0.01, z));
      expect(d).toBeLessThan(0.2);
    }
  });

  it("2D: small steps in z produce small changes", () => {
    const n = makeNoise2D(77);
    for (let i = 0; i < 500; i++) {
      const x = i * 0.137 - 10;
      const z = i * 0.059 + 4;
      const d = Math.abs(n(x, z) - n(x, z + 0.01));
      expect(d).toBeLessThan(0.2);
    }
  });

  it("3D: small steps produce small changes", () => {
    const n = makeNoise3D(88);
    for (let i = 0; i < 500; i++) {
      const x = i * 0.137 - 10;
      const y = i * 0.083 + 1;
      const z = i * 0.059 + 4;
      const d = Math.abs(n(x, y, z) - n(x + 0.01, y, z));
      expect(d).toBeLessThan(0.2);
    }
  });
});

describe("fbm2d", () => {
  it("is deterministic", () => {
    const n: NoiseFn2D = makeNoise2D(5);
    expect(fbm2d(n, 1.5, 2.5, 4)).toBe(fbm2d(n, 1.5, 2.5, 4));
  });

  it("stays within [-1.05, 1.05] over many points and octave counts", () => {
    const n = makeNoise2D(5);
    for (let octaves = 1; octaves <= 6; octaves++) {
      for (let i = 0; i < 300; i++) {
        const x = i * 0.071 - 10;
        const z = i * 0.053 + 3;
        const v = fbm2d(n, x, z, octaves);
        expect(v).toBeGreaterThanOrEqual(-TOL);
        expect(v).toBeLessThanOrEqual(TOL);
      }
    }
  });

  it("respects custom lacunarity and gain deterministically", () => {
    const n = makeNoise2D(5);
    const a = fbm2d(n, 3.3, 4.4, 5, 2.5, 0.4);
    const b = fbm2d(n, 3.3, 4.4, 5, 2.5, 0.4);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(-TOL);
    expect(a).toBeLessThanOrEqual(TOL);
  });

  it("handles zero octaves gracefully (returns 0)", () => {
    const n = makeNoise2D(5);
    expect(fbm2d(n, 1, 2, 0)).toBe(0);
  });
});

describe("fbm3d", () => {
  it("is deterministic", () => {
    const n: NoiseFn3D = makeNoise3D(6);
    expect(fbm3d(n, 1.5, 2.5, 3.5, 4)).toBe(fbm3d(n, 1.5, 2.5, 3.5, 4));
  });

  it("stays within [-1.05, 1.05] over many points and octave counts", () => {
    const n = makeNoise3D(6);
    for (let octaves = 1; octaves <= 6; octaves++) {
      for (let i = 0; i < 300; i++) {
        const x = i * 0.071 - 10;
        const y = i * 0.037 + 1;
        const z = i * 0.053 + 3;
        const v = fbm3d(n, x, y, z, octaves);
        expect(v).toBeGreaterThanOrEqual(-TOL);
        expect(v).toBeLessThanOrEqual(TOL);
      }
    }
  });
});
