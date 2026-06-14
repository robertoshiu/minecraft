/**
 * hints.ts — First-day hint toasts for new players.
 *
 * Shows contextual hints as transient toasts (centered bottom, above hotbar).
 * Each hint fires ONCE per world save. Shown hint IDs are persisted in the
 * SaveStore so hints survive page reloads but don't repeat.
 *
 * Animation is pure CSS: fade-in 300ms / visible 5s / fade-out 500ms.
 * Timers are managed via setTimeout so vi.useFakeTimers() controls them in
 * tests.
 *
 * Usage:
 *   const hints = new HintManager(store);
 *   await hints.load();
 *   hints.onSpawn();                // arms spawn-timed hints (2s, 8s, 20s)
 *   hints.onBlockBreak();           // triggers "place" hint
 *   hints.onInventoryOpen();        // triggers "help" hint
 *   hints.dispose();                // clears timers + removes DOM
 */

import { atomicWrite, safeRead, type SaveStore } from "../save/store";

// ---------------------------------------------------------------------------
// Hint definitions
// ---------------------------------------------------------------------------

/** A single hint entry. */
export interface HintDef {
  readonly id: string;
  readonly message: string;
}

/** All known hints, in rough first-day order. */
export const HINTS: readonly HintDef[] = [
  { id: "move",      message: "WASD to move · Space to jump" },
  { id: "break",     message: "Left-click to break blocks" },
  { id: "place",     message: "Right-click to place blocks" },
  { id: "inventory", message: "Press E to open inventory" },
  { id: "help",      message: "Press H for full controls" },
];

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const HINTS_KEY = "shown-hints";
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/** Load the set of already-shown hint IDs from the store. */
async function loadShownHints(store: SaveStore): Promise<Set<string>> {
  try {
    const bytes = await safeRead(store, HINTS_KEY);
    if (bytes === null || bytes.byteLength === 0) return new Set();
    const parsed: unknown = JSON.parse(TEXT_DECODER.decode(bytes));
    if (!Array.isArray(parsed)) return new Set();
    const ids: string[] = [];
    for (const item of parsed) {
      if (typeof item === "string") ids.push(item);
    }
    return new Set(ids);
  } catch {
    return new Set();
  }
}

/** Persist the set of shown hint IDs to the store. Silent on error. */
async function saveShownHints(store: SaveStore, shown: Set<string>): Promise<void> {
  try {
    const json = JSON.stringify([...shown]);
    await atomicWrite(store, HINTS_KEY, TEXT_ENCODER.encode(json));
  } catch {
    /* non-fatal */
  }
}

// ---------------------------------------------------------------------------
// DOM guard
// ---------------------------------------------------------------------------

function hasDom(): boolean {
  return typeof document !== "undefined";
}

// ---------------------------------------------------------------------------
// Toast duration constants (ms)
// ---------------------------------------------------------------------------

/** Fade-in duration must match the CSS transition. */
const FADE_IN_MS = 300;
/** How long the toast remains fully visible. */
const VISIBLE_MS = 5000;
/** Fade-out duration must match the CSS transition. */
const FADE_OUT_MS = 500;

// Spawn-relative delays for timed hints.
const DELAY_MOVE_MS      = 2_000;
const DELAY_BREAK_MS     = 8_000;
const DELAY_INVENTORY_MS = 20_000;

// ---------------------------------------------------------------------------
// HintManager
// ---------------------------------------------------------------------------

/**
 * Manages first-day hint toasts. Construct, then call {@link load} before
 * triggering any hints so persistence is ready.
 */
export class HintManager {
  private readonly store: SaveStore;
  private shown: Set<string> = new Set();
  private loaded = false;

  /** FIFO queue of hint IDs waiting to display. */
  private queue: string[] = [];
  /** Whether a toast is currently animating / visible. */
  private busy = false;

  /** Root container injected into the HUD. */
  private container: HTMLElement | null = null;
  /** The currently displayed toast element. */
  private currentToast: HTMLElement | null = null;

  /** All pending timer handles so dispose() can cancel them. */
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(store: SaveStore) {
    this.store = store;
    if (hasDom()) this.buildContainer();
  }

  // -------------------------------------------------------------------------
  // Public lifecycle
  // -------------------------------------------------------------------------

