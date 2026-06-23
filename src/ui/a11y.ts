/**
 * a11y.ts — Accessibility helpers: colorblind ore adjustment + UI scale.
 *
 * Pure logic + persistence layer. No DOM, no Babylon.
 * Settings are persisted via a SaveStore (same pattern as preferences.ts).
 *
 * Colorblind adjustments are applied only to ore block IDs (coal, iron, gold,
 * redstone, diamond, lapis). Non-ore blocks are returned unmodified.
 *
 * RGB values are in [0, 1] (matching palette.ts convention).
 */

import { atomicWrite, loadOrDefault, type SaveStore } from "../save/store";
import { Blocks } from "../rules/mc-1.20";

// ---------------------------------------------------------------------------
// Colorblind mode
// ---------------------------------------------------------------------------

/** Supported colorblind simulation / compensation modes. */
export const ColorblindMode = {
  /** No adjustment — original colors. */
  NONE: "none",
  /** Protanopia: red-blind (long-wavelength cones absent). */
  PROTANOPIA: "protanopia",
  /** Deuteranopia: green-blind (medium-wavelength cones absent). */
  DEUTERANOPIA: "deuteranopia",
  /** Tritanopia: blue-blind (short-wavelength cones absent). */
  TRITANOPIA: "tritanopia",
} as const;

export type ColorblindMode = (typeof ColorblindMode)[keyof typeof ColorblindMode];

// ---------------------------------------------------------------------------
// Ore block set (only these block IDs receive color adjustment)
// ---------------------------------------------------------------------------

const ORE_BLOCK_IDS: ReadonlySet<number> = new Set([
  Blocks.COAL_ORE,
  Blocks.IRON_ORE,
  Blocks.GOLD_ORE,
  Blocks.REDSTONE_ORE,
  Blocks.DIAMOND_ORE,
  Blocks.LAPIS_ORE,
]);

/** An RGB triple, each component in [0, 1]. */
export type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// Color adjustment
// ---------------------------------------------------------------------------

/** Clamp a value into [0, 1]. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Adjust an ore block's color for the given colorblind mode.
 * Returns the original [r, g, b] values if the block is not an ore,
 * or if the mode is {@link ColorblindMode.NONE}.
 *
 * Adjustments aim to increase distinguishability of ores whose primary hue
 * is affected by the viewer's color vision deficiency:
 *
 *  - PROTANOPIA (red-blind): shift reds → yellows (boost G), greens → blues (boost B, reduce G).
 *  - DEUTERANOPIA (green-blind): shift greens → blues (boost B, reduce G), reds → oranges (boost G slightly).
 *  - TRITANOPIA (blue-blind): shift blues → reds (boost R, reduce B), yellows → pinks (boost R, reduce G).
 */
export function adjustOreColor(
  blockId: number,
  r: number,
  g: number,
  b: number,
  mode: ColorblindMode,
): RGB {
  // Non-ore blocks are never adjusted.
  if (!ORE_BLOCK_IDS.has(blockId)) return [r, g, b];
  // No adjustment requested.
  if (mode === ColorblindMode.NONE) return [r, g, b];

  // Determine dominant hue to decide which shift applies.
  const isRedDominant = r > g && r > b;
  const isGreenDominant = g > r && g > b;
  const isBlueDominant = b > r && b > g;

  let nr = r;
  let ng = g;
  let nb = b;

  if (mode === ColorblindMode.PROTANOPIA) {
    if (isRedDominant) {
      // Reds → yellows: boost green channel toward red level.
      ng = clamp01(g + r * 0.5);
      nr = clamp01(r * 0.7);
    } else if (isGreenDominant) {
      // Greens → blues: shift energy from green into blue.
      nb = clamp01(b + g * 0.6);
      ng = clamp01(g * 0.5);
    }
  } else if (mode === ColorblindMode.DEUTERANOPIA) {
    if (isGreenDominant) {
      // Greens → blues: shift energy from green into blue.
      nb = clamp01(b + g * 0.6);
      ng = clamp01(g * 0.4);
    } else if (isRedDominant) {
      // Reds → oranges: slightly boost green.
      ng = clamp01(g + r * 0.3);
    }
  } else if (mode === ColorblindMode.TRITANOPIA) {
    if (isBlueDominant) {
      // Blues → reds: shift energy from blue into red.
      nr = clamp01(r + b * 0.6);
      nb = clamp01(b * 0.4);
    } else if (!isBlueDominant && g >= r) {
      // Yellows (high R+G, low B) → pinks: boost red, reduce green.
      nr = clamp01(r + g * 0.3);
      ng = clamp01(g * 0.6);
    }
  }

  return [nr, ng, nb];
}

