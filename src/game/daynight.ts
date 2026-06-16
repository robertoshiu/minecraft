/**
 * daynight.ts — drives the live Babylon scene from the pure day/night clock.
 *
 * The pure logic lives in src/time (clock.ts) and src/time/sky.ts; this module
 * is the thin glue that reads `tickOfDay(clock)` each frame and pushes the
 * resulting sky color, sun light, and fog into the actual Babylon scene. It
 * imports the pure modules — it does NOT reimplement any of their math.
 *
 * One full day = TIME.TICKS_PER_DAY (24000) ticks. The clock is advanced by
 * `advance(clock, 1)` once per fixed physics tick at TICKS_PER_SECOND (20) TPS,
 * so a full day is 24000 / 20 = 1200 real seconds = 20 minutes — matching
 * TIME.REAL_SECONDS_PER_DAY exactly.
 */

import type { Scene } from "@babylonjs/core/scene";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";

import type { Clock } from "../time/clock";
import { tickOfDay } from "../time/clock";
import { skyColorAt, sunLightIntensityAt, sunDirectionAt } from "../time/sky";

/**
 * Peak directional-light intensity at full day (sky intensity 1.0 → this).
 *
 * Tuned for the DESIGN.md "Golden Hour Survival" intent: the prior 1.5 read too
 * dark with the vertex-color world, so noon now lands at ~2.4 — clearly bright
 * and readable — while night still ramps to ~0 (the sun-intensity curve in
 * src/time/sky.ts is unchanged, only this scale is raised).
 */
const SUN_MAX_INTENSITY = 2.4;
/** Hemispheric ambient at full day (raised from 0.7 → 1.1 so side faces are legible). */
const HEMI_DAY_INTENSITY = 1.1;
/** Hemispheric ambient at deepest night (kept non-zero so the world is legible). */
const HEMI_NIGHT_INTENSITY = 0.15;

/** The Babylon scene objects the day/night cycle drives each frame. */
export interface SkyTargets {
  scene: Scene;
  sun: DirectionalLight;
  hemi: HemisphericLight;
}

/**
 * Apply the clock's current time-of-day to the scene: sky clear color, fog
 * color (warmer + less blue than the sky during the day, tracks sky at night),
 * directional sun intensity + direction, and a dimmer hemispheric ambient at
 * night. Called every render frame.
 */
export function applySky(
  targets: SkyTargets,
  clock: Clock,
  env?: { texture: BaseTexture; intensity: number },
): void {
  const tod = tickOfDay(clock);

  const [r, g, b] = skyColorAt(tod);
  const intensity = sunLightIntensityAt(tod);
  const [sx, sy, sz] = sunDirectionAt(tod);

  // Sky clear color (alpha unchanged).
  targets.scene.clearColor.r = r;
  targets.scene.clearColor.g = g;
  targets.scene.clearColor.b = b;

  // Fog: warmer + slightly less blue than the sky during the day (intensity-scaled);
  // tracks the sky at night when intensity ~= 0.
  const fogR = Math.min(1, r + 0.04 * intensity);
  const fogG = Math.min(1, Math.max(0, g + 0.02 * intensity));
  const fogB = Math.min(1, Math.max(0, b - 0.03 * intensity));
  targets.scene.fogColor = new Color3(fogR, fogG, fogB);

  // Directional light: scale [0,1] intensity to a sane max.
  targets.sun.intensity = intensity * SUN_MAX_INTENSITY;
  // sunDirectionAt points FROM origin TOWARD the sun; a DirectionalLight's
  // `.direction` is the direction light TRAVELS, so negate it (light points
  // down at noon when the sun is overhead).
  targets.sun.direction.set(-sx, -sy, -sz);

  // Ambient hemispheric light fades toward (but never to) zero at night.
  targets.hemi.intensity =
    HEMI_NIGHT_INTENSITY +
    (HEMI_DAY_INTENSITY - HEMI_NIGHT_INTENSITY) * intensity;

  // Phase 6d (flag-gated, additive): when IBL is active the caller passes an
  // env texture + a day/night-scaled intensity. Omitted on the default path,
  // so the OFF look is byte-identical. environmentIntensity is a 0..1 multiplier.
  if (env !== undefined) {
    targets.scene.environmentTexture = env.texture;
    targets.scene.environmentIntensity = Math.max(0, Math.min(1, env.intensity));
  }
}
