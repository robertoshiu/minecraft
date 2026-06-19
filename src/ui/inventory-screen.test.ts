/**
 * inventory-screen.test.ts — unit tests for InventoryScreen DOM interaction.
 *
 * Runs in vitest environment:"node" (no jsdom). Provides a minimal self-contained
 * DOM stub so InventoryScreen.hasDom() is true and build() runs.
 *
 * Private fields are accessed via (screen as any) — acceptable in tests per spec.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Inventory } from "../inventory/inventory";
import { Hotbar } from "../inventory/inventory";
import { makeStack } from "../inventory/stack";
import { Blocks } from "../rules/mc-1.20";

// ---------------------------------------------------------------------------
// Minimal DOM stub
// ---------------------------------------------------------------------------

/**
 * A fake HTMLElement that records event listeners and supports style, classList,
 * setAttribute, appendChild, and textContent.
 */
function makeFakeElement(tag = "div"): FakeElement {
  const listeners: Record<string, Array<(e: FakeEvent) => void>> = {};
  const children: FakeElement[] = [];
  const style: Record<string, string> = {};
  const attrs: Record<string, string> = {};
  const classList = {
    _classes: new Set<string>(),
    add(c: string) { this._classes.add(c); },
    remove(c: string) { this._classes.delete(c); },
    contains(c: string) { return this._classes.has(c); },
  };

  const el: FakeElement = {
    tagName: tag.toUpperCase(),
    id: "",
    style: style as unknown as CSSStyleDeclaration,
    classList: classList as unknown as DOMTokenList,
    children,
    listeners,
    textContent: "",
    title: "",
    innerHTML: "",
    addEventListener(type: string, fn: (e: FakeEvent) => void) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type]!.push(fn);
    },
    removeEventListener() { /* no-op for stub */ },
    appendChild(child: FakeElement) {
      children.push(child);
      return child;
    },
    setAttribute(name: string, value: string) {
      attrs[name] = value;
      if (name === "id") el.id = value;
    },
    getAttribute(name: string) { return attrs[name] ?? null; },
    dispatchEvent(evt: FakeEvent) {
      const fns = listeners[evt.type] ?? [];
      for (const fn of fns) fn(evt);
    },
  };
  return el;
}

interface FakeEvent {
  type: string;
  button?: number;
  shiftKey?: boolean;
  clientX?: number;
  clientY?: number;
  target?: FakeElement | null;
  key?: string;
  preventDefault(): void;
  stopPropagation(): void;
}

interface FakeElement {
  tagName: string;
  id: string;
  style: CSSStyleDeclaration;
  classList: DOMTokenList;
  children: FakeElement[];
  listeners: Record<string, Array<(e: FakeEvent) => void>>;
  textContent: string;
  title: string;
  innerHTML: string;
  addEventListener(type: string, fn: (e: FakeEvent) => void): void;
  removeEventListener(type: string, fn: (e: FakeEvent) => void): void;
  appendChild(child: FakeElement): FakeElement;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  dispatchEvent(evt: FakeEvent): void;
}

/** Saved real global state so we can restore after each test. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let savedDocument: any;

/** Create and install a fresh document stub; returns the root body element. */
function installDocumentStub(): FakeElement {
  savedDocument = (globalThis as Record<string, unknown>)["document"];

  const body = makeFakeElement("body");
  const docListeners: Record<string, Array<(e: FakeEvent) => void>> = {};

  const docStub = {
    body,
    getElementById(_id: string): FakeElement | null { return null; },
    createElement(_tag: string): FakeElement { return makeFakeElement(_tag); },
    addEventListener(type: string, fn: (e: FakeEvent) => void) {
      if (!docListeners[type]) docListeners[type] = [];
      docListeners[type]!.push(fn);
    },
    removeEventListener() { /* no-op */ },
    _listeners: docListeners,
  };

  (globalThis as Record<string, unknown>)["document"] = docStub;
  return body;
}

function uninstallDocumentStub(): void {
  if (savedDocument === undefined) {
    delete (globalThis as Record<string, unknown>)["document"];
  } else {
    (globalThis as Record<string, unknown>)["document"] = savedDocument;
  }
}

afterEach(() => {
  uninstallDocumentStub();
});

// ---------------------------------------------------------------------------
// Helper: build a screen with the stub installed
// ---------------------------------------------------------------------------

async function makeScreen(): Promise<{
  screen: import("./inventory-screen").InventoryScreen;
  inv: Inventory;
  hotbar: Hotbar;
}> {
  // Import fresh each time by resetting module cache... vitest doesn't easily
  // support that without unstable_resetModules, so we create a new instance.
  const { InventoryScreen } = await import("./inventory-screen");
  const inv = new Inventory();
  const hotbar = new Hotbar();
  const screen = new InventoryScreen();
  inv.set(0, makeStack(Blocks.STONE, 10));
  screen.open();
  screen.render(inv, hotbar);
  return { screen, inv, hotbar };
}

/** Fire a slot event by index into the screen. */
function fireSlotMouseDown(
  screen: import("./inventory-screen").InventoryScreen,
  slotIndex: number,
  x = 100,
  y = 100,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = screen as any;
  s.onInventorySlotMouseDown(slotIndex, x, y);
}

