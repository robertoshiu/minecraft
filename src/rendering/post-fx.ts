/**
 * post-fx.ts — post-processing effects for the voxel world.
 *
 * Implements the "Golden Hour Survival" design spec:
 *   - Bloom: threshold 0.85, intensity 0.3, kernel 4
 *   - SSAO: DISABLED (see note below)
 *   - Film grain: intensity 0.02, animated
 *   - No chromatic aberration, no vignette, no LUT
 *
 * Architecture:
 *   - initPostFX(scene, camera) creates the pipelines and returns a
 *     PostFXController with toggle / intensity setters and dispose().
 *   - Pipeline creation is wrapped in try/catch: if WebGL2 features are
 *     missing the controller degrades gracefully (methods become no-ops).
 *   - No side effects on import — safe to import in test environments.
 *
 * Deep tree-shaking imports from @babylonjs/core to keep the bundle lean.
 *
 * NOTE — SSAO disabled:
 *   SSAO2RenderingPipeline with forceGeometryBuffer=true activates
 *   GeometryBufferRenderer, which performs a per-frame GPU ReadPixels stall
 *   (~3.8 FPS headless) causing only partial frames to complete — the
 *   "renders only where the cursor points" symptom. Re-enable only on its
 *   own dedicated pipeline/camera when the stall is addressed.
 */

import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
// SSAO2RenderingPipeline import removed — see NOTE above.
// prePassRendererSceneComponent and geometryBufferRendererSceneComponent
// side-effect imports also removed (they activate the geometry buffer path
// that causes the per-frame ReadPixels stall).
import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";

// ---------------------------------------------------------------------------
// Design-spec defaults — single source of truth, referenced by tests.
// ---------------------------------------------------------------------------

/** Bloom luminance threshold above which areas glow. */
export const DEFAULT_BLOOM_THRESHOLD = 0.85;
/** Bloom contribution weight added to the final image. */
export const DEFAULT_BLOOM_INTENSITY = 0.3;
/** Bloom blur kernel size (relative to output size). */
export const DEFAULT_BLOOM_KERNEL = 4;
/** SSAO occlusion totalStrength. */
export const DEFAULT_SSAO_INTENSITY = 0.4;
/** Film-grain noise intensity (0..100 in Babylon's units; we use a small value). */
export const DEFAULT_GRAIN_INTENSITY = 2;

// ---------------------------------------------------------------------------
// PostFXController interface — exported for consumers and tests.
// ---------------------------------------------------------------------------

/** Controls post-processing effects after they have been initialised. */
export interface PostFXController {
  /** Enable or disable bloom. */
  setBloomEnabled(enabled: boolean): void;
  /** Enable or disable SSAO ambient occlusion. */
  setSSAOEnabled(enabled: boolean): void;
  /** Enable or disable film grain. */
  setFilmGrainEnabled(enabled: boolean): void;
  /** Set bloom contribution weight (0..1 typical). */
  setBloomIntensity(value: number): void;
  /** Set SSAO totalStrength (0..1 typical). */
  setSSAOIntensity(value: number): void;
  /** Set film grain intensity (Babylon units; 0..100). */
  setFilmGrainIntensity(value: number): void;
  /** Release all GPU resources held by the pipelines. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Internal implementation class (not exported directly).
// ---------------------------------------------------------------------------

class PostFXControllerImpl implements PostFXController {
  private readonly _pipeline: DefaultRenderingPipeline | null;
  // _ssao is always null — SSAO disabled (see module-level NOTE).

  constructor(pipeline: DefaultRenderingPipeline | null) {
    this._pipeline = pipeline;
  }

  setBloomEnabled(enabled: boolean): void {
    if (this._pipeline === null) return;
    this._pipeline.bloomEnabled = enabled;
  }

  setSSAOEnabled(_enabled: boolean): void {
    // SSAO disabled — no-op. See module-level NOTE.
  }

  setFilmGrainEnabled(enabled: boolean): void {
    if (this._pipeline === null) return;
    this._pipeline.grainEnabled = enabled;
  }

  setBloomIntensity(value: number): void {
    if (this._pipeline === null) return;
    this._pipeline.bloomWeight = value;
  }

  setSSAOIntensity(_value: number): void {
    // SSAO disabled — no-op. See module-level NOTE.
  }

  setFilmGrainIntensity(value: number): void {
    if (this._pipeline === null) return;
    this._pipeline.grain.intensity = value;
  }

  dispose(): void {
    if (this._pipeline !== null) {
      this._pipeline.dispose();
    }
    // No SSAO pipeline to dispose.
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Initialise post-processing effects on the given scene + camera.
 *
 * Returns a {@link PostFXController} that lets callers toggle and adjust
 * effects at runtime. If any pipeline fails to construct (e.g. WebGL2
 * features unavailable), that pipeline's methods become silent no-ops so
 * the game still runs.
 *
 * @param scene  The Babylon scene to attach effects to.
 * @param camera The primary camera the effects should be applied to.
 */
export function initPostFX(scene: Scene, camera: Camera): PostFXController {
  let pipeline: DefaultRenderingPipeline | null = null;

  // --- DefaultRenderingPipeline: bloom + grain ----------------------------
  try {
    const p = new DefaultRenderingPipeline("postfx-default", true, scene, [camera]);

    // Bloom — design spec: threshold 0.85, weight 0.3, kernel 4.
    p.bloomEnabled = true;
    p.bloomThreshold = DEFAULT_BLOOM_THRESHOLD;
    p.bloomWeight = DEFAULT_BLOOM_INTENSITY;
    p.bloomKernel = DEFAULT_BLOOM_KERNEL;

    // Film grain — design spec: intensity 0.02 (stored as 2 in Babylon units),
    // animated so it flickers naturally rather than being a static pattern.
    p.grainEnabled = true;
    p.grain.intensity = DEFAULT_GRAIN_INTENSITY;
    p.grain.animated = true;

    // Explicitly disabled per design spec.
    p.chromaticAberrationEnabled = false;
    // Enable image processing with ACES tone mapping so the HDR pipeline
    // correctly maps linear HDR values back to displayable [0,1] range.
    // Without this, raw HDR buffer values write to screen and lit surfaces
    // clip/wash out with the sun intensity values used in the scene.
    p.imageProcessingEnabled = true;
    p.imageProcessing.toneMappingEnabled = true;
    p.imageProcessing.toneMappingType = 1; // ImageProcessingConfiguration.TONEMAPPING_ACES
    p.imageProcessing.exposure = 1.0;
    p.fxaaEnabled = false;
    p.sharpenEnabled = false;
    p.depthOfFieldEnabled = false;
    p.glowLayerEnabled = false;

    pipeline = p;
  } catch (err) {
    console.warn("[post-fx] DefaultRenderingPipeline construction failed — bloom/grain unavailable.", err);
  }

  // SSAO disabled — per-frame GeometryBufferRenderer ReadPixels stall caused
  // region-only rendering ("renders only where the cursor points"). Re-enable
  // later only on its own pipeline/camera once the stall is addressed.

  return new PostFXControllerImpl(pipeline);
}