// ---------------------------------------------------------------------------
// UI Scale
// ---------------------------------------------------------------------------

const UI_SCALE_MIN = 0.5;
const UI_SCALE_MAX = 2.0;
const UI_SCALE_DEFAULT = 1.0;

/** Clamp a UI scale value to the valid range [0.5, 2.0]. */
export function clampUIScale(scale: number): number {
  if (!Number.isFinite(scale)) return UI_SCALE_DEFAULT;
  return Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, scale));
}

/**
 * Apply a UI scale factor to a base pixel size.
 * Returns the product, rounded to the nearest integer pixel.
 */
export function applyUIScale(baseSize: number, scale: number): number {
  return Math.round(baseSize * clampUIScale(scale));
}

// ---------------------------------------------------------------------------
// Serialization (JSON-in-Uint8Array; tolerant on parse)
// ---------------------------------------------------------------------------

interface A11yData {
  colorblindMode: ColorblindMode;
  uiScale: number;
}

const DEFAULT_A11Y_DATA: A11yData = {
  colorblindMode: ColorblindMode.NONE,
  uiScale: UI_SCALE_DEFAULT,
};

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

function serializeA11y(data: A11yData): Uint8Array {
  return TEXT_ENCODER.encode(JSON.stringify(data));
}

function isColorblindMode(v: unknown): v is ColorblindMode {
  return (
    v === ColorblindMode.NONE ||
    v === ColorblindMode.PROTANOPIA ||
    v === ColorblindMode.DEUTERANOPIA ||
    v === ColorblindMode.TRITANOPIA
  );
}

function parseA11y(bytes: Uint8Array): A11yData {
  if (bytes.byteLength === 0) return { ...DEFAULT_A11Y_DATA };
  let raw: unknown;
  try {
    raw = JSON.parse(TEXT_DECODER.decode(bytes));
  } catch {
    return { ...DEFAULT_A11Y_DATA };
  }
  if (raw === null || typeof raw !== "object") return { ...DEFAULT_A11Y_DATA };
  const obj = raw as Record<string, unknown>;

  const modeRaw = obj["colorblindMode"];
  const mode = isColorblindMode(modeRaw) ? modeRaw : DEFAULT_A11Y_DATA.colorblindMode;

  const scaleRaw = obj["uiScale"];
  const scale =
    typeof scaleRaw === "number" && Number.isFinite(scaleRaw)
      ? clampUIScale(scaleRaw)
      : DEFAULT_A11Y_DATA.uiScale;

  return { colorblindMode: mode, uiScale: scale };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const A11Y_KEY = "a11y";

async function loadA11yData(store: SaveStore): Promise<A11yData> {
  return loadOrDefault(store, A11Y_KEY, parseA11y, () => ({ ...DEFAULT_A11Y_DATA }));
}

async function saveA11yData(store: SaveStore, data: A11yData): Promise<void> {
  try {
    await atomicWrite(store, A11Y_KEY, serializeA11y(data));
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Runtime API (in-memory state for the current session)
// ---------------------------------------------------------------------------

let _data: A11yData = { ...DEFAULT_A11Y_DATA };
let _store: SaveStore | null = null;

/**
 * Initialize the accessibility system with a store. Must be called once at
 * startup before any get/set calls.
 */
export async function initA11y(store: SaveStore): Promise<void> {
  _store = store;
  _data = await loadA11yData(store);
}

/** Return the active colorblind mode. */
export function getColorblindMode(): ColorblindMode {
  return _data.colorblindMode;
}

/** Set the active colorblind mode and persist. */
export async function setColorblindMode(mode: ColorblindMode): Promise<void> {
  _data = { ..._data, colorblindMode: mode };
  if (_store !== null) {
    await saveA11yData(_store, _data);
  }
}

/** Return the active UI scale (clamped to [0.5, 2.0]). */
export function getUIScale(): number {
  return _data.uiScale;
}

/** Set the UI scale (clamped to [0.5, 2.0]) and persist. */
export async function setUIScale(scale: number): Promise<void> {
  _data = { ..._data, uiScale: clampUIScale(scale) };
  if (_store !== null) {
    await saveA11yData(_store, _data);
  }
}
