import { describe, it, expect } from "vitest";
import {
  slotView,
  shortLabel,
  applySlotClick,
  applyRightClick,
  applyShiftClick,
  beginDrag,
  applyDragMove,
  cancelDrag,
} from "./inventory-view";
import { makeStack, makeToolStack } from "../inventory/stack";
import { Blocks } from "../rules/mc-1.20";
import { Items } from "../rules/items";
import { Inventory } from "../inventory/inventory";

describe("slotView / shortLabel", () => {
  it("maps an empty slot", () => {
    const v = slotView(null);
    expect(v.empty).toBe(true);
    expect(v.label).toBe("");
    expect(v.count).toBe(0);
  });

  it("maps a stone stack to a 3-letter label + full name", () => {
    const v = slotView(makeStack(Blocks.STONE, 42));
    expect(v.empty).toBe(false);
    expect(v.label).toBe("STO");
    expect(v.count).toBe(42);
    expect(v.name).toBe("Stone");
  });

  it("treats a zero-count stack as empty", () => {
    const v = slotView(makeStack(Blocks.STONE, 0));
    expect(v.empty).toBe(true);
  });

  it("shortLabel falls back to the numeric id for unknown items", () => {
    expect(shortLabel(99999)).toBe("99999");
  });

  it("labels a non-block item", () => {
    expect(shortLabel(Items.STICK)).toBe("STI");
  });
});

describe("applySlotClick", () => {
  it("no-op when cursor and slot are both empty", () => {
    const r = applySlotClick(null, null);
    expect(r.cursor).toBeNull();
    expect(r.slot).toBeNull();
  });

  it("picks up the whole slot stack into an empty cursor", () => {
    const r = applySlotClick(null, makeStack(Blocks.STONE, 10));
    expect(r.cursor?.itemId).toBe(Blocks.STONE);
    expect(r.cursor?.count).toBe(10);
    expect(r.slot).toBeNull();
  });

  it("drops the cursor stack into an empty slot", () => {
    const r = applySlotClick(makeStack(Blocks.DIRT, 5), null);
    expect(r.slot?.itemId).toBe(Blocks.DIRT);
    expect(r.slot?.count).toBe(5);
    expect(r.cursor).toBeNull();
  });

  it("merges same items, leaving overflow on the cursor", () => {
    // slot has 60/64, cursor has 10 -> slot 64, cursor 6 left.
    const r = applySlotClick(
      makeStack(Blocks.STONE, 10),
      makeStack(Blocks.STONE, 60),
    );
    expect(r.slot?.count).toBe(64);
    expect(r.cursor?.count).toBe(6);
  });

  it("fully merges when room exists, clearing the cursor", () => {
    const r = applySlotClick(
      makeStack(Blocks.STONE, 4),
      makeStack(Blocks.STONE, 60),
    );
    expect(r.slot?.count).toBe(64);
    expect(r.cursor).toBeNull();
  });

  it("swaps two different items", () => {
    const r = applySlotClick(
      makeStack(Blocks.STONE, 3),
      makeStack(Blocks.DIRT, 7),
    );
    expect(r.cursor?.itemId).toBe(Blocks.DIRT);
    expect(r.cursor?.count).toBe(7);
    expect(r.slot?.itemId).toBe(Blocks.STONE);
    expect(r.slot?.count).toBe(3);
  });

  it("swaps tools rather than merging them", () => {
    const r = applySlotClick(
      makeToolStack(Items.IRON_PICKAXE, "iron"),
      makeToolStack(Items.IRON_PICKAXE, "iron"),
    );
    // Tools never merge — they swap (both single, distinct instances).
    expect(r.cursor).not.toBeNull();
    expect(r.slot).not.toBeNull();
    expect(r.cursor?.maxStack).toBe(1);
  });
});

