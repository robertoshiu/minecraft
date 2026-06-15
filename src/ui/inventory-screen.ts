/**
 * inventory-screen.ts — the DOM inventory + hand-craft panel.
 *
 * Thin DOM wiring over the pure logic in {@link ./inventory-view} (slot view +
 * cursor transfer) and {@link ./crafting-model} (HandCraftModel + craftOnce).
 * The screen renders the 36-slot inventory grid (9×4), a 2×2 hand-craft grid,
 * and an output slot, styled with the DESIGN.md color tokens.
 *
 * DOM is OPTIONAL: under node / NullEngine (no `document`) every method is a
 * silent no-op so the class is safe to construct and call in headless tests.
 * Hidden by default; {@link InventoryScreen.open} reveals it.
 */

import { Inventory, type Hotbar } from "../inventory/inventory";
import type { ItemStack } from "../inventory/stack";
import {
  slotView,
  applySlotClick,
  applyRightClick,
  applyShiftClick,
  beginDrag,
  applyDragMove,
  cancelDrag,
  type DragState,
} from "./inventory-view";
import {
  HandCraftModel,
  HAND_GRID_CELLS,
  craftOnce,
} from "./crafting-model";
import { getAtlasIconStyle } from "./item-icon";

/** Whether the DOM is available (false under node / unit tests). */
function hasDom(): boolean {
  return typeof document !== "undefined";
}

/** Column / row counts for the inventory grid. */
const COLS = 9;
const ROWS = 4;

/** Apply the shared slot look (DESIGN tokens) to a slot element. */
function styleSlot(el: HTMLElement): void {
  el.style.width = "40px";
  el.style.height = "40px";
  el.style.background = "var(--bg-slot, #252830)";
  el.style.border = "1px solid var(--slot-border, #3a3d45)";
  el.style.borderRadius = "4px";
  el.style.display = "flex";
  el.style.flexDirection = "column";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.fontSize = "10px";
  el.style.lineHeight = "1.1";
  el.style.color = "var(--text-primary, #e8e6e1)";
  el.style.cursor = "pointer";
  el.style.userSelect = "none";
}

/** Render a stack (or null) into a slot element via the pure view-model. */
function fillSlot(el: HTMLElement, stack: ItemStack | null): void {
  const v = slotView(stack);
  el.title = v.name;
  el.setAttribute(
    "aria-label",
    v.empty ? "Empty slot" : `${v.name}, ${v.count} items`,
  );

  // Clear previous icon state before re-rendering.
  el.style.backgroundImage = "";
  el.style.backgroundSize = "";
  el.style.backgroundPosition = "";
  el.style.imageRendering = "";

  if (v.empty) {
    el.textContent = "";
    return;
  }

  // Try to show the atlas block icon as a CSS background.
  const iconStyle = getAtlasIconStyle(stack!.itemId);
  if (iconStyle !== null) {
    el.textContent = ""; // clear text; count goes in a child span
    el.style.backgroundImage = iconStyle.backgroundImage;
    el.style.backgroundSize = iconStyle.backgroundSize;
    el.style.backgroundPosition = iconStyle.backgroundPosition;
    el.style.imageRendering = iconStyle.imageRendering;
    el.style.position = "relative";

    const countSpan = document.createElement("span");
    countSpan.className = "slot-count";
    countSpan.textContent = String(v.count);
    el.appendChild(countSpan);
  } else {
    // Fallback: text label (non-block items, headless env, canvas unavailable).
    el.textContent = `${v.label} ${String(v.count)}`;
  }
}

/**
 * The inventory + hand-craft screen. Construct once; call {@link render} when
 * the backing inventory changes and {@link open}/{@link close} to toggle.
 */
export class InventoryScreen {
  private root: HTMLElement | null = null;
  private readonly invSlots: HTMLElement[] = [];
  private readonly craftCells: HTMLElement[] = [];
  private outputSlot: HTMLElement | null = null;
  private cursorEl: HTMLElement | null = null;

  private open_ = false;

  /** The cursor-held stack (picked up via clicks). Null when the hand is empty. */
  private cursor: ItemStack | null = null;

  /**
   * Active drag state: set on mousedown, cleared on mouseup or Escape.
   * While set, the dragged item is visually lifted (source slot shows empty).
   */
  private dragState: DragState | null = null;

