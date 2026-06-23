/**
 * preferences.ts — PURE + persistence layer for player settings.
 *
 * Pure: no DOM, no Babylon. All clamping, serialization, and parsing live here
 * so they are fully unit-testable without any environment setup.
 *
 * Persistence: delegates read/write to a {@link SaveStore} via
 * {@link atomicWrite} / {@link safeRead} (same pattern as the game save).
 */

import { atomicWrite, loadOrDefault, type SaveStore } from "../save/store";
import { type ColorblindMode } from "../ui/a11y";

/** Tone-mapping / color-grade mode (Phase 6c A/B toggle). */
export type ToneMappingMode = "goldenHour" | "neutral";

/** All valid tone-mapping modes (used to validate persisted prefs). */
export const VALID_TONE_MAPPING_MODES: ReadonlyArray<ToneMappingMode> = [
  "goldenHour",
  "neutral",
];

/** All user-adjustable settings. */
export interface Prefs {
  /** View distance in chunk columns (2..12). */
  renderDistance: number;
  /** Camera FOV in degrees (60..110). */
  fov: number;
  /** Mouse look sensitivity (0.2..3). Higher = faster. */
  mouseSensitivity: number;
  /** Master audio volume (0..1). */
  masterVolume: number;
  /** Sound-effects volume (0..1). */
  sfxVolume: number;
  /** Ambient audio volume (0..1). */
  ambientVolume: number;
  /** Post-FX: bloom pass enabled. */
  bloomEnabled: boolean;
  /** Post-FX: SSAO ambient occlusion enabled. */
  ssaoEnabled: boolean;
  /** Post-FX: film grain enabled. */
  filmGrainEnabled: boolean;
  /** Colorblind ore-color compensation mode. */
  colorblindMode: ColorblindMode;
  /** Tone-mapping / color grade (Phase 6c). Persisted; live-applied to post-FX. */
  toneMappingMode: ToneMappingMode;
  /**
   * IBL environment-light intensity for the PBR terrain path (Phase 6d), 0..1.
   * Scales scene.environmentIntensity (× day/night sun curve). Ignored when
   * USE_PBR_TERRAIN is off (the scene has no environment texture then).
   */
  pbrIntensity: number;
  /** UI scale multiplier (0.5..2.0). */
  uiScale: number;
}

/** Sensible defaults — what a fresh install starts with. */
export const DEFAULT_PREFS: Prefs = {
  renderDistance: 8,
  fov: 75,
  mouseSensitivity: 1.0,
  masterVolume: 1.0,
  sfxVolume: 1.0,
  ambientVolume: 0.6,
  bloomEnabled: true,
  ssaoEnabled: true,
  filmGrainEnabled: true,
  colorblindMode: "none",
  toneMappingMode: "goldenHour",
  pbrIntensity: 0.5,
  uiScale: 1.0,
};

// ---------------------------------------------------------------------------
// Clamping
// ---------------------------------------------------------------------------

/**
 * Return a new Prefs with all fields clamped to their valid ranges.
 * Reads NaN / non-finite values as the default for that field.
 */
export function clampPrefs(p: Prefs): Prefs {
  function clampField(value: number, min: number, max: number, def: number): number {
    if (!Number.isFinite(value)) return def;
    return Math.max(min, Math.min(max, value));
  }

  const VALID_COLORBLIND_MODES: ReadonlyArray<ColorblindMode> = [
    "none",
    "protanopia",
    "deuteranopia",
    "tritanopia",
  ];

  return {
    renderDistance: Math.round(clampField(p.renderDistance, 2, 12, DEFAULT_PREFS.renderDistance)),
    fov: clampField(p.fov, 60, 110, DEFAULT_PREFS.fov),
    mouseSensitivity: clampField(p.mouseSensitivity, 0.2, 3, DEFAULT_PREFS.mouseSensitivity),
    masterVolume: clampField(p.masterVolume, 0, 1, DEFAULT_PREFS.masterVolume),
    sfxVolume: clampField(p.sfxVolume, 0, 1, DEFAULT_PREFS.sfxVolume),
    ambientVolume: clampField(p.ambientVolume, 0, 1, DEFAULT_PREFS.ambientVolume),
    bloomEnabled: typeof p.bloomEnabled === "boolean" ? p.bloomEnabled : DEFAULT_PREFS.bloomEnabled,
    ssaoEnabled: typeof p.ssaoEnabled === "boolean" ? p.ssaoEnabled : DEFAULT_PREFS.ssaoEnabled,
    filmGrainEnabled: typeof p.filmGrainEnabled === "boolean" ? p.filmGrainEnabled : DEFAULT_PREFS.filmGrainEnabled,
    colorblindMode: VALID_COLORBLIND_MODES.includes(p.colorblindMode)
      ? p.colorblindMode
      : DEFAULT_PREFS.colorblindMode,
    toneMappingMode: VALID_TONE_MAPPING_MODES.includes(p.toneMappingMode)
      ? p.toneMappingMode
      : DEFAULT_PREFS.toneMappingMode,
    pbrIntensity: clampField(p.pbrIntensity, 0, 1, DEFAULT_PREFS.pbrIntensity),
    uiScale: clampField(p.uiScale, 0.5, 2.0, DEFAULT_PREFS.uiScale),
  };
}

