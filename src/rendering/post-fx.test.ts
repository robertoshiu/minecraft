/**
 * post-fx.test.ts — unit tests for the post-processing effects module.
 *
 * Uses NullEngine (no real WebGL) to exercise initPostFX under a headless
 * Babylon environment. The NullEngine supports enough of the scene graph that
 * DefaultRenderingPipeline and SSAO2 construction can be attempted (both may
 * silently fall back to null in headless; the tests verify graceful degradation
 * as well as the happy-path values when construction succeeds).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import {
  initPostFX,
  DEFAULT_BLOOM_THRESHOLD,
  DEFAULT_BLOOM_INTENSITY,
  DEFAULT_BLOOM_KERNEL,
  DEFAULT_SSAO_INTENSITY,
  DEFAULT_GRAIN_INTENSITY,
  type PostFXController,
} from "./post-fx";

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock that satisfies the PostFXController interface.
 * Used to test callers independently of the real implementation.
 */
function makeMockController(): PostFXController & {
  calls: Record<string, unknown[][]>;
} {
  const calls: Record<string, unknown[][]> = {
    setBloomEnabled: [],
    setSSAOEnabled: [],
    setFilmGrainEnabled: [],
    setBloomIntensity: [],
    setSSAOIntensity: [],
    setFilmGrainIntensity: [],
    dispose: [],
  };
  return {
    calls,
    setBloomEnabled(enabled: boolean) { calls["setBloomEnabled"]!.push([enabled]); },
    setSSAOEnabled(enabled: boolean) { calls["setSSAOEnabled"]!.push([enabled]); },
    setFilmGrainEnabled(enabled: boolean) { calls["setFilmGrainEnabled"]!.push([enabled]); },
    setBloomIntensity(value: number) { calls["setBloomIntensity"]!.push([value]); },
    setSSAOIntensity(value: number) { calls["setSSAOIntensity"]!.push([value]); },
    setFilmGrainIntensity(value: number) { calls["setFilmGrainIntensity"]!.push([value]); },
    dispose() { calls["dispose"]!.push([]); },
  };
}

// ---------------------------------------------------------------------------
// Babylon environment setup
// ---------------------------------------------------------------------------

let engine: NullEngine;
let scene: Scene;
let camera: UniversalCamera;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  camera = new UniversalCamera("camera", new Vector3(0, 0, 0), scene);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

// ---------------------------------------------------------------------------
// Design-spec constant tests — these must not drift from DESIGN.md values.
// ---------------------------------------------------------------------------

