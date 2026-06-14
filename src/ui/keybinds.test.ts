/**
 * keybinds.test.ts — Unit tests for the keybind system.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_KEYBINDS,
  getKeybinds,
  setKeybind,
  resetKeybinds,
  isActionKey,
  initKeybinds,
  parseKeybinds,
  serializeKeybinds,
  type ActionName,
  type Keybinds,
} from "./keybinds";
import { MemoryStore } from "../save/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All expected action names. */
const ALL_ACTIONS: ActionName[] = [
  "moveForward",
  "moveBack",
  "moveLeft",
  "moveRight",
  "jump",
  "sprint",
  "openInventory",
  "help",
  "save",
  "pause",
  "hotbar1",
  "hotbar2",
  "hotbar3",
  "hotbar4",
  "hotbar5",
  "hotbar6",
  "hotbar7",
  "hotbar8",
  "hotbar9",
  "attack",
  "placeBlock",
];

/** Create a minimal fake KeyboardEvent with the given code. */
function fakeKeyEvent(code: string): KeyboardEvent {
  return { code } as KeyboardEvent;
}

// ---------------------------------------------------------------------------
// Reset module state between tests via initKeybinds
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Reset to a clean in-memory store each test.
  await initKeybinds(new MemoryStore());
});

// ---------------------------------------------------------------------------
// Default bindings completeness
// ---------------------------------------------------------------------------

describe("DEFAULT_KEYBINDS", () => {
  it("has a non-empty key for every action", () => {
    for (const action of ALL_ACTIONS) {
      const key = DEFAULT_KEYBINDS[action];
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("covers exactly the expected set of actions", () => {
    const definedActions = Object.keys(DEFAULT_KEYBINDS).sort();
    const expectedActions = [...ALL_ACTIONS].sort();
    expect(definedActions).toEqual(expectedActions);
  });
});

// ---------------------------------------------------------------------------
// getKeybinds — returns copy of current bindings
// ---------------------------------------------------------------------------

describe("getKeybinds", () => {
  it("returns default bindings after init with empty store", () => {
    const binds = getKeybinds();
    expect(binds).toEqual(DEFAULT_KEYBINDS);
  });

  it("returns a copy — mutations do not affect internal state", () => {
    const binds = getKeybinds();
    (binds as Keybinds).moveForward = "KeyZ";
    expect(getKeybinds().moveForward).toBe(DEFAULT_KEYBINDS.moveForward);
  });
});

// ---------------------------------------------------------------------------
// setKeybind — persists and getKeybinds reflects change
// ---------------------------------------------------------------------------

describe("setKeybind", () => {
  it("updates the binding and getKeybinds reflects the change", async () => {
    await setKeybind("moveForward", "KeyT");
    expect(getKeybinds().moveForward).toBe("KeyT");
  });

  it("persists to the store — reloading reflects the saved binding", async () => {
    const store = new MemoryStore();
    await initKeybinds(store);
    await setKeybind("jump", "KeyJ");

    // Reinitialise from the same store — should load the saved binding.
    await initKeybinds(store);
    expect(getKeybinds().jump).toBe("KeyJ");
  });

  it("updating one action does not affect others", async () => {
    await setKeybind("moveBack", "KeyX");
    const binds = getKeybinds();
    expect(binds.moveBack).toBe("KeyX");
    expect(binds.moveForward).toBe(DEFAULT_KEYBINDS.moveForward);
    expect(binds.jump).toBe(DEFAULT_KEYBINDS.jump);
  });
});

// ---------------------------------------------------------------------------
// resetKeybinds — restores defaults
// ---------------------------------------------------------------------------

describe("resetKeybinds", () => {
  it("restores all bindings to defaults after changes", async () => {
    await setKeybind("moveForward", "KeyT");
    await setKeybind("jump", "KeyJ");
    await resetKeybinds();
    expect(getKeybinds()).toEqual(DEFAULT_KEYBINDS);
  });

  it("persists the reset — reloading also sees defaults", async () => {
    const store = new MemoryStore();
    await initKeybinds(store);
    await setKeybind("sprint", "KeyC");
    await resetKeybinds();

    await initKeybinds(store);
    expect(getKeybinds().sprint).toBe(DEFAULT_KEYBINDS.sprint);
  });
});

// ---------------------------------------------------------------------------
// isActionKey — matching logic
// ---------------------------------------------------------------------------

describe("isActionKey", () => {
  it("returns true when event.code matches the binding", () => {
    // moveForward defaults to KeyW
    expect(isActionKey("moveForward", fakeKeyEvent("KeyW"))).toBe(true);
  });

  it("returns false when event.code does not match", () => {
    expect(isActionKey("moveForward", fakeKeyEvent("KeyS"))).toBe(false);
  });

  it("reflects a custom binding", async () => {
    await setKeybind("moveLeft", "ArrowLeft");
    expect(isActionKey("moveLeft", fakeKeyEvent("ArrowLeft"))).toBe(true);
    expect(isActionKey("moveLeft", fakeKeyEvent("KeyA"))).toBe(false);
  });

  it("returns false for mouse-bound actions (attack / placeBlock)", () => {
    // attack defaults to MouseLeft — keyboard events never match.
    expect(isActionKey("attack", fakeKeyEvent("MouseLeft"))).toBe(false);
    expect(isActionKey("placeBlock", fakeKeyEvent("MouseRight"))).toBe(false);
    // Even if we try to fake a matching code string:
    expect(isActionKey("attack", { code: "MouseLeft" } as KeyboardEvent)).toBe(false);
  });

  it("returns false for an action bound to a mouse code even with odd input", async () => {
    // Re-bind a non-mouse action to a mouse synthetic code.
    await setKeybind("openInventory", "MouseLeft");
    expect(isActionKey("openInventory", fakeKeyEvent("MouseLeft"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Serialization round-trip
// ---------------------------------------------------------------------------

describe("serializeKeybinds / parseKeybinds", () => {
  it("round-trips default bindings", () => {
    const bytes = serializeKeybinds(DEFAULT_KEYBINDS);
    const parsed = parseKeybinds(bytes);
    expect(parsed).toEqual(DEFAULT_KEYBINDS);
  });

  it("round-trips custom bindings", () => {
    const custom: Keybinds = { ...DEFAULT_KEYBINDS, moveForward: "ArrowUp", jump: "KeyJ" };
    const parsed = parseKeybinds(serializeKeybinds(custom));
    expect(parsed.moveForward).toBe("ArrowUp");
    expect(parsed.jump).toBe("KeyJ");
  });

  it("falls back to defaults on empty bytes", () => {
    expect(parseKeybinds(new Uint8Array(0))).toEqual(DEFAULT_KEYBINDS);
  });

  it("falls back to defaults on corrupt bytes", () => {
    const bad = new TextEncoder().encode("not json {{{{");
    expect(parseKeybinds(bad)).toEqual(DEFAULT_KEYBINDS);
  });

  it("fills missing actions with defaults when only partial data saved", () => {
    const partial = new TextEncoder().encode(JSON.stringify({ moveForward: "KeyT" }));
    const parsed = parseKeybinds(partial);
    expect(parsed.moveForward).toBe("KeyT");
    expect(parsed.jump).toBe(DEFAULT_KEYBINDS.jump);
  });
});