  /** The 2×2 hand-craft model (item ids backed by the inventory). */
  private readonly craft = new HandCraftModel();

  /** Bound references for the most recent render (so clicks can re-render). */
  private inventory: Inventory | null = null;
  private hotbar: Hotbar | null = null;

  constructor() {
    if (!hasDom()) return;
    this.build();
  }

  /** Is the screen currently open? */
  isOpen(): boolean {
    return this.open_;
  }

  /** Reveal the screen (no-op without DOM). */
  open(): void {
    this.open_ = true;
    if (this.root !== null) this.root.style.display = "flex";
  }

  /**
   * Hide the screen. Any cursor-held stack and the crafting grid are returned
   * to the inventory so nothing is lost when the player closes the panel.
   */
  close(): void {
    this.open_ = false;
    if (this.inventory !== null) {
      this.cancelActiveDrag();
      this.returnCursorToInventory();
      this.craft.clear();
    }
    if (this.root !== null) this.root.style.display = "none";
  }

  /**
   * Render the 36 inventory slots + craft grid + output for `inventory`. The
   * `hotbar` is retained so future selection highlighting stays in sync.
   */
  render(inventory: Inventory, hotbar: Hotbar): void {
    this.inventory = inventory;
    this.hotbar = hotbar;
    if (!hasDom() || this.root === null) return;

    for (let i = 0; i < Inventory.SLOTS; i++) {
      const el = this.invSlots[i];
      if (el === undefined) continue;
      fillSlot(el, inventory.get(i));
    }

    for (let i = 0; i < HAND_GRID_CELLS; i++) {
      const el = this.craftCells[i];
      if (el === undefined) continue;
      const id = this.craft.cell(i);
      fillSlot(el, id === null ? null : firstStackOf(inventory, id));
    }

    if (this.outputSlot !== null) {
      const out = this.craft.output();
      fillSlot(
        this.outputSlot,
        out === null ? null : { itemId: out.result, count: out.count, maxStack: 64 },
      );
    }

    this.renderCursor();
  }

  // --- DOM construction ----------------------------------------------------

