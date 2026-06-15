/**
 * workbench-screen.ts — the 3×3 Crafting Table overlay (DOM, fully guarded).
 *
 * Mirrors inventory-screen.ts in structure: thin DOM wiring over pure logic in
 * {@link ./inventory-view} and {@link ./crafting-model} (WorkbenchModel).
 *
 * Layout: 3×3 craft grid + arrow + output slot above; 9×4 inventory grid below.
 * DOM is fully guarded — safe to construct and call without a document.
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
import { WorkbenchModel, WORKBENCH_GRID_CELLS, craftOnceWorkbench } from "./crafting-model";
import { getAtlasIconStyle } from "./item-icon";

/** Whether the DOM is available (false under node / unit tests). */
function hasDom(): boolean {
  return typeof document !== "undefined";
}

const COLS = 9;
const ROWS = 4;

/** Apply the shared slot style (DESIGN tokens). */
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

/** Render a stack (or null) into a slot element. */
function fillSlot(el: HTMLElement, stack: ItemStack | null): void {
  const v = slotView(stack);
  el.title = v.name;
  el.setAttribute("aria-label", v.empty ? "Empty slot" : `${v.name}, ${v.count} items`);

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
 * Find the first stack of `itemId` in `inventory`, or a synthetic display
 * stack (count 1) when none is found — so a craft cell always shows something.
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

/**
 * The 3×3 Workbench screen. Construct once; call {@link open}/{@link close} to
 * toggle and {@link render} to refresh when inventory changes.
 */
export class WorkbenchScreen {
  private open_ = false;
  private root: HTMLElement | null = null;
  private readonly craftCells: HTMLElement[] = [];
  private readonly invSlots: HTMLElement[] = [];
  private outputSlot: HTMLElement | null = null;
  private cursorEl: HTMLElement | null = null;

  /** The cursor-held stack (picked up via clicks). Null when the hand is empty. */
  private cursor: ItemStack | null = null;

  /**
   * Active drag state: set on mousedown, cleared on mouseup or Escape.
   * While set, the dragged item is visually lifted (source slot shows empty).
   */
  private dragState: DragState | null = null;

  /** The 3×3 workbench model. */
  private readonly craft = new WorkbenchModel();

  /** Bound references for the most recent render. */
  private inventory: Inventory | null = null;
  private hotbar: Hotbar | null = null;

  constructor() {
    if (hasDom()) this.build();
  }

  /** Is the screen currently open? */
  isOpen(): boolean {
    return this.open_;
  }

  /** Open the screen and render the inventory. No-op without DOM. */
  open(inventory: Inventory, hotbar: Hotbar): void {
    this.open_ = true;
    this.inventory = inventory;
    this.hotbar = hotbar;
    if (this.root !== null) {
      this.root.style.display = "flex";
      this.render(inventory, hotbar);
    }
  }

  /**
   * Close the screen. Any cursor-held stack and the crafting grid items are
   * returned to the inventory so nothing is lost.
   */
  close(): void {
    this.open_ = false;
    if (this.inventory !== null) {
      this.cancelActiveDrag();
      this.returnCursorToInventory();
      this.returnGridToInventory();
      this.craft.clear();
    }
    if (this.root !== null) this.root.style.display = "none";
  }

  /** Render the inventory + crafting state into the DOM. */
  render(inventory: Inventory, hotbar: Hotbar): void {
    this.inventory = inventory;
    this.hotbar = hotbar;
    if (!hasDom() || this.root === null) return;

    for (let i = 0; i < Inventory.SLOTS; i++) {
      const el = this.invSlots[i];
      if (el === undefined) continue;
      fillSlot(el, inventory.get(i));
    }

    for (let i = 0; i < WORKBENCH_GRID_CELLS; i++) {
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

  // --- DOM construction -----------------------------------------------------

  private build(): void {
    const host =
      document.getElementById("inventory-root") ??
      document.getElementById("hud") ??
      document.body;

    const root = document.createElement("div");
    root.id = "workbench-screen";
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

    // --- Title
    const title = document.createElement("div");
    title.textContent = "Crafting Table";
    title.style.color = "var(--text-secondary, #9a978f)";
    title.style.fontSize = "13px";
    title.style.fontWeight = "600";
    title.style.textTransform = "uppercase";
    title.style.letterSpacing = "0.06em";
    panel.appendChild(title);

    // --- Crafting row: 3×3 grid + arrow + output ---------------------------
    const craftRow = document.createElement("div");
    craftRow.style.display = "flex";
    craftRow.style.alignItems = "center";
    craftRow.style.gap = "12px";

    const craftGrid = document.createElement("div");
    craftGrid.style.display = "grid";
    craftGrid.style.gridTemplateColumns = "repeat(3, 40px)";
    craftGrid.style.gap = "8px";
    for (let i = 0; i < WORKBENCH_GRID_CELLS; i++) {
      const cell = document.createElement("div");
      styleSlot(cell);
      const idx = i;
      cell.addEventListener("click", () => { this.onCraftCellClick(idx); });
      cell.addEventListener("contextmenu", (e) => { e.preventDefault(); this.onCraftCellRightClick(idx); });
      craftGrid.appendChild(cell);
      this.craftCells.push(cell);
    }

    const arrow = document.createElement("div");
    arrow.textContent = "→";
    arrow.style.color = "var(--text-muted, #5c5a54)";
    arrow.style.fontSize = "24px";

    const output = document.createElement("div");
    styleSlot(output);
    output.style.width = "44px";
    output.style.height = "44px";
    output.style.border = "2px solid var(--accent, #d4a843)";
    output.addEventListener("click", () => { this.onOutputClick(); });
    this.outputSlot = output;

    craftRow.appendChild(craftGrid);
    craftRow.appendChild(arrow);
    craftRow.appendChild(output);
    panel.appendChild(craftRow);

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
      cell.addEventListener("contextmenu", (e) => { e.preventDefault(); this.onInventorySlotRightClick(idx); });
      invGrid.appendChild(cell);
      this.invSlots.push(cell);
    }
    panel.appendChild(invGrid);

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

    root.appendChild(panel);
    root.appendChild(cursorEl);
    host.appendChild(root);
    this.root = root;
  }

  // --- Click handlers -------------------------------------------------------

  private onInventorySlotMouseDown(index: number): void {
    if (this.inventory === null) return;
    if (this.cursor !== null) return;
    const result = beginDrag(this.inventory, index);
    if (result === null) return;
    this.dragState = result.drag;
    this.inventory.set(index, result.clearedSlot);
    this.renderDragCursor();
    this.rerender();
  }

  private onInventorySlotMouseUp(index: number, shiftKey: boolean): void {
    if (this.inventory === null) return;

    if (this.dragState !== null) {
      const { moved, sourceSlotValue, targetSlotValue } = applyDragMove(
        this.dragState,
        index,
        this.inventory,
      );
      if (moved) {
        this.inventory.set(this.dragState.sourceSlot, sourceSlotValue);
        this.inventory.set(index, targetSlotValue);
      } else {
        this.inventory.set(index, sourceSlotValue);
      }
      this.dragState = null;
      this.rerender();
      return;
    }

    if (shiftKey) {
      this.shiftClickInventorySlot(index);
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

  private onCraftCellClick(index: number): void {
    if (this.inventory === null) return;
    if (this.cursor !== null) {
      this.craft.setCell(index, this.cursor.itemId);
    } else {
      this.craft.setCell(index, null);
    }
    this.rerender();
  }

  private onCraftCellRightClick(index: number): void {
    if (this.inventory === null) return;
    // Right-click on craft cell: clear it (same as picking nothing).
    this.craft.setCell(index, null);
    this.rerender();
  }

  private onOutputClick(): void {
    if (this.inventory === null) return;
    craftOnceWorkbench(this.craft, this.inventory);
    this.rerender();
  }

  // --- Helpers ---------------------------------------------------------------

  private rerender(): void {
    if (this.inventory !== null && this.hotbar !== null) {
      this.render(this.inventory, this.hotbar);
    }
  }

  private renderCursor(): void {
    if (this.cursorEl === null) return;
    const displayStack = this.dragState?.item ?? this.cursor ?? null;
    if (displayStack === null || displayStack.count <= 0) {
      this.cursorEl.style.display = "none";
      return;
    }
    const v = slotView(displayStack);
    this.cursorEl.textContent = `${v.label} ${v.count}`;
    this.cursorEl.style.display = "block";
  }

  private renderDragCursor(): void {
    if (this.cursorEl === null || this.dragState === null) return;
    const v = slotView(this.dragState.item);
    this.cursorEl.textContent = `${v.label} ${v.count}`;
    this.cursorEl.style.display = "block";
  }

  private cancelActiveDrag(): void {
    if (this.dragState === null || this.inventory === null) return;
    const restored = cancelDrag(this.dragState);
    const current = this.inventory.get(this.dragState.sourceSlot);
    if (current === null) {
      this.inventory.set(this.dragState.sourceSlot, restored);
    } else {
      const leftover = this.inventory.add(restored);
      if (leftover > 0) {
        // Inventory completely full edge case — item silently dropped.
      }
    }
    this.dragState = null;
  }

  private returnCursorToInventory(): void {
    if (this.cursor === null || this.inventory === null) return;
    const leftover = this.inventory.add(this.cursor);
    this.cursor = leftover > 0 ? { ...this.cursor, count: leftover } : null;
  }

  /** Return any items placed in the crafting grid back to the inventory. */
  private returnGridToInventory(): void {
    if (this.inventory === null) return;
    for (let i = 0; i < WORKBENCH_GRID_CELLS; i++) {
      const id = this.craft.cell(i);
      if (id === null) continue;
      // Return exactly one item per non-empty cell (as we displayed it).
      this.inventory.add({ itemId: id, count: 1, maxStack: 64 });
    }
  }

  /** Apply shift-click quick-move for the inventory. */
  shiftClickInventorySlot(index: number): void {
    if (this.inventory === null) return;
    const { moved, slots } = applyShiftClick(this.inventory, index);
    if (!moved) return;
    for (let i = 0; i < Inventory.SLOTS; i++) {
      this.inventory.set(i, slots[i] ?? null);
    }
    this.rerender();
  }
}
