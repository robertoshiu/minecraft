/**
 * mining-hud.ts — mining progress bar HUD updater.
 *
 * Reflects the current mining timer (`mining.elapsed` / `breakTicks(...)`)
 * into a small horizontal progress bar centered under the crosshair
 * (`#mining-progress` > `#mining-progress-fill`). Hidden by default; the
 * fixed tick in main.ts calls `setMiningProgress` every tick while mining is
 * active and passes `null` (via resetMining) to hide it.
 *
 * `miningFraction` is pure and unit-tested; `setMiningProgress`'s DOM
 * mutation is guarded by `typeof document === "undefined"` so it is inert
 * headless (mirrors armor-hud / survival-hud).
 */

/**
 * Clamp `elapsed / total` to a 0..1 fraction.
 * `total` non-finite (e.g. Infinity, an unbreakable block) or <= 0 → 0.
 */
export function miningFraction(elapsed: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const frac = elapsed / total;
  if (frac < 0) return 0;
  if (frac > 1) return 1;
  return frac;
}

/**
 * Show/update/hide the mining progress bar.
 * `fraction === null` hides the bar; otherwise it is clamped to 0..1 and
 * reflected as the fill width. Inert when the HUD DOM is absent.
 */
export function setMiningProgress(fraction: number | null): void {
  if (typeof document === "undefined") return;
  const bar = document.getElementById("mining-progress");
  if (bar === null) return;

  if (fraction === null) {
    bar.style.display = "none";
    return;
  }

  const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
  bar.style.display = "block";
  const fill = document.getElementById("mining-progress-fill");
  if (fill !== null) {
    fill.style.width = `${(clamped * 100).toFixed(1)}%`;
  }
}