  private build(): void {
    const host =
      document.getElementById("inventory-root") ??
      document.getElementById("hud") ??
      document.body;

    const root = document.createElement("div");
    root.id = "inventory-screen";
    root.style.position = "fixed";
    root.style.inset = "0";
    root.style.display = "none";
    root.style.alignItems = "center";
    root.style.justifyContent = "center";
    root.style.zIndex = "30";
    root.style.pointerEvents = "auto";
    root.style.background = "var(--bg-overlay, rgba(0,0,0,0.55))";
    root.style.backdropFilter = "blur(8px)";

    const panel = document.createElement("div");
    panel.style.background = "var(--bg-glass, rgba(18,21,28,0.82))";
    panel.style.border = "1px solid var(--slot-border, #3a3d45)";
    panel.style.borderRadius = "8px";
    panel.style.padding = "16px";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.gap = "16px";
    panel.style.color = "var(--text-primary, #e8e6e1)";

    // --- Crafting row: 2×2 grid + arrow + output ---------------------------
    const craftRow = document.createElement("div");
    craftRow.style.display = "flex";
    craftRow.style.alignItems = "center";
    craftRow.style.gap = "12px";

    const craftGrid = document.createElement("div");
    craftGrid.style.display = "grid";
    craftGrid.style.gridTemplateColumns = "repeat(2, 40px)";
    craftGrid.style.gap = "8px";
    for (let i = 0; i < HAND_GRID_CELLS; i++) {
      const cell = document.createElement("div");
      styleSlot(cell);
      const idx = i;
      cell.addEventListener("click", () => this.onCraftCellClick(idx));
      craftGrid.appendChild(cell);
      this.craftCells.push(cell);
    }

    const arrow = document.createElement("div");
    arrow.textContent = "→"; // →
    arrow.style.color = "var(--text-muted, #5c5a54)";
    arrow.style.fontSize = "24px";

    const output = document.createElement("div");
    styleSlot(output);
    output.style.width = "44px";
    output.style.height = "44px";
    output.style.border = "2px solid var(--accent, #d4a843)";
    output.addEventListener("click", () => this.onOutputClick());
    this.outputSlot = output;

    craftRow.appendChild(craftGrid);
    craftRow.appendChild(arrow);
    craftRow.appendChild(output);

    // --- Inventory grid (9×4) ----------------------------------------------
    const invGrid = document.createElement("div");
    invGrid.style.display = "grid";
    invGrid.style.gridTemplateColumns = `repeat(${String(COLS)}, 40px)`;
    invGrid.style.gridTemplateRows = `repeat(${String(ROWS)}, 40px)`;
    invGrid.style.gap = "8px";
    for (let i = 0; i < Inventory.SLOTS; i++) {
      const cell = document.createElement("div");
      styleSlot(cell);
      const idx = i;
      cell.addEventListener("mouseenter", () => {
        cell.style.background = "var(--bg-slot-hover, #2f333d)";
      });
      cell.addEventListener("mouseleave", () => {
        cell.style.background = "var(--bg-slot, #252830)";
      });
      cell.addEventListener("mousedown", (e) => {
        if (e.button === 0 && !e.shiftKey) {
          this.onInventorySlotMouseDown(idx);
        }
      });
      cell.addEventListener("mouseup", (e) => {
        if (e.button === 0) {
          this.onInventorySlotMouseUp(idx, e.shiftKey);
        }
      });
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.onInventorySlotRightClick(idx);
      });
      invGrid.appendChild(cell);
      this.invSlots.push(cell);
    }

    // --- Floating cursor stack indicator -----------------------------------
    const cursorEl = document.createElement("div");
    cursorEl.style.position = "fixed";
    cursorEl.style.pointerEvents = "none";
    cursorEl.style.padding = "2px 6px";
    cursorEl.style.borderRadius = "4px";
    cursorEl.style.background = "var(--bg-panel, #1a1d24)";
    cursorEl.style.border = "1px solid var(--accent, #d4a843)";
    cursorEl.style.color = "var(--text-primary, #e8e6e1)";
    cursorEl.style.fontSize = "11px";
    cursorEl.style.display = "none";
    cursorEl.style.zIndex = "40";
    this.cursorEl = cursorEl;
    root.addEventListener("mousemove", (e) => {
      const isDragging = this.dragState !== null;
      const hasCursor = this.cursor !== null;
      if (isDragging || hasCursor) {
        cursorEl.style.left = `${String(e.clientX + 12)}px`;
        cursorEl.style.top = `${String(e.clientY + 12)}px`;
      }
    });

    // Mouseup on the overlay backdrop (not on a slot) cancels any active drag.
    root.addEventListener("mouseup", (e) => {
      if (e.button === 0 && this.dragState !== null) {
        this.cancelActiveDrag();
        this.rerender();
      }
    });

    // Escape key cancels drag or returns the cursor item to inventory.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && this.open_) {
        if (this.dragState !== null) {
          this.cancelActiveDrag();
          this.rerender();
        } else if (this.cursor !== null) {
          this.returnCursorToInventory();
          this.rerender();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);

    panel.appendChild(craftRow);
    panel.appendChild(invGrid);
    root.appendChild(panel);
    root.appendChild(cursorEl);
    host.appendChild(root);
    this.root = root;
  }

  // --- Click handlers (thin: delegate to pure helpers) ---------------------

  private onInventorySlotMouseDown(index: number): void {
    if (this.inventory === null) return;
    // Only start a drag if the cursor is empty (holding nothing) and the slot
    // has an item. If the cursor already holds an item, let mouseup handle the
    // place-on-click logic instead.
    if (this.cursor !== null) return;
    const result = beginDrag(this.inventory, index);
    if (result === null) return;
    this.dragState = result.drag;
    // Clear the slot visually while dragging.
    this.inventory.set(index, result.clearedSlot);
    this.renderDragCursor();
    this.rerender();
  }

  private onInventorySlotMouseUp(index: number, shiftKey: boolean): void {
    if (this.inventory === null) return;

    if (this.dragState !== null) {
      // Completing a drag.
      const { moved, sourceSlotValue, targetSlotValue } = applyDragMove(
        this.dragState,
        index,
        this.inventory,
      );
      if (moved) {
        this.inventory.set(this.dragState.sourceSlot, sourceSlotValue);
        this.inventory.set(index, targetSlotValue);
      } else {
        // Dropped on the same slot — restore.
        this.inventory.set(index, sourceSlotValue);
      }
      this.dragState = null;
      this.rerender();
      return;
    }

    // No drag in progress — treat as a normal click.
    if (shiftKey) {
      this.onInventorySlotShiftClick(index);
    } else {
      const slot = this.inventory.get(index);
      const r = applySlotClick(this.cursor, slot);
      this.cursor = r.cursor;
      this.inventory.set(index, r.slot);
      this.rerender();
    }
  }

  private onInventorySlotRightClick(index: number): void {
    if (this.inventory === null) return;
    const slot = this.inventory.get(index);
    const r = applyRightClick(this.cursor, slot);
    this.cursor = r.cursor;
    this.inventory.set(index, r.slot);
    this.rerender();
  }

  private onInventorySlotShiftClick(index: number): void {
    if (this.inventory === null) return;
    const { moved, slots } = applyShiftClick(this.inventory, index);
    if (!moved) return;
    for (let i = 0; i < Inventory.SLOTS; i++) {
      this.inventory.set(i, slots[i] ?? null);
    }
    this.rerender();
  }

  /**
   * A craft-cell click stamps the cursor's item id into the cell (or clears it
   * when the cursor is empty). The grid only records the item *id*; the actual
   * stack stays in the inventory, which {@link craftOnce} consumes from.
   */
  private onCraftCellClick(index: number): void {
    if (this.inventory === null) return;
    if (this.cursor !== null) {
      this.craft.setCell(index, this.cursor.itemId);
    } else {
      this.craft.setCell(index, null);
    }
    this.rerender();
  }

  /** Clicking the output slot crafts once, banking the result in the inventory. */
  private onOutputClick(): void {
    if (this.inventory === null) return;
    craftOnce(this.craft, this.inventory);
    this.rerender();
  }

  // --- Helpers -------------------------------------------------------------

  private rerender(): void {
    if (this.inventory !== null && this.hotbar !== null) {
      this.render(this.inventory, this.hotbar);
    }
  }

  private renderCursor(): void {
    if (this.cursorEl === null) return;
    // Show drag item in preference to cursor item.
    const displayStack = this.dragState?.item ?? this.cursor ?? null;
    if (displayStack === null || displayStack.count <= 0) {
      this.cursorEl.style.display = "none";
      return;
    }
    const v = slotView(displayStack);
    this.cursorEl.textContent = `${v.label} ${v.count}`;
    this.cursorEl.style.display = "block";
  }

  /** Update the floating cursor element to show the drag item immediately. */
  private renderDragCursor(): void {
    if (this.cursorEl === null || this.dragState === null) return;
    const v = slotView(this.dragState.item);
    this.cursorEl.textContent = `${v.label} ${v.count}`;
    this.cursorEl.style.display = "block";
  }

  /** Cancel an active drag: return the dragged item to its source slot. */
  private cancelActiveDrag(): void {
    if (this.dragState === null || this.inventory === null) return;
    const restored = cancelDrag(this.dragState);
    // Try to return to the exact source slot; if it now holds something else
    // (shouldn't happen in practice), fall back to inventory.add().
    const current = this.inventory.get(this.dragState.sourceSlot);
    if (current === null) {
      this.inventory.set(this.dragState.sourceSlot, restored);
    } else {
      // Source slot occupied — try to find another home.
      const leftover = this.inventory.add(restored);
      if (leftover > 0) {
        // Drop silently (inventory completely full edge case).
      }
    }
    this.dragState = null;
  }

  /** Return any cursor-held stack into the inventory (used when closing). */
  private returnCursorToInventory(): void {
    if (this.cursor === null || this.inventory === null) return;
    const leftover = this.inventory.add(this.cursor);
    this.cursor = leftover > 0 ? { ...this.cursor, count: leftover } : null;
  }
}

/**
 * The first stack of `itemId` in the inventory, or a synthetic display stack
 * (count 1) when none is found — so a craft cell always shows something while
 * populated.
 */
function firstStackOf(inventory: Inventory, itemId: number): ItemStack {
  for (let i = 0; i < Inventory.SLOTS; i++) {
    const stack = inventory.get(i);
    if (stack !== null && stack.itemId === itemId) {
      return { itemId, count: 1, maxStack: stack.maxStack };
    }
  }
  return { itemId, count: 1, maxStack: 64 };
}
