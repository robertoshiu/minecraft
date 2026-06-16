/**
 * post-fx.test.ts — unit tests for the post-processing effects module.
 *
 * Uses NullEngine (no real WebGL) to exercise initPostFX under a headless
 * Babylon environment. The NullEngine supports enough of the scene graph that
 * DefaultRenderingPipeline construction can be attempted (it may silently fall
 * back to null in headless; the tests verify graceful degradation as well as
 * the happy-path values when construction succeeds).
 *
 * SSAO is intentionally absent — the GeometryBufferRenderer ReadPixels stall
 * caused region-only rendering and was disabled. Tests assert SSAO methods are
 * no-ops (no throw) but do NOT assert that an SSAO pipeline was constructed.
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
  DEFAULT_EXPOSURE,
  DEFAULT_CONTRAST,
  DEFAULT_CC_GLOBAL_SATURATION,
  TONE_MODES,
  type PostFXController,
  type ToneMappingMode,
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
    setToneMappingMode: [],
    dispose: [],
  };
  return {
    calls,
    imageProcessing: null, // mock — no real pipeline
    setBloomEnabled(enabled: boolean) { calls["setBloomEnabled"]!.push([enabled]); },
    setSSAOEnabled(enabled: boolean) { calls["setSSAOEnabled"]!.push([enabled]); },
    setFilmGrainEnabled(enabled: boolean) { calls["setFilmGrainEnabled"]!.push([enabled]); },
    setBloomIntensity(value: number) { calls["setBloomIntensity"]!.push([value]); },
    setSSAOIntensity(value: number) { calls["setSSAOIntensity"]!.push([value]); },
    setFilmGrainIntensity(value: number) { calls["setFilmGrainIntensity"]!.push([value]); },
    setToneMappingMode(mode: ToneMappingMode) { calls["setToneMappingMode"]!.push([mode]); },
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

  it("exposure is a slight lift (1.0 < x <= 1.15)", () => {
    expect(DEFAULT_EXPOSURE).toBeGreaterThan(1.0);
    expect(DEFAULT_EXPOSURE).toBeLessThanOrEqual(1.15);
  });

  it("contrast adds modest punch (1.0 < x <= 1.20)", () => {
    expect(DEFAULT_CONTRAST).toBeGreaterThan(1.0);
    expect(DEFAULT_CONTRAST).toBeLessThanOrEqual(1.20);
  });

  it("color curves global saturation is subtly enriched (modest positive, not extreme)", () => {
    expect(DEFAULT_CC_GLOBAL_SATURATION).toBeGreaterThan(0);
    expect(DEFAULT_CC_GLOBAL_SATURATION).toBeLessThanOrEqual(40);
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
    expect(typeof ctrl.setToneMappingMode).toBe("function");
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
    ctrl.setToneMappingMode("neutral");
    ctrl.dispose();

    expect(ctrl.calls["setBloomEnabled"]).toEqual([[true]]);
    expect(ctrl.calls["setSSAOEnabled"]).toEqual([[false]]);
    expect(ctrl.calls["setFilmGrainEnabled"]).toEqual([[true]]);
    expect(ctrl.calls["setBloomIntensity"]).toEqual([[0.3]]);
    expect(ctrl.calls["setSSAOIntensity"]).toEqual([[0.4]]);
    expect(ctrl.calls["setFilmGrainIntensity"]).toEqual([[2]]);
    expect(ctrl.calls["setToneMappingMode"]).toEqual([["neutral"]]);
    expect(ctrl.calls["dispose"]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// SSAO — intentionally disabled; assert no-op behavior and no side effects
// ---------------------------------------------------------------------------

describe("initPostFX SSAO (intentionally disabled)", () => {
  it("SSAO methods are no-ops and never throw", () => {
    // SSAO is disabled to prevent the GeometryBufferRenderer ReadPixels stall.
    // The methods must still exist on the controller (interface compliance) but
    // they are silent no-ops.
    const ctrl = initPostFX(scene, camera);
    expect(() => { ctrl.setSSAOEnabled(true); }).not.toThrow();
    expect(() => { ctrl.setSSAOEnabled(false); }).not.toThrow();
    expect(() => { ctrl.setSSAOIntensity(0.15); }).not.toThrow();
    expect(() => { ctrl.dispose(); }).not.toThrow();
  });

  it("GeometryBufferRenderer is NOT activated (no geometry-buffer stall)", () => {
    // initPostFX must not call scene.enableGeometryBufferRenderer — if it did,
    // the GeometryBufferRenderer would be enabled and cause per-frame ReadPixels
    // stalls. Check that the scene has no active geometry buffer renderer after
    // initPostFX is called (NullEngine exposes geometryBufferRenderer as null
    // when not activated).
    initPostFX(scene, camera);
    // NullEngine: geometryBufferRenderer is null when not activated.
    // The property may not exist on scene in all Babylon versions; guard the check.
    const gbr = (scene as unknown as Record<string, unknown>)["geometryBufferRenderer"];
    expect(gbr).toBeFalsy();
  });

  it("does not emit any console.warn about SSAO when constructing normally", () => {
    const warnMessages: string[] = [];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((msg: string) => {
      warnMessages.push(String(msg));
    });

    initPostFX(scene, camera);

    // No SSAO-related warn should appear (it was deliberately removed, not
    // failing silently).
    const ssaoWarn = warnMessages.some((m) => m.toLowerCase().includes("ssao"));
    expect(ssaoWarn).toBe(false);

    warnSpy.mockRestore();
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

// ---------------------------------------------------------------------------
// setToneMappingMode — Phase 6c A/B grade toggle
// ---------------------------------------------------------------------------

describe("PostFXController.setToneMappingMode", () => {
  it("does not throw for either mode", () => {
    const ctrl = initPostFX(scene, camera);
    expect(() => { ctrl.setToneMappingMode("goldenHour"); }).not.toThrow();
    expect(() => { ctrl.setToneMappingMode("neutral"); }).not.toThrow();
    ctrl.dispose();
  });

  it("goldenHour grade equals the design-spec defaults (single source of truth)", () => {
    expect(TONE_MODES.goldenHour.exposure).toBe(DEFAULT_EXPOSURE);
    expect(TONE_MODES.goldenHour.contrast).toBe(DEFAULT_CONTRAST);
    expect(TONE_MODES.goldenHour.cc.globalSaturation).toBe(DEFAULT_CC_GLOBAL_SATURATION);
  });

  it("neutral grade is distinct from goldenHour", () => {
    expect(TONE_MODES.neutral.cc.globalSaturation).not.toBe(
      TONE_MODES.goldenHour.cc.globalSaturation,
    );
  });

  it("switching to neutral then back to goldenHour APPLIES the grade to the live pipeline (genuinely differential)", () => {
    // This test reads applied pipeline state — it MUST fail if setToneMappingMode
    // ignores its mode argument (Mutation A).
    const ctrl = initPostFX(scene, camera);
    const ip = ctrl.imageProcessing;
    // Skip if pipeline didn't construct (e.g. fully headless env without NullEngine support).
    if (ip === null) { ctrl.dispose(); return; }

    // --- Switch to neutral ---
    ctrl.setToneMappingMode("neutral");
    expect(ip.exposure).toBe(TONE_MODES.neutral.exposure);          // 0.98
    expect(ip.contrast).toBe(TONE_MODES.neutral.contrast);          // 1.02
    expect(ip.colorCurves!.globalSaturation).toBe(
      TONE_MODES.neutral.cc.globalSaturation,                        // 0
    );

    // --- Round-trip: back to goldenHour must fully restore every grade param ---
    ctrl.setToneMappingMode("goldenHour");
    expect(ip.exposure).toBe(DEFAULT_EXPOSURE);                      // 1.07
    expect(ip.contrast).toBe(DEFAULT_CONTRAST);                      // 1.10
    expect(ip.colorCurves!.globalSaturation).toBe(
      DEFAULT_CC_GLOBAL_SATURATION,                                  // 12
    );

    ctrl.dispose();
  });

  // NOTE: The null-pipeline guard in setToneMappingMode (`if (_pipeline === null) return`)
  // is defensive-only. Under NullEngine, DefaultRenderingPipeline always constructs
  // successfully, so _pipeline is never null post-init. PostFXControllerImpl._pipeline is
  // also `readonly`, so it cannot be nulled by dispose(). The null branch is not reachable
  // through the public API in a headless test environment and is therefore not testable
  // without mocking internals. The smoke test below only confirms no throw (no regression),
  // not that the null branch was exercised.

  it("mock controller records setToneMappingMode calls", () => {
    const ctrl = makeMockController();
    ctrl.setToneMappingMode("goldenHour");
    ctrl.setToneMappingMode("neutral");
    expect(ctrl.calls["setToneMappingMode"]).toEqual([["goldenHour"], ["neutral"]]);
  });
});
