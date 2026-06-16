import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import {
  generateGradientCubeRGBA,
  createEnvironmentCubemap,
  ENV_CUBE_SIZE,
} from "./environment-cubemap";

describe("generateGradientCubeRGBA (pure)", () => {
  it("returns 6 RGBA faces of the requested size", () => {
    const size = 16;
    const data = generateGradientCubeRGBA(size);
    expect(data.length).toBe(6 * size * size * 4);
  });

  it("is deterministic (two calls byte-identical)", () => {
    const a = generateGradientCubeRGBA(8);
    const b = generateGradientCubeRGBA(8);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("every channel is an integer in [0,255] and alpha is 255", () => {
    const data = generateGradientCubeRGBA(8);
    for (let i = 0; i < data.length; i++) {
      const v = data[i] ?? -1;
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
    // Alpha (every 4th byte) is fully opaque.
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });

  it("ENV_CUBE_SIZE is a small power-of-two-ish face size", () => {
    expect(ENV_CUBE_SIZE).toBeGreaterThan(0);
    expect(ENV_CUBE_SIZE).toBeLessThanOrEqual(64);
  });

  it("gradient is non-flat: top row differs from bottom row (per-face)", () => {
    // Use a large enough size that the gradient has room to vary meaningfully.
    const size = 16;
    const data = generateGradientCubeRGBA(size);
    const faceBytes = size * size * 4;
    // Check each face: first row (y=0, top) vs last row (y=size-1, bottom).
    for (let face = 0; face < 6; face++) {
      const base = face * faceBytes;
      // Average R of top row
      let topR = 0;
      for (let x = 0; x < size; x++) topR += data[base + x * 4] ?? 0;
      topR /= size;
      // Average R of bottom row
      let botR = 0;
      const botRowStart = base + (size - 1) * size * 4;
      for (let x = 0; x < size; x++) botR += data[botRowStart + x * 4] ?? 0;
      botR /= size;
      // The top should be brighter (lift applied near top) — assert they differ
      expect(topR).not.toBe(botR);
    }
  });
});

describe("createEnvironmentCubemap (guarded, NullEngine)", () => {
  let engine: NullEngine;
  let scene: Scene;
  beforeAll(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
  });
  afterAll(() => {
    scene.dispose();
    engine.dispose();
  });

  it("does not throw under NullEngine (returns a texture or null)", () => {
    let tex: ReturnType<typeof createEnvironmentCubemap> | undefined;
    expect(() => {
      tex = createEnvironmentCubemap(scene);
    }).not.toThrow();
    // Either a named texture or a graceful null — both are acceptable headless.
    if (tex !== null && tex !== undefined) {
      expect(tex.name).toBe("environment-gradient");
    }
  });
});
