import { describe, it, expect } from "vitest";
import { Inventory, Hotbar } from "./inventory";
import { makeStack, makeToolStack } from "./stack";

describe("Inventory basics", () => {
  it("has 36 slots, all empty initially", () => {
    const inv = new Inventory();
    expect(Inventory.SLOTS).toBe(36);
    for (let i = 0; i < Inventory.SLOTS; i++) {
      expect(inv.get(i)).toBeNull();
    }
  });

  it("set/get round-trips a stack", () => {
    const inv = new Inventory();
    const s = makeStack(1, 10);
    inv.set(5, s);
    expect(inv.get(5)).toBe(s);
    inv.set(5, null);
    expect(inv.get(5)).toBeNull();
  });

  it("get returns null for out-of-range slots", () => {
    const inv = new Inventory();
    expect(inv.get(-1)).toBeNull();
    expect(inv.get(36)).toBeNull();
    expect(inv.get(999)).toBeNull();
  });
});

describe("Inventory.add", () => {
  it("splits 100 of a maxStack-64 item across two slots, no leftover", () => {
    const inv = new Inventory();
    const leftover = inv.add(makeStack(1, 100));
    expect(leftover).toBe(0);
    expect(inv.get(0)?.count).toBe(64);
    expect(inv.get(1)?.count).toBe(36);
    expect(inv.get(2)).toBeNull();
  });

  it("tops up an existing partial stack before opening a new slot", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(1, 60));
    const leftover = inv.add(makeStack(1, 10));
    expect(leftover).toBe(0);
    expect(inv.get(0)?.count).toBe(64); // topped up to full first
    expect(inv.get(1)?.count).toBe(6); // remainder in next free slot
  });

  it("returns the leftover when the inventory is full", () => {
    const inv = new Inventory();
    // Fill every slot with a full stack of itemId 1.
    for (let i = 0; i < Inventory.SLOTS; i++) {
      inv.set(i, makeStack(1, 64));
    }
    const leftover = inv.add(makeStack(1, 20));
    expect(leftover).toBe(20);
  });

  it("partially merges into a single partial slot when full otherwise", () => {
    const inv = new Inventory();
    for (let i = 1; i < Inventory.SLOTS; i++) {
      inv.set(i, makeStack(2, 64)); // unrelated, full
    }
    inv.set(0, makeStack(1, 60)); // room for 4 more
    const leftover = inv.add(makeStack(1, 20));
    expect(inv.get(0)?.count).toBe(64);
    expect(leftover).toBe(16);
  });

  it("does not merge tools, only fills free slots", () => {
    const inv = new Inventory();
    const leftover = inv.add(makeToolStack(7, "iron"));
    expect(leftover).toBe(0);
    expect(inv.get(0)?.itemId).toBe(7);
    expect(inv.get(0)?.maxStack).toBe(1);
  });
});

describe("Inventory.removeFromSlot", () => {
  it("removes up to count and reports the amount removed", () => {
    const inv = new Inventory();
    inv.set(3, makeStack(1, 10));
    expect(inv.removeFromSlot(3, 4)).toBe(4);
    expect(inv.get(3)?.count).toBe(6);
  });

  it("clamps to available and clears the slot at 0", () => {
    const inv = new Inventory();
    inv.set(3, makeStack(1, 5));
    expect(inv.removeFromSlot(3, 99)).toBe(5);
    expect(inv.get(3)).toBeNull();
  });

  it("removes nothing from an empty slot", () => {
    const inv = new Inventory();
    expect(inv.removeFromSlot(0, 5)).toBe(0);
  });
});

describe("Inventory.count / swap / findFreeSlot", () => {
  it("count sums an itemId across all slots", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(1, 10));
    inv.set(2, makeStack(1, 5));
    inv.set(4, makeStack(2, 7));
    expect(inv.count(1)).toBe(15);
    expect(inv.count(2)).toBe(7);
    expect(inv.count(99)).toBe(0);
  });

  it("swap exchanges two slots", () => {
    const inv = new Inventory();
    const a = makeStack(1, 1);
    const b = makeStack(2, 2);
    inv.set(0, a);
    inv.set(1, b);
    inv.swap(0, 1);
    expect(inv.get(0)).toBe(b);
    expect(inv.get(1)).toBe(a);
  });

  it("findFreeSlot returns the first empty slot, null when full", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(1, 1));
    expect(inv.findFreeSlot()).toBe(1);
    for (let i = 0; i < Inventory.SLOTS; i++) {
      inv.set(i, makeStack(1, 1));
    }
    expect(inv.findFreeSlot()).toBeNull();
  });
});

describe("Hotbar", () => {
  it("selects within 0..8", () => {
    const h = new Hotbar();
    expect(h.selected).toBe(0);
    h.select(5);
    expect(h.selected).toBe(5);
  });

  it("cycle wraps forward 8 -> 0", () => {
    const h = new Hotbar();
    h.select(8);
    h.cycle(1);
    expect(h.selected).toBe(0);
  });

  it("cycle wraps backward 0 -> 8", () => {
    const h = new Hotbar();
    h.select(0);
    h.cycle(-1);
    expect(h.selected).toBe(8);
  });

  it("cycle handles deltas larger than 9", () => {
    const h = new Hotbar();
    h.select(0);
    h.cycle(10); // +10 from 0 -> 1
    expect(h.selected).toBe(1);
    h.cycle(-20); // -20 from 1 -> ... wraps
    expect(h.selected).toBe(8);
  });

  it("selectedStack returns the stack at the selected hotbar slot", () => {
    const inv = new Inventory();
    const h = new Hotbar();
    const s = makeStack(1, 3);
    inv.set(4, s);
    h.select(4);
    expect(h.selectedStack(inv)).toBe(s);
    h.select(7);
    expect(h.selectedStack(inv)).toBeNull();
  });
});
