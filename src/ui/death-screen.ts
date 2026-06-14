/**
 * death-screen.ts — the full-screen "You Died" overlay.
 *
 * A tiny module-level singleton overlay (built lazily the first time it is
 * shown) with a death-cause subtitle and a Respawn button. The pure open-state
 * machine ({@link DeathScreenState}) is testable without a DOM; the DOM build +
 * show/hide are guarded so they no-op under node.
 *
 * Styled with DESIGN.md tokens: `--bg-overlay` dim, `--hp-full` title, and an
 * `--accent` Respawn button (see DESIGN.md › Death Screen).
 */

/** Whether the DOM is available (false under node / unit tests). */
function hasDom(): boolean {
  return typeof document !== "undefined";
}

/**
 * Pure open-state machine for the death screen. Tracks whether the screen is
 * shown and the current cause string — separated from the DOM so the loop's
 * "show once on death, hide on respawn" gating is unit-testable.
 */
export class DeathScreenState {
  private shown = false;
  private cause_ = "";

  isShown(): boolean {
    return this.shown;
  }

  cause(): string {
    return this.cause_;
  }

  /** Mark shown with a cause; returns true only on the rising edge (first show). */
  show(cause: string): boolean {
    if (this.shown) return false;
    this.shown = true;
    this.cause_ = cause;
    return true;
  }

  /** Mark hidden; returns true only on the falling edge (first hide). */
  hide(): boolean {
    if (!this.shown) return false;
    this.shown = false;
    this.cause_ = "";
    return true;
  }
}

// --- DOM singleton ---------------------------------------------------------

let overlay: HTMLElement | null = null;
let subtitleEl: HTMLElement | null = null;
let respawnBtn: HTMLButtonElement | null = null;
let respawnHandler: (() => void) | null = null;

function build(): void {
  if (!hasDom() || overlay !== null) return;

  const host =
    document.getElementById("hud") ?? document.body;

  const root = document.createElement("div");
  root.id = "death-screen";
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.display = "none";
  root.style.flexDirection = "column";
  root.style.alignItems = "center";
  root.style.justifyContent = "center";
  root.style.gap = "20px";
  root.style.zIndex = "50";
  root.style.pointerEvents = "auto";
  root.style.background = "var(--bg-overlay, rgba(0,0,0,0.55))";
  root.style.backdropFilter = "blur(12px)";

  const title = document.createElement("div");
  title.textContent = "You Died";
  title.style.color = "var(--hp-full, #c43838)";
  title.style.fontSize = "48px";
  title.style.fontWeight = "700";
  title.style.letterSpacing = "0.01em";
  root.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.style.color = "var(--text-secondary, #9a978f)";
  subtitle.style.fontSize = "16px";
  root.appendChild(subtitle);
  subtitleEl = subtitle;

  const btn = document.createElement("button");
  btn.textContent = "Respawn";
  btn.style.padding = "10px 28px";
  btn.style.fontSize = "16px";
  btn.style.fontWeight = "600";
  btn.style.color = "var(--bg-panel, #1a1d24)";
  btn.style.background = "var(--accent, #d4a843)";
  btn.style.border = "none";
  btn.style.borderRadius = "6px";
  btn.style.cursor = "pointer";
  btn.addEventListener("click", () => {
    respawnHandler?.();
  });
  root.appendChild(btn);
  respawnBtn = btn;

  host.appendChild(root);
  overlay = root;
}

/**
 * Show the death overlay with a `cause` subtitle, invoking `onRespawn` when the
 * Respawn button is clicked. No-op without a DOM.
 */
export function showDeath(cause: string, onRespawn: () => void): void {
  if (!hasDom()) return;
  build();
  respawnHandler = onRespawn;
  if (subtitleEl !== null) subtitleEl.textContent = cause;
  if (overlay !== null) overlay.style.display = "flex";
  respawnBtn?.focus();
}

/** Hide the death overlay. No-op without a DOM. */
export function hideDeath(): void {
  if (overlay !== null) overlay.style.display = "none";
  respawnHandler = null;
}
