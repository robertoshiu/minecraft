/**
 * survival-hud.ts — reflects the player's survival economy + day/night clock
 * into the existing HUD DOM (`#health-bar`, `#hunger-bar`, `#day-counter`).
 *
 * Health is shown as 10 hearts (each = 2 HP) → full / half / empty; hunger as
 * 10 shanks (each = 2 food) the same way. The day counter shows `Day {n}` plus
 * a sun/moon glyph chosen by the clock's phase. The base look (heart/shank/
 * day-counter styling, incl. the `.half` gradient) lives in hud.css.
 *
 * DOM is optional: when the elements are absent (NullEngine / unit tests) every
 * branch is a silent no-op, so it never breaks headless runs.
 */

import type { SurvivalState } from "../survival/stats";
import type { Clock } from "../time/clock";
import { dayNumber, phase } from "../time/clock";

/** Number of heart / shank pips (each represents 2 points). */
const PIPS = 10;
/** Points represented by a single pip (2 HP per heart, 2 food per shank). */
const POINTS_PER_PIP = 2;

/** Fill state of a single pip. */
type Fill = "full" | "half" | "empty";

/**
 * Decompose a 0..20 stat into 10 pip fill states. Each pip covers 2 points:
 * >= its full threshold → full, >= half → half, else empty.
 */
function pipFills(value: number): Fill[] {
  const fills: Fill[] = [];
  for (let i = 0; i < PIPS; i++) {
    const base = i * POINTS_PER_PIP;
    if (value >= base + POINTS_PER_PIP) fills.push("full");
    else if (value >= base + 1) fills.push("half");
    else fills.push("empty");
  }
  return fills;
}

/** Apply a fill state to a pip element by toggling the `half`/`empty` classes. */
function applyPip(el: HTMLElement, fill: Fill): void {
  el.classList.toggle("half", fill === "half");
  el.classList.toggle("empty", fill === "empty");
}

/** A sun/moon glyph for the current day phase. */
function phaseGlyph(clock: Clock): string {
  switch (phase(clock)) {
    case "day":
      return "☀"; // ☀ sun
    case "sunset":
      return "⛅"; // ⛅ sun behind cloud
    case "night":
      return "☾"; // ☾ moon
    case "sunrise":
      return "⛅"; // ⛅
    default:
      return "☀";
  }
}

/**
 * Update the survival HUD to mirror `survival` + `clock`. Guarded so it is
 * inert when the HUD DOM is not present.
 */
export function updateSurvivalHud(survival: SurvivalState, clock: Clock): void {
  if (typeof document === "undefined") return;

  const healthBar = document.getElementById("health-bar");
  if (healthBar !== null) {
    const hearts = healthBar.querySelectorAll<HTMLElement>(".heart");
    const fills = pipFills(survival.health);
    fills.forEach((fill, i) => {
      const el = hearts[i];
      if (el !== undefined) applyPip(el, fill);
    });
  }

  const hungerBar = document.getElementById("hunger-bar");
  if (hungerBar !== null) {
    const shanks = hungerBar.querySelectorAll<HTMLElement>(".shank");
    const fills = pipFills(survival.food);
    fills.forEach((fill, i) => {
      const el = shanks[i];
      if (el !== undefined) applyPip(el, fill);
    });
  }

  const dayCounter = document.getElementById("day-counter");
  if (dayCounter !== null) {
    dayCounter.textContent = `${phaseGlyph(clock)} Day ${dayNumber(clock)}`;
  }
}