function fireSlotMouseUp(
  screen: import("./inventory-screen").InventoryScreen,
  slotIndex: number,
  shiftKey = false,
  x = 100,
  y = 100,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = screen as any;
  s.onInventorySlotMouseUp(slotIndex, shiftKey, x, y);
}

function fireRootMouseUp(
  screen: import("./inventory-screen").InventoryScreen,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = screen as any;
  // Simulate the root backdrop mouseup handler directly.
  if (s.dragState !== null) {
    s.cancelActiveDrag();
    s.rerender();
  }
}

function fireRightClick(
  screen: import("./inventory-screen").InventoryScreen,
  slotIndex: number,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = screen as any;
  s.onInventorySlotRightClick(slotIndex);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InventoryScreen (with DOM stub)", () => {
  it("(1) stationary click on a slot with an item -> item ends on cursor, slot empty", async () => {
    installDocumentStub();
    const { screen, inv } = await makeScreen();

    // Slot 0 has STONE(10).
    expect(inv.get(0)?.itemId).toBe(Blocks.STONE);

    // mousedown + mouseup at same coords (distance 0 <= DRAG_TOLERANCE_PX=5).
    fireSlotMouseDown(screen, 0, 100, 100);
    fireSlotMouseUp(screen, 0, false, 100, 100);

    // After stationary click: cursor holds the stack, slot is empty.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = screen as any;
    expect(s.cursor).not.toBeNull();
    expect(s.cursor.itemId).toBe(Blocks.STONE);
    expect(s.cursor.count).toBe(10);
    expect(inv.get(0)).toBeNull();
  });

  it("(2) same slot, released 3px away -> still counts as pickup (within tolerance)", async () => {
    installDocumentStub();
    const { screen, inv } = await makeScreen();

    fireSlotMouseDown(screen, 0, 100, 100);
    fireSlotMouseUp(screen, 0, false, 103, 100); // distance = 3 <= 5

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = screen as any;
    expect(s.cursor).not.toBeNull();
    expect(s.cursor.itemId).toBe(Blocks.STONE);
    expect(inv.get(0)).toBeNull();
  });

  it("(3) same slot, released 10px away -> cancel, item stays in slot", async () => {
    installDocumentStub();
    const { screen, inv } = await makeScreen();

    fireSlotMouseDown(screen, 0, 100, 100);
    fireSlotMouseUp(screen, 0, false, 110, 100); // distance = 10 > 5

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = screen as any;
    // Drag cancelled: cursor is empty, item restored to slot 0.
    expect(s.cursor).toBeNull();
    expect(s.dragState).toBeNull();
    expect(inv.get(0)).not.toBeNull();
    expect(inv.get(0)?.itemId).toBe(Blocks.STONE);
  });

  it("(4) mousedown slot A, mouseup slot B -> items move", async () => {
    installDocumentStub();
    const { screen, inv } = await makeScreen();

    // Slot 0 has STONE(10), slot 1 is empty.
    fireSlotMouseDown(screen, 0, 100, 100);
    fireSlotMouseUp(screen, 1, false, 200, 200); // different slot

    // Slot 0 should now be empty, slot 1 should have STONE(10).
    expect(inv.get(0)).toBeNull();
    expect(inv.get(1)?.itemId).toBe(Blocks.STONE);
    expect(inv.get(1)?.count).toBe(10);
  });

  it("(5) mousedown slot A, mouseup on root backdrop -> drag cancelled, item back in A", async () => {
    installDocumentStub();
    const { screen, inv } = await makeScreen();

    fireSlotMouseDown(screen, 0, 100, 100);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = screen as any;
    // Drag is active.
    expect(s.dragState).not.toBeNull();

    // Simulate backdrop mouseup (root handler).
    fireRootMouseUp(screen);

    expect(s.dragState).toBeNull();
    expect(inv.get(0)?.itemId).toBe(Blocks.STONE);
    expect(inv.get(0)?.count).toBe(10);
  });

  it("(6) right-click on a slot while a drag is active -> suppressed (no inventory change)", async () => {
    installDocumentStub();
    const { screen, inv } = await makeScreen();

    fireSlotMouseDown(screen, 0, 100, 100);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = screen as any;
    expect(s.dragState).not.toBeNull();

    // Right-click on slot 1 (empty) should be suppressed.
    fireRightClick(screen, 1);

    // Slot 1 should remain empty (right-click suppressed).
    expect(inv.get(1)).toBeNull();
    // Drag still active.
    expect(s.dragState).not.toBeNull();
  });

  it("(7) the aria-live region textContent updates on pickup", async () => {
    installDocumentStub();
    const { screen, inv } = await makeScreen();

    expect(inv.get(0)?.itemId).toBe(Blocks.STONE);

    // Stationary click: pickup.
    fireSlotMouseDown(screen, 0, 100, 100);
    fireSlotMouseUp(screen, 0, false, 100, 100);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = screen as any;
    // ariaLive.textContent should contain "Picked up".
    expect(s.ariaLive).not.toBeNull();
    expect(s.ariaLive.textContent).toMatch(/Picked up/i);
  });
});