describe("applyRightClick", () => {
  it("no-op when both cursor and slot are empty", () => {
    const r = applyRightClick(null, null);
    expect(r.cursor).toBeNull();
    expect(r.slot).toBeNull();
  });

  it("picks up half (floor) into cursor from a slot", () => {
    const r = applyRightClick(null, makeStack(Blocks.STONE, 10));
    expect(r.cursor?.count).toBe(5);
    expect(r.slot?.count).toBe(5);
  });

  it("picks up half, rounding down (odd count)", () => {
    const r = applyRightClick(null, makeStack(Blocks.STONE, 7));
    expect(r.cursor?.count).toBe(3);
    expect(r.slot?.count).toBe(4);
  });

  it("picks up 1 from a single-item slot, leaving slot empty", () => {
    const r = applyRightClick(null, makeStack(Blocks.STONE, 1));
    expect(r.cursor?.count).toBe(1);
    expect(r.slot).toBeNull();
  });

  it("drops ONE item from cursor into an empty slot", () => {
    const r = applyRightClick(makeStack(Blocks.DIRT, 5), null);
    expect(r.cursor?.count).toBe(4);
    expect(r.slot?.count).toBe(1);
    expect(r.slot?.itemId).toBe(Blocks.DIRT);
  });

  it("clears cursor when dropping the last item", () => {
    const r = applyRightClick(makeStack(Blocks.DIRT, 1), null);
    expect(r.cursor).toBeNull();
    expect(r.slot?.count).toBe(1);
  });

  it("drops ONE onto a same-item slot if there is room", () => {
    const r = applyRightClick(
      makeStack(Blocks.STONE, 10),
      makeStack(Blocks.STONE, 60),
    );
    expect(r.slot?.count).toBe(61);
    expect(r.cursor?.count).toBe(9);
  });

  it("swaps when cursor and slot hold different items", () => {
    const r = applyRightClick(
      makeStack(Blocks.STONE, 5),
      makeStack(Blocks.DIRT, 3),
    );
    expect(r.cursor?.itemId).toBe(Blocks.DIRT);
    expect(r.slot?.itemId).toBe(Blocks.STONE);
  });

  it("swaps when target slot is full of same item", () => {
    const r = applyRightClick(
      makeStack(Blocks.STONE, 5),
      makeStack(Blocks.STONE, 64),
    );
    // slot is already full — swap
    expect(r.cursor?.count).toBe(64);
    expect(r.slot?.count).toBe(5);
  });
});

describe("applyShiftClick", () => {
  it("no-op on an empty slot", () => {
    const inv = new Inventory();
    const result = applyShiftClick(inv, 0);
    expect(result.moved).toBe(false);
  });

  it("moves a hotbar stack to the main area", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.STONE, 10)); // hotbar slot 0
    const { moved, slots } = applyShiftClick(inv, 0);
    expect(moved).toBe(true);
    // Source slot should be empty.
    expect(slots[0]).toBeNull();
    // Some slot in main area (9..35) should have the stones.
    const mainStones = slots.slice(9).reduce((acc, s) => acc + (s?.itemId === Blocks.STONE ? (s?.count ?? 0) : 0), 0);
    expect(mainStones).toBe(10);
  });

  it("moves a main-area stack to the hotbar", () => {
    const inv = new Inventory();
    inv.set(10, makeStack(Blocks.DIRT, 8)); // main area slot 10
    const { moved, slots } = applyShiftClick(inv, 10);
    expect(moved).toBe(true);
    expect(slots[10]).toBeNull();
    const hotbarDirt = slots.slice(0, 9).reduce((acc, s) => acc + (s?.itemId === Blocks.DIRT ? (s?.count ?? 0) : 0), 0);
    expect(hotbarDirt).toBe(8);
  });

  it("merges into an existing partial stack in the target region", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.STONE, 10)); // hotbar
    inv.set(9, makeStack(Blocks.STONE, 50)); // partial in main area
    const { moved, slots } = applyShiftClick(inv, 0);
    expect(moved).toBe(true);
    expect(slots[0]).toBeNull();
    // The 10 stones should have merged into slot 9 (50+10=60).
    expect(slots[9]?.count).toBe(60);
  });

  it("returns moved=false if no room in target", () => {
    const inv = new Inventory();
    // Fill all main area slots.
    for (let i = Inventory.HOTBAR_SLOTS; i < Inventory.SLOTS; i++) {
      inv.set(i, makeStack(Blocks.STONE, 64));
    }
    inv.set(0, makeStack(Blocks.DIRT, 5)); // hotbar slot 0, DIRT can't merge with STONE
    const { moved } = applyShiftClick(inv, 0);
    expect(moved).toBe(false);
  });

  it("leaves source intact when nothing moved", () => {
    const inv = new Inventory();
    for (let i = Inventory.HOTBAR_SLOTS; i < Inventory.SLOTS; i++) {
      inv.set(i, makeStack(Blocks.STONE, 64));
    }
    inv.set(0, makeStack(Blocks.DIRT, 5));
    applyShiftClick(inv, 0);
    // Original inventory untouched (pure function).
    expect(inv.get(0)?.count).toBe(5);
  });
});