  /**
   * Load the set of previously-shown hints from the store.
   * Must be called (and awaited) before triggering hints.
   */
  async load(): Promise<void> {
    this.shown = await loadShownHints(this.store);
    this.loaded = true;
  }

  /**
   * Call when the player spawns. Arms timed hints:
   *  - "move"      after 2 s
   *  - "break"     after 8 s
   *  - "inventory" after 20 s
   */
  onSpawn(): void {
    this.schedule("move",      DELAY_MOVE_MS);
    this.schedule("break",     DELAY_BREAK_MS);
    this.schedule("inventory", DELAY_INVENTORY_MS);
  }

  /**
   * Call when the player breaks their first block.
   * Queues the "place" hint immediately.
   */
  onBlockBreak(): void {
    this.enqueue("place");
  }

  /**
   * Call when the player first opens the inventory.
   * Queues the "help" hint immediately.
   */
  onInventoryOpen(): void {
    this.enqueue("help");
  }

  /**
   * Clear the shown-hints record in the store (useful for testing / debug).
   * Does NOT affect currently visible toasts.
   */
  async resetHints(): Promise<void> {
    this.shown = new Set();
    await saveShownHints(this.store, this.shown);
  }

  /**
   * Remove all DOM elements, cancel all pending timers, and clear the queue.
   * After dispose() the instance should not be used further.
   */
  dispose(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.queue = [];
    this.busy = false;
    if (this.currentToast !== null) {
      this.currentToast.remove();
      this.currentToast = null;
    }
    if (this.container !== null) {
      this.container.remove();
      this.container = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal: scheduling + queue
  // -------------------------------------------------------------------------

  /** Schedule a hint to enqueue after `delayMs`. */
  private schedule(id: string, delayMs: number): void {
    const t = setTimeout(() => { this.enqueue(id); }, delayMs);
    this.timers.push(t);
  }

  /**
   * Add a hint to the display queue, skipping it if:
   *  - persistence has not loaded yet (guard), or
   *  - the hint has already been shown.
   */
  private enqueue(id: string): void {
    if (!this.loaded) return;
    if (this.shown.has(id)) return;
    // Avoid double-queuing the same hint.
    if (this.queue.includes(id)) return;
    this.queue.push(id);
    this.drain();
  }

  /** If not busy, pop and display the next queued hint. */
  private drain(): void {
    if (this.busy) return;
    const id = this.queue.shift();
    if (id === undefined) return;
    // Find the matching definition.
    const def = HINTS.find((h) => h.id === id);
    if (def === undefined) return;
    this.show(def);
  }

  // -------------------------------------------------------------------------
  // Internal: DOM toast lifecycle
  // -------------------------------------------------------------------------

  private buildContainer(): void {
    const host = document.getElementById("hud") ?? document.body;
    const el = document.createElement("div");
    el.className = "hint-container";
    host.appendChild(el);
    this.container = el;
  }

  private show(def: HintDef): void {
    this.busy = true;

    // Mark shown + persist immediately (before showing) so a page-reload after
    // the toast appears doesn't re-show it.
    this.shown.add(def.id);
    void saveShownHints(this.store, this.shown);

    if (!hasDom() || this.container === null) {
      // Headless: skip DOM work but still drive the queue after visible period.
      const t = setTimeout(() => {
        this.busy = false;
        this.drain();
      }, FADE_IN_MS + VISIBLE_MS + FADE_OUT_MS);
      this.timers.push(t);
      return;
    }

    const toast = document.createElement("div");
    toast.className = "hint-toast";
    toast.textContent = def.message;
    this.container.appendChild(toast);
    this.currentToast = toast;

    // Trigger the CSS fade-in on next frame (allows transition to run).
    const t1 = setTimeout(() => {
      toast.classList.add("visible");
    }, 0);
    this.timers.push(t1);

    // After fade-in + visible period, begin fade-out.
    const t2 = setTimeout(() => {
      toast.classList.remove("visible");
      toast.classList.add("fade-out");
    }, FADE_IN_MS + VISIBLE_MS);
    this.timers.push(t2);

    // After fade-out, remove element and drain queue.
    const t3 = setTimeout(() => {
      toast.remove();
      if (this.currentToast === toast) this.currentToast = null;
      this.busy = false;
      this.drain();
    }, FADE_IN_MS + VISIBLE_MS + FADE_OUT_MS);
    this.timers.push(t3);
  }
}
