/**
 * brewing-stand-screen.ts — the INTERACTIVE Brewing Stand overlay (DOM, fully
 * guarded). Mirrors workbench-screen.ts: a thin DOM layer over the pure
 * inventory-view cursor-stack helpers. The player clicks to move stacks
 * between their inventory and the bound BrewingStand's four slots (base /
 * ingredient / fuel / output); the output slot is collect-only. The bound
 * stand is the SAME instance the registry ticks, so loads/collects persist.
 *
 * Slot layout (left→right):
 *   [Base]  [Ingredient]  [Fuel]  →  [Output]
 * Progress bar line below stand slots.
 * 9×4 player inventory grid below.
 *
 * DESIGN tokens: matches the workbench/inventory idiom exactly.
 * DOM is fully guarded — safe to construct in a Node/headless env.
 */

import { Inventory, type Hotbar } from "../inventory/inventory";
import type { ItemStack } from "../inventory/stack";
import type { BrewingStand } from "../crafting/brewing-stand";
import { BREW } from "../rules/mc-1.20";
import {
  slotView,
  applySlotClick,
  applyRightClick,
} from "./inventory-view";
import { getAtlasIconStyle } from "./item-icon";

/** Whether the DOM is available (false under node / unit tests). */
function hasDom(): boolean {
  return typeof document !== "undefined";
}

const COLS = 9;
const ROWS = 4;

/** The four stand slots, in display order. */
type StandSlot = "base" | "ingredient" | "fuel" | "output";

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
  el.style.position = "relative";
}

