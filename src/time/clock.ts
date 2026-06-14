/**
 * clock.ts — the monotonic game clock that drives the day/night cycle.
 *
 * CORRECTNESS NOTE (review U5): the clock stores a single MONOTONIC counter
 * (`totalTicks`) that only ever grows; it is NEVER wrapped in place. The
 * time-of-day and day number are *derived* from it on demand. Wrapping a single
 * mutable counter in place is the classic source of off-by-one drift and
 * "frozen day counter" bugs — so we never do it. `tickOfDay` is also
 * negative-safe (the start tick may be negative) via a double-modulo.
 *
 * Pure data + small pure functions. Phase boundaries come from {@link TIME} in
 * the rules module, the single source of truth for game constants.
 */

import { TIME } from "../rules/mc-1.20";

/**
 * The game clock. `totalTicks` is a monotonic counter of game ticks elapsed
 * since the world began (default 0). It never wraps — derive everything else.
 */
export interface Clock {
  totalTicks: number;
}

/** Create a clock starting at `startTick` game ticks (default 0). */
export function makeClock(startTick = 0): Clock {
  return { totalTicks: startTick };
}

/**
 * Advance the clock by `ticks`. Purely additive and monotonic: the counter
 * never wraps around at a day boundary, it simply keeps growing.
 */
export function advance(c: Clock, ticks: number): void {
  c.totalTicks += ticks;
}

/**
 * The tick within the current day, always in `[0, TICKS_PER_DAY)`.
 *
 * Uses a double-modulo so the result is correct (non-negative) even when
 * `totalTicks` is negative — JavaScript's `%` keeps the sign of the dividend.
 */
export function tickOfDay(c: Clock): number {
  const d = TIME.TICKS_PER_DAY;
  return ((c.totalTicks % d) + d) % d;
}

/**
 * The 1-based day number. Day 1 begins at `totalTicks === 0`; Day 2 begins at
 * `totalTicks === TICKS_PER_DAY`, and so on.
 */
export function dayNumber(c: Clock): number {
  return Math.floor(c.totalTicks / TIME.TICKS_PER_DAY) + 1;
}

/** A coarse segment of the day/night cycle. */
export type Phase = "day" | "sunset" | "night" | "sunrise";

/**
 * The current {@link Phase}, derived from {@link tickOfDay}:
 *   day     [DAY_START,     SUNSET_START)  = [0,     12000)
 *   sunset  [SUNSET_START,  NIGHT_START)   = [12000, 13000)
 *   night   [NIGHT_START,   SUNRISE_START) = [13000, 23000)
 *   sunrise [SUNRISE_START, TICKS_PER_DAY) = [23000, 24000)
 */
export function phase(c: Clock): Phase {
  const tod = tickOfDay(c);
  if (tod < TIME.SUNSET_START) return "day";
  if (tod < TIME.NIGHT_START) return "sunset";
  if (tod < TIME.SUNRISE_START) return "night";
  return "sunrise";
}

/**
 * True while it is night (the `night` phase, `[NIGHT_START, SUNRISE_START)`).
 * This is the signal hostile-mob spawning keys off of.
 */
export function isNight(c: Clock): boolean {
  return phase(c) === "night";
}
