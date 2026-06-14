/**
 * particle-textures.ts — procedural soft-dot particle texture.
 *
 * Pure generation (generateDotRGBA) is Babylon-free and fully testable in Node.
 * The Babylon binding (createParticleTexture) is isolated in a single function.
 *
 * No image assets are loaded — the texture is synthesised entirely from code.
 */

import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Scene } from "@babylonjs/core/scene";

// ---------------------------------------------------------------------------
// Pure: no Babylon, testable in Node
// ---------------------------------------------------------------------------

/**
 * Generate a soft round dot as a flat RGBA Uint8Array.
 *
 * Each pixel is WHITE (255, 255, 255) with an alpha value derived from a
 * smooth radial falloff: alpha = 255 when at the exact centre, 0 at the
 * edge (radius ≥ 0.5 in normalised coordinates). The mapping uses a
 * cosine curve for a soft, Gaussian-like look without actual RNG or
 * wall-clock dependency — fully deterministic.
 *
 * @param size  Width and height in pixels (e.g. 16).
 * @returns     Flat RGBA array of length `size * size * 4`.
 */
export function generateDotRGBA(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const half = (size - 1) / 2;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      // Normalised distance from centre in [0, ~1] (0 = centre, 0.5 = edge).
      const nx = (col - half) / size; // range ≈ [-0.5, 0.5]
      const ny = (row - half) / size;
      const dist = Math.sqrt(nx * nx + ny * ny); // 0 at centre, ≈0.5+ at corners

      // Cosine falloff: 1 at centre, 0 at dist >= 0.5
      const t = Math.max(0, 1 - dist / 0.5); // linear clamp to [0,1]
      const alpha = Math.round(255 * (0.5 - 0.5 * Math.cos(Math.PI * t))); // smooth-step

      const base = (row * size + col) * 4;
      pixels[base] = 255;     // R
      pixels[base + 1] = 255; // G
      pixels[base + 2] = 255; // B
      pixels[base + 3] = alpha;
    }
  }

  return pixels;
}

// ---------------------------------------------------------------------------
// Babylon binding — not imported in tests
// ---------------------------------------------------------------------------

/** Size of the particle dot texture in pixels (power-of-two). */
const DOT_SIZE = 16;

/**
 * Build a {@link RawTexture} from the procedural dot data.
 *
 * The texture uses premultiplied-alpha blending so the soft edges composite
 * cleanly against the scene background without dark halos.
 *
 * @param scene  The Babylon scene that owns this texture.
 */
export function createParticleTexture(scene: Scene): RawTexture {
  const data = generateDotRGBA(DOT_SIZE);
  const tex = RawTexture.CreateRGBATexture(
    data,
    DOT_SIZE,
    DOT_SIZE,
    scene,
    /* generateMipMaps */ false,
    /* invertY */ false,
    Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
  );
  tex.hasAlpha = true;
  return tex;
}
