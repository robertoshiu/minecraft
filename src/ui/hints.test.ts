/**
 * hints.test.ts — unit tests for HintManager.
 *
 * Uses vi.useFakeTimers() to control setTimeout without real delays.
 * DOM is absent (Node/vitest), so all DOM-touching paths run the headless
 * branch of HintManager — just the queue / persistence logic is exercised.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HintManager } from "./hints";
import { MemoryStore } from "../save/store";
import { safeRead } from "../save/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEXT_DECODER = new TextDecoder();

/** Read the persisted shown-hints array from a MemoryStore. */
async function readShownHints(store: MemoryStore): Promise<string[]> {
  const bytes = await safeRead(store, "shown-hints");
  if (bytes === null || bytes.byteLength === 0) return [];
  const parsed: unknown = JSON.parse(TEXT_DECODER.decode(bytes));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is string => typeof x === "string");
}

/** Flush all pending microtasks (multiple rounds for chained async calls). */
async function flushMicrotasks(): Promise<void> {
  // atomicWrite makes 4 sequential awaits; a few extra rounds ensure they all
  // drain regardless of test environment scheduling.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** Advance fake timers and flush microtasks (for async persistence). */
async function tickMs(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await flushMicrotasks();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("HintManager", () => {
  let store: MemoryStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new MemoryStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Queue ordering
  // -------------------------------------------------------------------------

  describe("queue ordering", () => {
    it("processes hints in enqueue order", async () => {
      const mgr = new HintManager(store);
      await mgr.load();

      // Trigger two event-based hints immediately.
      mgr.onBlockBreak();   // "place"
      mgr.onInventoryOpen(); // "help"

      // Flush microtasks so the async persist from show() completes.
      await flushMicrotasks();

      // "place" should be marked shown first (it was enqueued first).
      const afterFirst = await readShownHints(store);
      expect(afterFirst).toContain("place");
      expect(afterFirst).not.toContain("help");

      // Advance past headless display duration (fade-in + visible + fade-out).
      await tickMs(300 + 5000 + 500);

      // "help" should now be shown.
      const afterSecond = await readShownHints(store);
      expect(afterSecond).toContain("help");

      mgr.dispose();
    });

    it("spawn-timed hints appear at the correct delays", async () => {
      const mgr = new HintManager(store);
      await mgr.load();
      mgr.onSpawn();

      // Before 2 s: nothing shown.
      await tickMs(1999);
      expect(await readShownHints(store)).toHaveLength(0);

      // At 2 s: "move" triggers.
      await tickMs(1);
      expect(await readShownHints(store)).toContain("move");

      // Advance past "move" display and to the "break" delay (8 s total).
      await tickMs(300 + 5000 + 500 + 200);
      expect(await readShownHints(store)).toContain("break");

      mgr.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // Show-once guarantee
  // -------------------------------------------------------------------------

  describe("show-once guarantee", () => {
    it("calling onBlockBreak twice does NOT re-queue 'place'", async () => {
      const mgr = new HintManager(store);
      await mgr.load();

      mgr.onBlockBreak();
      // Advance to let the first toast finish.
      await tickMs(300 + 5000 + 500 + 50);

      const shown1 = await readShownHints(store);
      expect(shown1.filter((x) => x === "place")).toHaveLength(1);

      // Call again — should be a no-op.
      mgr.onBlockBreak();
      await tickMs(300 + 5000 + 500 + 50);

      const shown2 = await readShownHints(store);
      // Still exactly one "place" entry.
      expect(shown2.filter((x) => x === "place")).toHaveLength(1);

      mgr.dispose();
    });

    it("hints already shown in a previous session are not re-shown", async () => {
      // Pre-populate store as if a previous session already showed "move".
      const priorMgr = new HintManager(store);
      await priorMgr.load();
      priorMgr.onSpawn();
      await tickMs(2001); // triggers "move"
      priorMgr.dispose();

      // New session, same store.
      vi.useRealTimers();
      vi.useFakeTimers();

      const mgr = new HintManager(store);
      await mgr.load();
      mgr.onSpawn();

      // Advance past 2 s — "move" should NOT be queued again.
      await tickMs(2001);

      const shown = await readShownHints(store);
      // "move" appears exactly once across both sessions.
      expect(shown.filter((x) => x === "move")).toHaveLength(1);

      mgr.dispose();
    });

    it("same hint is not double-queued if enqueued twice before display starts", async () => {
      const mgr = new HintManager(store);
      await mgr.load();

      // Call onBlockBreak twice in the same tick before the timer runs.
      mgr.onBlockBreak();
      mgr.onBlockBreak();

      // Only one "place" in the queue; advance through full display cycle.
      await tickMs(300 + 5000 + 500 + 50);

      const shown = await readShownHints(store);
      expect(shown.filter((x) => x === "place")).toHaveLength(1);

      mgr.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // dispose()
  // -------------------------------------------------------------------------

  describe("dispose", () => {
    it("cancels pending spawn timers so no hints fire after dispose", async () => {
      const mgr = new HintManager(store);
      await mgr.load();
      mgr.onSpawn();

      // Dispose before any timer fires.
      mgr.dispose();

      // Advance well past all spawn delays.
      await tickMs(30_000);

      // Nothing should have been persisted.
      expect(await readShownHints(store)).toHaveLength(0);
    });

    it("clears the queue on dispose", async () => {
      const mgr = new HintManager(store);
      await mgr.load();

      mgr.onBlockBreak();   // enqueues "place"
      mgr.onInventoryOpen(); // enqueues "help"

      mgr.dispose();

      // Let timers run — nothing should fire because dispose cleared them.
      await tickMs(10_000);

      // "place" was already being shown (it was the active hint when dispose
      // was called), so it will be in shown. But "help" should NOT appear
      // because the queue was cleared before it could be processed.
      const shown = await readShownHints(store);
      // "place" is shown (was active), "help" is not (was in queue, now cleared).
      expect(shown).not.toContain("help");
    });
  });

  // -------------------------------------------------------------------------
  // resetHints()
  // -------------------------------------------------------------------------

  describe("resetHints", () => {
    it("clears the shown-hints record so hints can fire again", async () => {
      const mgr = new HintManager(store);
      await mgr.load();

      // Show "place".
      mgr.onBlockBreak();
      await tickMs(300 + 5000 + 500 + 50);
      expect(await readShownHints(store)).toContain("place");

      // Reset, then trigger again.
      await mgr.resetHints();
      expect(await readShownHints(store)).toHaveLength(0);

      mgr.onBlockBreak();
      await tickMs(50);
      expect(await readShownHints(store)).toContain("place");

      mgr.dispose();
    });

    it("resetHints reflects in the in-memory shown set immediately", async () => {
      const mgr = new HintManager(store);
      await mgr.load();
      mgr.onBlockBreak();
      await tickMs(300 + 5000 + 500 + 50);

      await mgr.resetHints();

      // Immediately queue "place" again (no need to wait for next load).
      mgr.onBlockBreak();
      await tickMs(50);
      expect(await readShownHints(store)).toContain("place");

      mgr.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // load() guard
  // -------------------------------------------------------------------------

  describe("load() guard", () => {
    it("hints are silently dropped if load() has not been called", async () => {
      const mgr = new HintManager(store);
      // Do NOT call load().
      mgr.onBlockBreak();
      await tickMs(300 + 5000 + 500 + 50);
      expect(await readShownHints(store)).toHaveLength(0);
      mgr.dispose();
    });
  });

  // -------------------------------------------------------------------------
  // onNightfall()
  // -------------------------------------------------------------------------

  describe("onNightfall()", () => {
    it("enqueues the 'darkness' hint and shows it exactly once", async () => {
      const mgr = new HintManager(store);
      await mgr.load();

      mgr.onNightfall();
      await flushMicrotasks();

      // "darkness" should be marked shown immediately (show() persists before display).
      const shown = await readShownHints(store);
      expect(shown).toContain("darkness");

      mgr.dispose();
    });

    it("calling onNightfall() twice does NOT re-queue 'darkness'", async () => {
      const mgr = new HintManager(store);
      await mgr.load();

      mgr.onNightfall();
      // Advance through full display cycle.
      await tickMs(300 + 5000 + 500 + 50);

      const shown1 = await readShownHints(store);
      expect(shown1.filter((x) => x === "darkness")).toHaveLength(1);

      // Second call — should be a no-op.
      mgr.onNightfall();
      await tickMs(300 + 5000 + 500 + 50);

      const shown2 = await readShownHints(store);
      expect(shown2.filter((x) => x === "darkness")).toHaveLength(1);

      mgr.dispose();
    });

    it("'darkness' hint is not shown if already shown in a prior session", async () => {
      // Pre-populate: prior session shows "darkness".
      const priorMgr = new HintManager(store);
      await priorMgr.load();
      priorMgr.onNightfall();
      await tickMs(50);
      priorMgr.dispose();

      // New session, same store.
      vi.useRealTimers();
      vi.useFakeTimers();

      const mgr = new HintManager(store);
      await mgr.load();
      mgr.onNightfall();
      await tickMs(300 + 5000 + 500 + 50);

      const shown = await readShownHints(store);
      // Still exactly one occurrence.
      expect(shown.filter((x) => x === "darkness")).toHaveLength(1);

      mgr.dispose();
    });
  });
});