/** Render a stack (or null) into a slot element. */
function fillSlot(el: HTMLElement, stack: ItemStack | null): void {
  const v = slotView(stack);
  el.title = v.name;
  el.setAttribute("aria-label", v.empty ? "Empty slot" : `${v.name}, ${String(v.count)} items`);

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
    el.textContent = "";
    el.style.backgroundImage = iconStyle.backgroundImage;
    el.style.backgroundSize = iconStyle.backgroundSize;
    el.style.backgroundPosition = iconStyle.backgroundPosition;
    el.style.imageRendering = iconStyle.imageRendering;

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
 * The Brewing Stand screen. Construct once; call {@link open}/{@link close} to
 * toggle. Exposes {@link render} for the render loop to keep the screen in sync
 * while open.
 */
export class BrewingStandScreen {
  private open_ = false;
  private root: HTMLElement | null = null;
  private inventory: Inventory | null = null;
  private stand: BrewingStand | null = null;
  private cursor: ItemStack | null = null;
  private standCells: Record<StandSlot, HTMLElement> = {} as Record<StandSlot, HTMLElement>;
  private readonly invSlots: HTMLElement[] = [];
  private progressEl: HTMLElement | null = null;
  private cursorEl: HTMLElement | null = null;

  constructor() {
    if (hasDom()) this.build();
  }

  /** Is the screen currently open? */
  isOpen(): boolean {
    return this.open_;
  }

  /** Open the screen, binding the given live stand + player inventory. */
  open(stand: BrewingStand, inventory: Inventory, _hotbar: Hotbar): void {
    this.open_ = true;
    this.stand = stand;
    this.inventory = inventory;
    if (this.root !== null) {
      this.root.style.display = "flex";
      this.render();
    }
  }

  /**
   * Close the screen. Any cursor-held stack is returned to the player inventory
   * (no item loss — mirrors WorkbenchScreen.close()).
   */
  close(): void {
    this.open_ = false;
    this.returnCursorToInventory();
    if (this.root !== null) this.root.style.display = "none";
  }

  /** Re-render slots + progress + cursor. Called each frame while open. */
  render(): void {
    if (!hasDom() || this.root === null) return;

    fillSlot(this.standCells.base, this.standGet("base"));
    fillSlot(this.standCells.ingredient, this.standGet("ingredient"));
    fillSlot(this.standCells.fuel, this.standGet("fuel"));
    fillSlot(this.standCells.output, this.standGet("output"));

    if (this.inventory !== null) {
      for (let i = 0; i < Inventory.SLOTS; i++) {
        const el = this.invSlots[i];
        if (el !== undefined) fillSlot(el, this.inventory.get(i));
      }
    }

    if (this.progressEl !== null && this.stand !== null) {
      const pct = Math.round((this.stand.brewProgress / BREW.TICKS_PER_BREW) * 100);
      const fuelInfo = this.stand.brewsRemaining > 0
        ? ` | Fuel: ${String(this.stand.brewsRemaining)} brews`
        : " | No fuel";
      this.progressEl.textContent = `Brewing: ${String(pct)}%${fuelInfo}`;
    }

    this.renderCursor();
  }

  // --- Private helpers -------------------------------------------------------

  private returnCursorToInventory(): void {
    if (this.cursor === null || this.inventory === null) return;
    const leftover = this.inventory.add(this.cursor);
    this.cursor = leftover > 0 ? { ...this.cursor, count: leftover } : null;
  }

  /** Read the bound stand's slot. */
  private standGet(slot: StandSlot): ItemStack | null {
    if (this.stand === null) return null;
    return this.stand[slot];
  }

  /** Write the bound stand's slot. */
  private standSet(slot: StandSlot, stack: ItemStack | null): void {
    if (this.stand === null) return;
    this.stand[slot] = stack;
  }

  /**
   * Left-click a stand slot. Output slot is collect-only: pulls the finished
   * potion onto the cursor, never deposits. Input slots use applySlotClick.
   */
  private onStandSlotClick(slot: StandSlot): void {
    if (this.stand === null) return;
    if (slot === "output") {
      // Collect-only: pull the finished potion onto the cursor; NEVER deposit.
      const out = this.standGet("output");
      if (out === null) return;
      if (this.cursor === null) {
        // Empty hand → take the whole output stack.
        this.cursor = { ...out };
        this.standSet("output", null);
      } else if (this.cursor.itemId === out.itemId) {
        // Same item already on cursor. Potions are maxStack:1, so canMerge is
        // false; applySlotClick degenerates to a swap — identical stacks swap
        // back into the same positions, making this effectively a no-op.
        const merged = applySlotClick(out, this.cursor);
        this.cursor = merged.slot;
        this.standSet("output", merged.cursor);
      }
      // Different item in hand → do nothing (collect-only, no swap/deposit).
      this.render();
      return;
    }
    const r = applySlotClick(this.cursor, this.standGet(slot));
    this.cursor = r.cursor;
    this.standSet(slot, r.slot);
    this.render();
  }

  /** Right-click a stand input slot: place one via applyRightClick. */
  private onStandSlotRightClick(slot: StandSlot): void {
    if (this.stand === null || slot === "output") return;
    const r = applyRightClick(this.cursor, this.standGet(slot));
    this.cursor = r.cursor;
    this.standSet(slot, r.slot);
    this.render();
  }

  /** Left-click a player inventory slot: cursor<->slot via applySlotClick. */
  private onInventorySlotClick(index: number): void {
    if (this.inventory === null) return;
    const r = applySlotClick(this.cursor, this.inventory.get(index));
    this.cursor = r.cursor;
    this.inventory.set(index, r.slot);
    this.render();
  }

  private onInventorySlotRightClick(index: number): void {
    if (this.inventory === null) return;
    const r = applyRightClick(this.cursor, this.inventory.get(index));
    this.cursor = r.cursor;
    this.inventory.set(index, r.slot);
    this.render();
  }

  private renderCursor(): void {
    if (this.cursorEl === null) return;
    if (this.cursor === null || this.cursor.count <= 0) {
      this.cursorEl.style.display = "none";
      return;
    }
    const v = slotView(this.cursor);
    this.cursorEl.textContent = `${v.label} ${String(v.count)}`;
    this.cursorEl.style.display = "block";
  }

  // --- DOM construction -------------------------------------------------------

  private build(): void {
    const host =
      document.getElementById("inventory-root") ??
      document.getElementById("hud") ??
      document.body;

    const root = document.createElement("div");
    root.id = "brewing-stand-screen";
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
    title.textContent = "Brewing Stand";
    title.style.color = "var(--text-secondary, #9a978f)";
    title.style.fontSize = "13px";
    title.style.fontWeight = "600";
    title.style.textTransform = "uppercase";
    title.style.letterSpacing = "0.06em";
    panel.appendChild(title);

    // --- Stand slots row: [Base] [Ingredient] [Fuel] → [Output] --------------
    const standRow = document.createElement("div");
    standRow.style.display = "flex";
    standRow.style.alignItems = "center";
    standRow.style.gap = "8px";

    const STAND_SLOTS: Array<{ key: StandSlot; label: string }> = [
      { key: "base", label: "Base" },
      { key: "ingredient", label: "Ingredient" },
      { key: "fuel", label: "Fuel" },
    ];

    for (const { key, label } of STAND_SLOTS) {
      const wrapper = document.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.flexDirection = "column";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "4px";

      const lbl = document.createElement("div");
      lbl.textContent = label;
      lbl.style.fontSize = "10px";
      lbl.style.color = "var(--text-muted, #5c5a54)";
      wrapper.appendChild(lbl);

      const cell = document.createElement("div");
      styleSlot(cell);
      const slotKey = key;
      cell.addEventListener("click", () => { this.onStandSlotClick(slotKey); });
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.onStandSlotRightClick(slotKey);
      });
      wrapper.appendChild(cell);
      this.standCells[key] = cell;
      standRow.appendChild(wrapper);
    }

    // Arrow separator
    const arrow = document.createElement("div");
    arrow.textContent = "→";
    arrow.style.color = "var(--text-muted, #5c5a54)";
    arrow.style.fontSize = "24px";
    arrow.style.margin = "0 4px";
    standRow.appendChild(arrow);

    // Output slot (collect-only; accented border like workbench output)
    const outputWrapper = document.createElement("div");
    outputWrapper.style.display = "flex";
    outputWrapper.style.flexDirection = "column";
    outputWrapper.style.alignItems = "center";
    outputWrapper.style.gap = "4px";

    const outputLbl = document.createElement("div");
    outputLbl.textContent = "Output";
    outputLbl.style.fontSize = "10px";
    outputLbl.style.color = "var(--text-muted, #5c5a54)";
    outputWrapper.appendChild(outputLbl);

    const outputCell = document.createElement("div");
    styleSlot(outputCell);
    outputCell.style.width = "44px";
    outputCell.style.height = "44px";
    outputCell.style.border = "2px solid var(--accent, #d4a843)";
    outputCell.addEventListener("click", () => { this.onStandSlotClick("output"); });
    outputCell.addEventListener("contextmenu", (e) => { e.preventDefault(); });
    this.standCells.output = outputCell;
    outputWrapper.appendChild(outputCell);
    standRow.appendChild(outputWrapper);

    panel.appendChild(standRow);

    // --- Progress line -------------------------------------------------------
    const progressEl = document.createElement("div");
    progressEl.style.fontSize = "11px";
    progressEl.style.color = "var(--text-secondary, #9a978f)";
    progressEl.textContent = "Brewing: 0%";
    this.progressEl = progressEl;
    panel.appendChild(progressEl);

    // --- Inventory grid (9×4) -----------------------------------------------
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
      cell.addEventListener("click", () => { this.onInventorySlotClick(idx); });
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.onInventorySlotRightClick(idx);
      });
      invGrid.appendChild(cell);
      this.invSlots.push(cell);
    }
    panel.appendChild(invGrid);

    // --- Floating cursor stack indicator ------------------------------------
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
      if (this.cursor !== null) {
        cursorEl.style.left = `${String(e.clientX + 12)}px`;
        cursorEl.style.top = `${String(e.clientY + 12)}px`;
      }
    });

    // Escape key: return cursor to inventory (the main.ts Escape chain also
    // calls close(), but this local handler is the inner guard).
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && this.open_) {
        if (this.cursor !== null) {
          this.returnCursorToInventory();
          this.render();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);

    root.appendChild(panel);
    root.appendChild(cursorEl);
    host.appendChild(root);
    this.root = root;
  }
}