describe("beginDrag", () => {
  it("returns null when the slot is empty", () => {
    const inv = new Inventory();
    const result = beginDrag(inv, 0);
    expect(result).toBeNull();
  });

  it("returns drag state with a copy of the stack", () => {
    const inv = new Inventory();
    inv.set(3, makeStack(Blocks.STONE, 12));
    const result = beginDrag(inv, 3);
    expect(result).not.toBeNull();
    expect(result?.drag.sourceSlot).toBe(3);
    expect(result?.drag.item.itemId).toBe(Blocks.STONE);
    expect(result?.drag.item.count).toBe(12);
    // clearedSlot is always null (item lifted off)
    expect(result?.clearedSlot).toBeNull();
  });

  it("does not mutate the inventory", () => {
    const inv = new Inventory();
    inv.set(5, makeStack(Blocks.DIRT, 7));
    beginDrag(inv, 5);
    // beginDrag is pure — caller is responsible for writing clearedSlot back.
    expect(inv.get(5)?.count).toBe(7);
  });
});

describe("applyDragMove", () => {
  it("places onto an empty target slot", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.STONE, 8));
    const { drag } = beginDrag(inv, 0)!;
    inv.set(0, null); // simulate the visual lift
    const r = applyDragMove(drag, 5, inv);
    expect(r.moved).toBe(true);
    expect(r.sourceSlotValue).toBeNull();
    expect(r.targetSlotValue?.itemId).toBe(Blocks.STONE);
    expect(r.targetSlotValue?.count).toBe(8);
  });

  it("swaps with a different item in the target slot", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.STONE, 8));
    inv.set(5, makeStack(Blocks.DIRT, 3));
    const { drag } = beginDrag(inv, 0)!;
    inv.set(0, null);
    const r = applyDragMove(drag, 5, inv);
    expect(r.moved).toBe(true);
    // Displaced DIRT goes back to source slot.
    expect(r.sourceSlotValue?.itemId).toBe(Blocks.DIRT);
    expect(r.sourceSlotValue?.count).toBe(3);
    // STONE lands in target.
    expect(r.targetSlotValue?.itemId).toBe(Blocks.STONE);
    expect(r.targetSlotValue?.count).toBe(8);
  });

  it("merges with the same item type in the target slot", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.STONE, 10));
    inv.set(5, makeStack(Blocks.STONE, 50));
    const { drag } = beginDrag(inv, 0)!;
    inv.set(0, null);
    const r = applyDragMove(drag, 5, inv);
    expect(r.moved).toBe(true);
    // All 10 stones fit into the 50-stack (max 64).
    expect(r.targetSlotValue?.count).toBe(60);
    expect(r.sourceSlotValue).toBeNull(); // cursor empty after full merge
  });

  it("leaves overflow at the source slot when merge exceeds maxStack", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.STONE, 20));
    inv.set(5, makeStack(Blocks.STONE, 55));
    const { drag } = beginDrag(inv, 0)!;
    inv.set(0, null);
    const r = applyDragMove(drag, 5, inv);
    expect(r.moved).toBe(true);
    expect(r.targetSlotValue?.count).toBe(64); // capped at maxStack
    expect(r.sourceSlotValue?.count).toBe(11); // 20 - 9 remainder
  });

  it("restores item when dropped on the same slot (no move)", () => {
    const inv = new Inventory();
    inv.set(2, makeStack(Blocks.DIRT, 4));
    const { drag } = beginDrag(inv, 2)!;
    inv.set(2, null);
    const r = applyDragMove(drag, 2, inv);
    expect(r.moved).toBe(false);
    expect(r.sourceSlotValue?.itemId).toBe(Blocks.DIRT);
    expect(r.sourceSlotValue?.count).toBe(4);
  });

  it("does not mutate the inventory", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.STONE, 5));
    inv.set(1, makeStack(Blocks.DIRT, 3));
    const { drag } = beginDrag(inv, 0)!;
    applyDragMove(drag, 1, inv);
    // inventory unchanged (pure function)
    expect(inv.get(0)?.count).toBe(5);
    expect(inv.get(1)?.count).toBe(3);
  });
});

describe("cancelDrag", () => {
  it("returns a copy of the dragged item", () => {
    const inv = new Inventory();
    inv.set(7, makeStack(Blocks.STONE, 15));
    const { drag } = beginDrag(inv, 7)!;
    const restored = cancelDrag(drag);
    expect(restored.itemId).toBe(Blocks.STONE);
    expect(restored.count).toBe(15);
  });

  it("returned stack is a new object (not the same reference)", () => {
    const inv = new Inventory();
    inv.set(0, makeStack(Blocks.DIRT, 2));
    const { drag } = beginDrag(inv, 0)!;
    const restored = cancelDrag(drag);
    // Mutation of restored must not affect drag.item
    restored.count = 999;
    expect(drag.item.count).toBe(2);
  });
});
