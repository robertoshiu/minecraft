/**
 * help-overlay.ts — a controls reference overlay (DOM, fully guarded).
 *
 * Shows key bindings (WASD / Space / Shift / mouse / LMB / RMB / E / Esc /
 * 1-9 / F5 / H). Toggle with H or "?"; close with Esc or H.
 * Styled with DESIGN.md tokens.
 */

/** Whether the DOM is available (false under node / unit tests). */
function hasDom(): boolean {
  return typeof document !== "undefined";
}

const CONTROLS: { keys: string; action: string }[] = [
  { keys: "W A S D", action: "Move" },
  { keys: "Space", action: "Jump" },
  { keys: "Shift", action: "Sprint" },
  { keys: "Mouse", action: "Look around" },
  { keys: "LMB", action: "Break block / Attack mob" },
  { keys: "RMB", action: "Place block / Open workbench" },
  { keys: "1 – 9", action: "Select hotbar slot" },
  { keys: "Scroll", action: "Cycle hotbar" },
  { keys: "E", action: "Open inventory" },
  { keys: "Esc", action: "Pause menu / Close screen" },
  { keys: "H  /  ?", action: "Toggle this help overlay" },
  { keys: "F5", action: "Save game" },
];

/**
 * The controls help overlay. Construct once; call {@link toggle}/{@link open}/
 * {@link close} to control visibility. Read {@link isOpen} in the game loop
 * for modal gating (the help overlay freezes gameplay while shown).
 */
export class HelpOverlay {
  private open_ = false;
  private root: HTMLElement | null = null;

  constructor() {
    if (hasDom()) this.build();
  }

  /** Is the overlay currently open? */
  isOpen(): boolean {
    return this.open_;
  }

  /** Open the overlay. */
  open(): void {
    this.open_ = true;
    if (this.root !== null) this.root.style.display = "flex";
  }

  /** Close the overlay. */
  close(): void {
    this.open_ = false;
    if (this.root !== null) this.root.style.display = "none";
  }

  /** Toggle open/closed. */
  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  // --- DOM construction (guarded) ------------------------------------------

  private build(): void {
    const host = document.getElementById("hud") ?? document.body;

    const root = document.createElement("div");
    root.id = "help-overlay";
    root.style.position = "fixed";
    root.style.inset = "0";
    root.style.display = "none";
    root.style.alignItems = "center";
    root.style.justifyContent = "center";
    root.style.zIndex = "60";
    root.style.pointerEvents = "auto";
    root.style.background = "var(--bg-overlay, rgba(0,0,0,0.55))";
    root.style.backdropFilter = "blur(8px)";

    const card = document.createElement("div");
    card.style.background = "var(--bg-panel, #1a1d24)";
    card.style.border = "1px solid var(--slot-border, #3a3d45)";
    card.style.borderRadius = "8px";
    card.style.padding = "28px 36px";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.gap = "10px";
    card.style.minWidth = "340px";
    card.style.maxWidth = "480px";

    const heading = document.createElement("div");
    heading.textContent = "Controls";
    heading.style.color = "var(--text-primary, #e8e6e1)";
    heading.style.fontSize = "24px";
    heading.style.fontWeight = "700";
    heading.style.textAlign = "center";
    heading.style.marginBottom = "4px";
    card.appendChild(heading);

    const table = document.createElement("table");
    table.style.borderCollapse = "collapse";
    table.style.width = "100%";

    for (const { keys, action } of CONTROLS) {
      const tr = document.createElement("tr");

      const tdKey = document.createElement("td");
      tdKey.textContent = keys;
      tdKey.style.padding = "4px 12px 4px 0";
      tdKey.style.color = "var(--accent, #d4a843)";
      tdKey.style.fontSize = "13px";
      tdKey.style.fontWeight = "600";
      tdKey.style.fontFamily = "monospace";
      tdKey.style.whiteSpace = "nowrap";

      const tdAction = document.createElement("td");
      tdAction.textContent = action;
      tdAction.style.padding = "4px 0";
      tdAction.style.color = "var(--text-primary, #e8e6e1)";
      tdAction.style.fontSize = "14px";

      tr.appendChild(tdKey);
      tr.appendChild(tdAction);
      table.appendChild(tr);
    }
    card.appendChild(table);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Close  [H]";
    closeBtn.style.marginTop = "8px";
    closeBtn.style.padding = "8px 20px";
    closeBtn.style.fontSize = "14px";
    closeBtn.style.fontWeight = "600";
    closeBtn.style.color = "var(--bg-panel, #1a1d24)";
    closeBtn.style.background = "var(--accent, #d4a843)";
    closeBtn.style.border = "none";
    closeBtn.style.borderRadius = "6px";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.alignSelf = "center";
    closeBtn.addEventListener("click", () => { this.close(); });
    card.appendChild(closeBtn);

    root.appendChild(card);
    host.appendChild(root);
    this.root = root;
  }
}
