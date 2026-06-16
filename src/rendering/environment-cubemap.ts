/**
 * environment-cubemap.ts — procedural IBL environment for the PBR terrain path
 * (Phase 6d, flag-gated). PURE generation (generateGradientCubeRGBA) + a guarded
 * Babylon wrapper (createEnvironmentCubemap) that degrades to null on failure.
 *
 * Faces (Babylon cube order +X,-X,+Y,-Y,+Z,-Z): a warm golden-hour gradient —
 * +X warm amber, -X cool blue, +Y bright sky, -Y dark warm floor, ±Z blend —
 * so IBL adds soft sky fill on shadowed faces + a faint warm sheen up top,
 * complementing the sun/hemi/CSM lighting rather than replacing it.
 *
 * No randomness, no wall-clock, no Babylon import in the pure path.
 */

import type { Scene } from "@babylonjs/core/scene";
import type { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";

/** Smoothstep (Hermite) — deterministic, no RNG. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Clamp a float color channel to an integer byte [0,255]. */
function toByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** Per-face base colors (linear-ish), warm golden-hour intent. */
const FACE_TOP: [number, number, number] = [0.55, 0.62, 0.78]; // +Y bright cool sky
const FACE_BOTTOM: [number, number, number] = [0.10, 0.08, 0.06]; // -Y dark warm floor
const FACE_WARM: [number, number, number] = [0.62, 0.48, 0.30]; // +X amber
const FACE_COOL: [number, number, number] = [0.30, 0.38, 0.52]; // -X cool blue
const FACE_MID: [number, number, number] = [0.44, 0.44, 0.42]; // ±Z neutral blend

/** The 6 face base colors in Babylon cube order: +X,-X,+Y,-Y,+Z,-Z. */
const FACE_COLORS: ReadonlyArray<[number, number, number]> = [
  FACE_WARM, FACE_COOL, FACE_TOP, FACE_BOTTOM, FACE_MID, FACE_MID,
];

/**
 * Generate a 6-face RGBA cubemap as a single Uint8Array of length
 * 6*size*size*4. Each face is a vertical gradient from its base color toward
 * the sky/floor tint, giving a soft horizon — deterministic, range [0,255].
 */
export function generateGradientCubeRGBA(size: number): Uint8Array {
  const faceBytes = size * size * 4;
  const out = new Uint8Array(6 * faceBytes);
  for (let face = 0; face < 6; face++) {
    const [br, bg, bb] = FACE_COLORS[face] ?? FACE_MID;
    const base = face * faceBytes;
    for (let y = 0; y < size; y++) {
      // v=0 at top of face, v=1 at bottom: lighten toward sky at top.
      const v = size <= 1 ? 0 : y / (size - 1);
      const lift = smoothstep(1, 0, v) * 0.18; // brighter near the top
      for (let x = 0; x < size; x++) {
        const o = base + (y * size + x) * 4;
        out[o] = toByte(br + lift);
        out[o + 1] = toByte(bg + lift);
        out[o + 2] = toByte(bb + lift);
        out[o + 3] = 255;
      }
    }
  }
  return out;
}

/** Default procedural cubemap face size (small — IBL needs no detail). */
export const ENV_CUBE_SIZE = 32;

/**
 * Build a Babylon {@link CubeTexture} from the procedural gradient. GUARDED:
 * returns null on any failure (NullEngine / low-end GPU) so IBL is purely
 * additive eye-candy that can never black out boot. Name: "environment-gradient".
 */
export function createEnvironmentCubemap(scene: Scene): CubeTexture | null {
  try {
    const size = ENV_CUBE_SIZE;
    const all = generateGradientCubeRGBA(size);
    const faceBytes = size * size * 4;
    // RawCubeTexture wants one Uint8Array per face.
    const faces: ArrayBufferView[] = [];
    for (let f = 0; f < 6; f++) {
      faces.push(all.subarray(f * faceBytes, (f + 1) * faceBytes));
    }
    // TEXTUREFORMAT_RGBA = 5, TEXTURETYPE_UNSIGNED_BYTE = 0.
    const tex = new RawCubeTexture(scene, faces, size, 5, 0);
    tex.name = "environment-gradient";
    return tex as unknown as CubeTexture;
  } catch (err) {
    console.warn("[ibl] environment cubemap construction failed — running without IBL.", err);
    return null;
  }
}