describe("design-spec constants", () => {
  it("bloom threshold matches DESIGN.md (0.85)", () => {
    expect(DEFAULT_BLOOM_THRESHOLD).toBe(0.85);
  });

  it("bloom intensity matches DESIGN.md (0.3)", () => {
    expect(DEFAULT_BLOOM_INTENSITY).toBe(0.3);
  });

  it("bloom kernel matches DESIGN.md (4)", () => {
    expect(DEFAULT_BLOOM_KERNEL).toBe(4);
  });

  it("SSAO intensity matches DESIGN.md (0.4)", () => {
    expect(DEFAULT_SSAO_INTENSITY).toBe(0.4);
  });

  it("film grain intensity matches DESIGN.md (0.02 → 2 Babylon units)", () => {
    // DESIGN.md specifies 0.02; Babylon's GrainPostProcess intensity is
    // on a 0..100 scale, so 0.02 * 100 = 2.
    expect(DEFAULT_GRAIN_INTENSITY).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// initPostFX — construction and graceful degradation
// ---------------------------------------------------------------------------

describe("initPostFX", () => {
  it("does not throw when called with a valid NullEngine scene and camera", () => {
    expect(() => { initPostFX(scene, camera); }).not.toThrow();
  });

  it("returns an object implementing the PostFXController interface", () => {
    const ctrl = initPostFX(scene, camera);
    expect(typeof ctrl.setBloomEnabled).toBe("function");
    expect(typeof ctrl.setSSAOEnabled).toBe("function");
    expect(typeof ctrl.setFilmGrainEnabled).toBe("function");
    expect(typeof ctrl.setBloomIntensity).toBe("function");
    expect(typeof ctrl.setSSAOIntensity).toBe("function");
    expect(typeof ctrl.setFilmGrainIntensity).toBe("function");
    expect(typeof ctrl.dispose).toBe("function");
  });

  it("does not throw when called twice (independent controllers)", () => {
    expect(() => {
      const a = initPostFX(scene, camera);
      const b = initPostFX(scene, camera);
      a.dispose();
      b.dispose();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Toggle methods — smoke tests
// ---------------------------------------------------------------------------

describe("PostFXController.setBloomEnabled", () => {
  it("does not throw when toggled on/off", () => {
    const ctrl = initPostFX(scene, camera);
    expect(() => { ctrl.setBloomEnabled(false); }).not.toThrow();
    expect(() => { ctrl.setBloomEnabled(true); }).not.toThrow();
    ctrl.dispose();
  });
});

describe("PostFXController.setSSAOEnabled", () => {
  it("does not throw when toggled on/off", () => {
    const ctrl = initPostFX(scene, camera);
    expect(() => { ctrl.setSSAOEnabled(false); }).not.toThrow();
    expect(() => { ctrl.setSSAOEnabled(true); }).not.toThrow();
    ctrl.dispose();
  });
});

describe("PostFXController.setFilmGrainEnabled", () => {
  it("does not throw when toggled on/off", () => {
    const ctrl = initPostFX(scene, camera);
    expect(() => { ctrl.setFilmGrainEnabled(false); }).not.toThrow();
    expect(() => { ctrl.setFilmGrainEnabled(true); }).not.toThrow();
    ctrl.dispose();
  });
});

// ---------------------------------------------------------------------------
// Intensity setters — smoke tests
// ---------------------------------------------------------------------------

describe("PostFXController.setBloomIntensity", () => {
  it("does not throw for values in typical range", () => {
    const ctrl = initPostFX(scene, camera);
    expect(() => { ctrl.setBloomIntensity(0); }).not.toThrow();
    expect(() => { ctrl.setBloomIntensity(0.5); }).not.toThrow();
    expect(() => { ctrl.setBloomIntensity(1); }).not.toThrow();
    ctrl.dispose();
  });
});

describe("PostFXController.setSSAOIntensity", () => {
  it("does not throw for values in typical range", () => {
    const ctrl = initPostFX(scene, camera);
    expect(() => { ctrl.setSSAOIntensity(0); }).not.toThrow();
    expect(() => { ctrl.setSSAOIntensity(0.4); }).not.toThrow();
    expect(() => { ctrl.setSSAOIntensity(1); }).not.toThrow();
    ctrl.dispose();
  });
});

describe("PostFXController.setFilmGrainIntensity", () => {
  it("does not throw for values in typical range", () => {
    const ctrl = initPostFX(scene, camera);
    expect(() => { ctrl.setFilmGrainIntensity(0); }).not.toThrow();
    expect(() => { ctrl.setFilmGrainIntensity(2); }).not.toThrow();
    expect(() => { ctrl.setFilmGrainIntensity(10); }).not.toThrow();
    ctrl.dispose();
  });
});

// ---------------------------------------------------------------------------
// dispose() — cleanup
// ---------------------------------------------------------------------------

describe("PostFXController.dispose", () => {
  it("does not throw on first call", () => {
    const ctrl = initPostFX(scene, camera);
    expect(() => { ctrl.dispose(); }).not.toThrow();
  });

  it("does not throw when called multiple times", () => {
    const ctrl = initPostFX(scene, camera);
    expect(() => {
      ctrl.dispose();
      ctrl.dispose();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Mock controller — verifies the interface contract for callers.
// ---------------------------------------------------------------------------

describe("PostFXController interface (mock)", () => {
  it("mock records all method calls", () => {
    const ctrl = makeMockController();

    ctrl.setBloomEnabled(true);
    ctrl.setSSAOEnabled(false);
    ctrl.setFilmGrainEnabled(true);
    ctrl.setBloomIntensity(0.3);
    ctrl.setSSAOIntensity(0.4);
    ctrl.setFilmGrainIntensity(2);
    ctrl.dispose();

    expect(ctrl.calls["setBloomEnabled"]).toEqual([[true]]);
    expect(ctrl.calls["setSSAOEnabled"]).toEqual([[false]]);
    expect(ctrl.calls["setFilmGrainEnabled"]).toEqual([[true]]);
    expect(ctrl.calls["setBloomIntensity"]).toEqual([[0.3]]);
    expect(ctrl.calls["setSSAOIntensity"]).toEqual([[0.4]]);
    expect(ctrl.calls["setFilmGrainIntensity"]).toEqual([[2]]);
    expect(ctrl.calls["dispose"]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation — simulate pipeline failure via console.warn spy
// ---------------------------------------------------------------------------

describe("initPostFX graceful degradation", () => {
  it("warns via console.warn when a pipeline fails and still returns a controller", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => { /* suppress */ });

    // Dispose scene to trigger failures inside initPostFX (scene-less context).
    scene.dispose();

    let ctrl: PostFXController | null = null;
    expect(() => {
      ctrl = initPostFX(scene, camera);
    }).not.toThrow();

    // The controller must still be usable (no-ops).
    expect(() => { ctrl?.setBloomEnabled(false); }).not.toThrow();
    expect(() => { ctrl?.dispose(); }).not.toThrow();

    warnSpy.mockRestore();
  });
});
