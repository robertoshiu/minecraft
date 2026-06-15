/**
 * item-icon.ts — lazily materialise the procedural atlas into a data URL so
 * inventory/hotbar slots can display block icons as CSS backgrounds.
 *
 * The atlas lives in GPU memory (RawTexture) and has no image URL, so we
 * blit it to an offscreen HTMLCanvasElement once and cache toDataURL().
 *
 * GUARD CONTRACT:
 *   - All DOM operations are guarded with try/catch and typeof document checks.
 *   - If the environment has no canvas/document (Node, vitest, NullEngine),
 *     getAtlasIconStyle() returns null and callers fall back to text labels.
 *   - This keeps all 850+ headless tests green.
 */

import { generateAtlasRGBA, ATLAS_PX, ATLAS_GRID } from "../rendering/atlas";
import { BLOCK_REGISTRY } from "../rules/block-registry";
import type { FaceDir } from "../chunk/data";

// ---------------------------------------------------------------------------
// Cached atlas data URL
// ---------------------------------------------------------------------------

/** Lazily-built data URL of the full 1024×1024 atlas, or null if unavailable. */
let _cachedAtlasDataUrl: string | null | undefined = undefined; // undefined = not yet attempted

/**
 * Build (once) and cache an `image/png` data URL of the procedural atlas.
 * Returns null when the DOM canvas API is unavailable (headless/test env).
 */
function getAtlasDataUrl(): string | null {
  if (_cachedAtlasDataUrl !== undefined) return _cachedAtlasDataUrl;

  try {
    if (typeof document === "undefined") {
      _cachedAtlasDataUrl = null;
      return null;
    }
    const canvas = document.createElement("canvas");
    if (typeof canvas.getContext !== "function") {
      _cachedAtlasDataUrl = null;
      return null;
    }
    canvas.width = ATLAS_PX;
    canvas.height = ATLAS_PX;
    const ctx2d = canvas.getContext("2d");
    if (ctx2d === null) {
      _cachedAtlasDataUrl = null;
      return null;
    }
    const rgba = generateAtlasRGBA();
    // Copy bytes into a fresh Uint8ClampedArray backed by a plain ArrayBuffer.
    // This avoids the ArrayBufferLike / SharedArrayBuffer ambiguity that the
    // ImageData constructor does not accept.
    const clampedCopy = new Uint8ClampedArray(rgba.length);
    clampedCopy.set(rgba);
    const imageData = new ImageData(clampedCopy, ATLAS_PX, ATLAS_PX);
    ctx2d.putImageData(imageData, 0, 0);
    const url = canvas.toDataURL();
    _cachedAtlasDataUrl = url;
    return url;
  } catch {
    _cachedAtlasDataUrl = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Icon style computation
// ---------------------------------------------------------------------------

/**
 * The inline style properties to show a block icon as a CSS background.
 * Apply these to a slot element to render the atlas tile for the given block.
 */
export interface AtlasIconStyle {
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  imageRendering: string;
}

/**
 * Return a CSS background style that shows the atlas tile for `itemId`, or
 * null when:
 *  - the item has no block definition (tool / non-block item)
 *  - the atlas data URL is unavailable (canvas not supported, headless env)
 *
 * Uses the "px" (positive-x / front) face tile as a representative icon face.
 */
export function getAtlasIconStyle(itemId: number): AtlasIconStyle | null {
  // Only block items that exist in the registry get an icon.
  const def = BLOCK_REGISTRY[itemId];
  if (def === undefined) return null;

  // Get the representative tile index for the "px" face of this block.
  const faceDir: FaceDir = "px";
  const tileIdx = def.faceTiles[faceDir];

  // Compute col/row in the 16×16 atlas grid.
  const col = tileIdx % ATLAS_GRID;
  const row = Math.floor(tileIdx / ATLAS_GRID);

  // backgroundSize: atlas is ATLAS_GRID×ATLAS_GRID tiles, so scaling it to
  // ATLAS_GRID×100% shows exactly one tile at 100% of the element size.
  const gridPct = `${String(ATLAS_GRID * 100)}%`;

  // backgroundPosition: maps (col, row) to percentage offsets.
  // At ATLAS_GRID=16 tiles: steps are 1/15 (0%, 6.67%, ..., 100%).
  const xPct = ATLAS_GRID <= 1 ? "0%" : `${String((col / (ATLAS_GRID - 1)) * 100)}%`;
  const yPct = ATLAS_GRID <= 1 ? "0%" : `${String((row / (ATLAS_GRID - 1)) * 100)}%`;

  const dataUrl = getAtlasDataUrl();
  if (dataUrl === null) return null;

  return {
    backgroundImage: `url(${dataUrl})`,
    backgroundSize: `${gridPct} ${gridPct}`,
    backgroundPosition: `${xPct} ${yPct}`,
    imageRendering: "pixelated",
  };
}

/**
 * Reset the cached atlas data URL. Used in tests to force a fresh build.
 * Not exported in production builds; only call from tests.
 */
export function _resetAtlasCache(): void {
  _cachedAtlasDataUrl = undefined;
}
