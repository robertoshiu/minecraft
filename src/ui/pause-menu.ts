/**
 * pause-menu.ts — the Esc pause overlay (Resume + Save).
 *
 * The open/closed state is plain boolean state on the class (testable without a
 * DOM); the overlay itself is built lazily and guarded so the whole class is
 * safe to construct and toggle under node. While open, the game loop freezes
 * ticks (the loop reads {@link PauseMenu.isOpen}).
 *
 * Styled with DESIGN.md tokens: `--bg-overlay` dim, `--bg-panel` card,
 * `--accent` Resume button, `--bg-slot` secondary Save button.
 */

/** Whether the DOM is available (false under node / unit tests). */
function hasDom(): boolean {
  return typeof document !== "undefined";
}

/** Optional callbacks the menu buttons invoke. */
export interface PauseMenuActions {
  onResume?: () => void;
  onSave?: () => void;
  onSettings?: () => void;
}

/** The Esc pause menu. Construct once; {@link toggle} on the Esc key. */
export class PauseMenu {
  private open_ = false;
  private root: HTMLElement | null = null;
  private readonly actions: PauseMenuActions;

  constructor(actions: PauseMenuActions = {}) {
    this.actions = actions;
    if (hasDom()) this.build();
  }

  /** Is the menu currently open? (The loop freezes ticks while true.) */
  isOpen(): boolean {
    return this.open_;
  }

  /** Open the menu. */
  open(): void {
    this.open_ = true;
    if (this.root !== null) this.root.style.display = "flex";
  }

  /** Close the menu. */
  close(): void {
    this.open_ = false;
    if (this.root !== null) this.root.style.display = "none";
  }

  /** Flip open/closed; returns the new open state. */
  toggle(): boolean {
    if (this.open_) this.close();
    else this.open();
    return this.open_;
  }

  // --- DOM construction (guarded) -----------------------------------------

  private build(): void {
    const host = document.getElementById("hud") ?? document.body;

    const root = document.createElement("div");
    root.id = "pause-menu";
    root.style.position = "fixed";
    root.style.inset = "0";
    root.style.display = "none";
    root.style.alignItems = "center";
    root.style.justifyContent = "center";
    root.style.zIndex = "40";
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
    card.style.gap = "16px";
    card.style.alignItems = "stretch";

    const heading = document.createElement("div");
    heading.textContent = "Paused";
    heading.style.color = "var(--text-primary, #e8e6e1)";
    heading.style.fontSize = "32px";
    heading.style.fontWeight = "700";
    heading.style.textAlign = "center";
    heading.style.marginBottom = "8px";
    card.appendChild(heading);

    const resume = document.createElement("button");
    resume.textContent = "Resume";
    styleButton(resume, "var(--accent, #d4a843)", "var(--bg-panel, #1a1d24)");
    resume.addEventListener("click", () => {
      this.close();
      this.actions.onResume?.();
    });
    card.appendChild(resume);

    const save = document.createElement("button");
    save.textContent = "Save";
    styleButton(
      save,
      "var(--bg-slot, #252830)",
      "var(--text-primary, #e8e6e1)",
    );
    save.addEventListener("click", () => {
      this.actions.onSave?.();
    });
    card.appendChild(save);

    const settings = document.createElement("button");
    settings.textContent = "Settings";
    styleButton(
      settings,
      "var(--bg-slot, #252830)",
      "var(--text-primary, #e8e6e1)",
    );
    settings.addEventListener("click", () => {
      this.actions.onSettings?.();
    });
    card.appendChild(settings);

    root.appendChild(card);
    host.appendChild(root);
    this.root = root;
  }
}

/** Shared button styling. */
function styleButton(btn: HTMLButtonElement, bg: string, fg: string): void {
  btn.style.padding = "10px 28px";
  btn.style.fontSize = "16px";
  btn.style.fontWeight = "600";
  btn.style.color = fg;
  btn.style.background = bg;
  btn.style.border = "none";
  btn.style.borderRadius = "6px";
  btn.style.cursor = "pointer";
}
