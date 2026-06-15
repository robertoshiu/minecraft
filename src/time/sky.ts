/**
 * sky.ts — pure visual drivers for the day/night cycle.
 *
 * These functions take a *time of day* (`tod`, the value from
 * `clock.tickOfDay`, normally in `[0, TICKS_PER_DAY)`) and return data the
 * renderer feeds into Babylon: a clear-color for the sky, a directional-light
 * intensity, and a sun direction. Wiring these into the actual scene happens
 * elsewhere — this module is deliberately pure and engine-agnostic.
 *
 * CORRECTNESS NOTE (review U5): time is treated as CIRCULAR. Every input is
 * first normalised onto the `[0, TICKS_PER_DAY)` circle, and interpolation
 * walks along that circle including the wrap-around segment from the last
 * keyframe back to the first. Consequently the color at `tod = 24000`
 * (== `tod = 0`) equals the color at `tod = 0` EXACTLY, and `tod = 23999` is
 * continuous with `tod = 0` — there is no 1-frame "pop" at the day boundary.
 */

import { TIME } from "../rules/mc-1.20";

/** An RGB triple with each channel in `[0, 1]`. Also reused for direction vectors. */
export type RGB = [number, number, number];

const DAY = TIME.TICKS_PER_DAY;

/** Normalise any tick value onto the `[0, DAY)` circle (negative-safe). */
function wrapTod(tod: number): number {
  return ((tod % DAY) + DAY) % DAY;
}

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** A color keyframe positioned at a tick-of-day. */
interface Keyframe {
  readonly at: number;
  readonly color: RGB;
}

/**
 * Sky-color keyframes around the day circle.
 *
 *   0      morning sky-blue (== the wrap target, so 24000 lands here exactly)
 *   6000   noon: bright sky blue
 *   12000  late afternoon, still fairly bright
 *   12500  sunset: warm orange
 *   13000  dusk, rapidly darkening
 *   18000  midnight: dark navy
 *   22800  pre-dawn, still dark
 *   23200  sunrise: soft pink-orange
 *
 * The segment from the last keyframe (23200) wraps back to the first (0),
 * which is what makes tod=23999 continuous with tod=0.
 */
const SKY_KEYFRAMES: readonly Keyframe[] = [
  { at: 0, color: [0.45, 0.65, 0.95] },
  { at: 6000, color: [0.45, 0.65, 0.95] },
  { at: 12000, color: [0.5, 0.62, 0.85] },
  { at: 12500, color: [0.95, 0.55, 0.25] },
  { at: 13000, color: [0.35, 0.22, 0.28] },
  { at: 18000, color: [0.02, 0.03, 0.09] },
  { at: 22800, color: [0.06, 0.05, 0.16] },
  { at: 23200, color: [0.95, 0.6, 0.55] },
];

/**
 * The sky clear-color at the given time of day, interpolated on the circle
 * between {@link SKY_KEYFRAMES}. All channels are in `[0, 1]`.
 */
export function skyColorAt(tod: number): RGB {
  const t = wrapTod(tod);
  const n = SKY_KEYFRAMES.length;

  // Find the keyframe segment [lo, hi) that t falls into, treating the list as
  // circular: the final segment runs from the last keyframe, wraps past DAY,
  // and lands back on the first keyframe.
  for (let i = 0; i < n; i++) {
    const lo = SKY_KEYFRAMES[i];
    const hi = SKY_KEYFRAMES[(i + 1) % n];
    if (lo === undefined || hi === undefined) continue;

    const segStart = lo.at;
    const segEnd = i + 1 < n ? hi.at : lo.at + (DAY - lo.at) + hi.at;
    // For the wrap segment, also shift t into the same extended range.
    const tt = i + 1 < n ? t : t < lo.at ? t + DAY : t;

    if (tt >= segStart && tt <= segEnd) {
      const span = segEnd - segStart;
      const f = span === 0 ? 0 : (tt - segStart) / span;
      return [
        lerp(lo.color[0], hi.color[0], f),
        lerp(lo.color[1], hi.color[1], f),
        lerp(lo.color[2], hi.color[2], f),
      ];
    }
  }

  // Unreachable for normalised input; return the wrap-anchor color defensively.
  const first = SKY_KEYFRAMES[0];
  return first ? [first.color[0], first.color[1], first.color[2]] : [0, 0, 0];
}

/** Smoothstep easing on `[0, 1]`. */
function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Directional-light intensity for the sun, in `[0, 1]`.
 *
 * Full (~1.0) across the daytime [0, SUNSET_START); a smooth ramp down to ~0
 * across the sunset window [SUNSET_START, NIGHT_START); ~0 across the night
 * [NIGHT_START, SUNRISE_START); and a smooth ramp back up to full across the
 * sunrise window [SUNRISE_START, TICKS_PER_DAY). The ramps align with the
 * day-phase windows from {@link TIME}, so dusk/dawn are visibly transitional
 * rather than a hard cut. Naturally circular: intensity at tod 24000 == tod 0.
 */
export function sunLightIntensityAt(tod: number): number {
  const t = wrapTod(tod);
  if (t < TIME.SUNSET_START) return 1; // full day
  if (t < TIME.NIGHT_START) {
    // dusk: ramp 1 -> 0 across [SUNSET_START, NIGHT_START)
    const f = (t - TIME.SUNSET_START) / (TIME.NIGHT_START - TIME.SUNSET_START);
    return 1 - smoothstep(f);
  }
  if (t < TIME.SUNRISE_START) return 0; // night
  // dawn: ramp 0 -> 1 across [SUNRISE_START, TICKS_PER_DAY)
  const f = (t - TIME.SUNRISE_START) / (DAY - TIME.SUNRISE_START);
  return smoothstep(f);
}

/**
 * A normalised sun direction `[x, y, z]` for the directional light.
 *
 * The vertical component is capped at sin(65°) so the sun never reaches
 * directly overhead — it stays at a raking angle that yields golden-hour
 * shadows. At tod 6000 (noon) the sun is ~65° elevation; at the golden-hour
 * spawn TOD (~10000) it is lower (~25–30°), producing strong side-lighting.
 * x gives the east→west sweep; z is a small fixed southward tilt.
 */
export function sunDirectionAt(tod: number): RGB {
  const t = wrapTod(tod);
  const theta = (t / DAY) * Math.PI * 2;
  // Cap vertical component so the sun never goes fully overhead.
  const MAX_ELEV = (65 * Math.PI) / 180; // 65° in radians
  const y = Math.sin(theta) * Math.sin(MAX_ELEV);
  const x = Math.cos(theta);
  // Small fixed southward tilt for raking light from the south.
  const z = 0.15;
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / len, y / len, z / len];
}