// ---------------------------------------------------------------------------
// Serialization (simple JSON-in-Uint8Array; tolerant on parse)
// ---------------------------------------------------------------------------

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/** Serialize a {@link Prefs} object into a UTF-8 JSON byte array. */
export function serializePrefs(p: Prefs): Uint8Array {
  const json = JSON.stringify(p);
  return TEXT_ENCODER.encode(json);
}

/**
 * Parse bytes previously produced by {@link serializePrefs}.
 * Tolerant: any parse failure or missing field falls back to
 * {@link DEFAULT_PREFS} values so a corrupt save never breaks the game.
 */
export function parsePrefs(bytes: Uint8Array): Prefs {
  if (bytes.byteLength === 0) return { ...DEFAULT_PREFS };
  let raw: unknown;
  try {
    raw = JSON.parse(TEXT_DECODER.decode(bytes));
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (raw === null || typeof raw !== "object") return { ...DEFAULT_PREFS };
  const obj = raw as Record<string, unknown>;
  function numOrDefault(key: string, def: number): number {
    const v = obj[key];
    return typeof v === "number" && Number.isFinite(v) ? v : def;
  }
  function boolOrDefault(key: string, def: boolean): boolean {
    const v = obj[key];
    return typeof v === "boolean" ? v : def;
  }
  const colorblindRaw = obj["colorblindMode"];
  const colorblindMode: ColorblindMode =
    colorblindRaw === "none" ||
    colorblindRaw === "protanopia" ||
    colorblindRaw === "deuteranopia" ||
    colorblindRaw === "tritanopia"
      ? (colorblindRaw as ColorblindMode)
      : DEFAULT_PREFS.colorblindMode;
  const toneRaw = obj["toneMappingMode"];
  const toneMappingMode: ToneMappingMode =
    toneRaw === "goldenHour" || toneRaw === "neutral"
      ? (toneRaw as ToneMappingMode)
      : DEFAULT_PREFS.toneMappingMode;
  return clampPrefs({
    renderDistance: numOrDefault("renderDistance", DEFAULT_PREFS.renderDistance),
    fov: numOrDefault("fov", DEFAULT_PREFS.fov),
    mouseSensitivity: numOrDefault("mouseSensitivity", DEFAULT_PREFS.mouseSensitivity),
    masterVolume: numOrDefault("masterVolume", DEFAULT_PREFS.masterVolume),
    sfxVolume: numOrDefault("sfxVolume", DEFAULT_PREFS.sfxVolume),
    ambientVolume: numOrDefault("ambientVolume", DEFAULT_PREFS.ambientVolume),
    bloomEnabled: boolOrDefault("bloomEnabled", DEFAULT_PREFS.bloomEnabled),
    ssaoEnabled: boolOrDefault("ssaoEnabled", DEFAULT_PREFS.ssaoEnabled),
    filmGrainEnabled: boolOrDefault("filmGrainEnabled", DEFAULT_PREFS.filmGrainEnabled),
    colorblindMode,
    toneMappingMode,
    pbrIntensity: numOrDefault("pbrIntensity", DEFAULT_PREFS.pbrIntensity),
    uiScale: numOrDefault("uiScale", DEFAULT_PREFS.uiScale),
  });
}

// ---------------------------------------------------------------------------
// Persistence helpers (async, Store-backed)
// ---------------------------------------------------------------------------

const PREFS_KEY = "prefs";

/**
 * Load preferences from the store. Falls back to {@link DEFAULT_PREFS} on
 * absence or parse failure — never throws.
 */
export async function loadPrefs(store: SaveStore): Promise<Prefs> {
  return loadOrDefault(store, PREFS_KEY, parsePrefs, () => ({ ...DEFAULT_PREFS }));
}

/**
 * Persist preferences via {@link atomicWrite}. Silent on error (preferences
 * loss is non-fatal; the game will reload defaults on next boot).
 */
export async function savePrefs(store: SaveStore, p: Prefs): Promise<void> {
  try {
    await atomicWrite(store, PREFS_KEY, serializePrefs(p));
  } catch {
    /* non-fatal — preferences might not persist but the game continues */
  }
}
