/**
 * keybinds.ts — Key rebinding for all player actions.
 *
 * Pure logic + persistence layer. No DOM, no Babylon.
 * Bindings are persisted via a SaveStore (same pattern as preferences.ts).
 *
 * Default bindings match Minecraft 1.20 keyboard defaults.
 */

import { atomicWrite, safeRead, type SaveStore } from "../save/store";

// ---------------------------------------------------------------------------
// Action names
// ---------------------------------------------------------------------------

/** All rebindable player actions. */
export type ActionName =
  | "moveForward"
  | "moveBack"
  | "moveLeft"
  | "moveRight"
  | "jump"
  | "sprint"
  | "openInventory"
  | "help"
  | "save"
  | "pause"
  | "hotbar1"
  | "hotbar2"
  | "hotbar3"
  | "hotbar4"
  | "hotbar5"
  | "hotbar6"
  | "hotbar7"
  | "hotbar8"
  | "hotbar9"
  | "attack"
  | "placeBlock";

/** Mapping from action name to KeyboardEvent.code string. */
export type Keybinds = Record<ActionName, string>;

// ---------------------------------------------------------------------------
// Defaults (Minecraft 1.20 reference bindings)
// ---------------------------------------------------------------------------

/** Default Minecraft key bindings using KeyboardEvent.code values. */
export const DEFAULT_KEYBINDS: Keybinds = {
  moveForward: "KeyW",
  moveBack: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  jump: "Space",
  sprint: "ShiftLeft",
  openInventory: "KeyE",
  help: "KeyH",
  save: "F5",
  pause: "Escape",
  hotbar1: "Digit1",
  hotbar2: "Digit2",
  hotbar3: "Digit3",
  hotbar4: "Digit4",
  hotbar5: "Digit5",
  hotbar6: "Digit6",
  hotbar7: "Digit7",
  hotbar8: "Digit8",
  hotbar9: "Digit9",
  // Mouse buttons are represented as synthetic codes for event matching.
  attack: "MouseLeft",
  placeBlock: "MouseRight",
};

// ---------------------------------------------------------------------------
// Serialization (JSON-in-Uint8Array; tolerant on parse)
// ---------------------------------------------------------------------------

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/** Serialize keybinds to a UTF-8 JSON byte array. */
export function serializeKeybinds(k: Keybinds): Uint8Array {
  return TEXT_ENCODER.encode(JSON.stringify(k));
}

/**
 * Parse bytes previously produced by {@link serializeKeybinds}.
 * Tolerant: any parse failure or missing action falls back to
 * {@link DEFAULT_KEYBINDS} for that action.
 */
export function parseKeybinds(bytes: Uint8Array): Keybinds {
  if (bytes.byteLength === 0) return { ...DEFAULT_KEYBINDS };
  let raw: unknown;
  try {
    raw = JSON.parse(TEXT_DECODER.decode(bytes));
  } catch {
    return { ...DEFAULT_KEYBINDS };
  }
  if (raw === null || typeof raw !== "object") return { ...DEFAULT_KEYBINDS };
  const obj = raw as Record<string, unknown>;

  const result: Keybinds = { ...DEFAULT_KEYBINDS };
  const actions = Object.keys(DEFAULT_KEYBINDS) as ActionName[];
  for (const action of actions) {
    const v = obj[action];
    if (typeof v === "string" && v.length > 0) {
      result[action] = v;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const KEYBINDS_KEY = "keybinds";

/**
 * Load keybinds from the store. Falls back to {@link DEFAULT_KEYBINDS}
 * on absence or parse failure — never throws.
 */
export async function loadKeybinds(store: SaveStore): Promise<Keybinds> {
  try {
    const bytes = await safeRead(store, KEYBINDS_KEY);
    if (bytes === null || bytes.byteLength === 0) return { ...DEFAULT_KEYBINDS };
    return parseKeybinds(bytes);
  } catch {
    return { ...DEFAULT_KEYBINDS };
  }
}

/**
 * Persist keybinds via {@link atomicWrite}. Silent on error (keybind loss is
 * non-fatal; the game will reload defaults on next boot).
 */
export async function saveKeybinds(store: SaveStore, k: Keybinds): Promise<void> {
  try {
    await atomicWrite(store, KEYBINDS_KEY, serializeKeybinds(k));
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// Runtime API (in-memory state for the current session)
// ---------------------------------------------------------------------------

/** Module-level mutable bindings for the current session. */
let _current: Keybinds = { ...DEFAULT_KEYBINDS };
/** Module-level store reference (set after init). */
let _store: SaveStore | null = null;

/**
 * Initialize the keybind system with a store. Must be called once at startup
 * before {@link getKeybinds} / {@link setKeybind}.
 */
export async function initKeybinds(store: SaveStore): Promise<void> {
  _store = store;
  _current = await loadKeybinds(store);
}

/**
 * Return the current keybinds. Returns {@link DEFAULT_KEYBINDS} if
 * {@link initKeybinds} has not been called yet.
 */
export function getKeybinds(): Keybinds {
  return { ..._current };
}

/**
 * Update a single action's key binding and persist the change.
 * The `keyCode` should be a valid `KeyboardEvent.code` value (or synthetic
 * "MouseLeft" / "MouseRight" for mouse buttons).
 */
export async function setKeybind(action: ActionName, keyCode: string): Promise<void> {
  _current = { ..._current, [action]: keyCode };
  if (_store !== null) {
    await saveKeybinds(_store, _current);
  }
}

/**
 * Restore all bindings to {@link DEFAULT_KEYBINDS} and persist.
 */
export async function resetKeybinds(): Promise<void> {
  _current = { ...DEFAULT_KEYBINDS };
  if (_store !== null) {
    await saveKeybinds(_store, _current);
  }
}

/**
 * Check whether a {@link KeyboardEvent} matches the binding for a given action.
 * Mouse-button actions ("MouseLeft" / "MouseRight") never match keyboard events
 * and always return false here.
 */
export function isActionKey(action: ActionName, event: KeyboardEvent): boolean {
  const bound = _current[action];
  // Synthetic mouse codes are never produced by keyboard events.
  if (bound === "MouseLeft" || bound === "MouseRight") return false;
  return event.code === bound;
}
