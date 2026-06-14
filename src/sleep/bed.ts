/**
 * bed.ts — pure, testable sleep logic.
 *
 * canSleep: returns true iff the current time-of-day is in the night phase
 *           (NIGHT_START..SUNRISE_START, i.e. ticks 13000..22999).
 *
 * sleepToDawn: advances the clock FORWARD (monotonic — never decreases
 *              totalTicks) to the next morning. The target tod is 0 (the
 *              very start of the new day), which is firmly within the
 *              morning band [0..1000). Delta is guaranteed > 0 because
 *              we always skip to the NEXT day's dawn, not the current one.
 *
 * Pure data + tiny logic. No Babylon imports, no side-effects.
 */

import { TIME } from "../rules/mc-1.20";
import { type Clock, isNight, tickOfDay, advance } from "../time/clock";

export { isNight as canSleep };

/**
 * Advance the clock forward to the start of the next day (tickOfDay === 0).
 * Always moves time FORWARD by at least one tick — safe to call from any
 * time-of-day, but intended for use when isNight(clock) is true.
 */
export function sleepToDawn(clock: Clock): void {
  const tod = tickOfDay(clock);
  // Ticks remaining in the current day, then land at 0 of the next day.
  // If tod is already 0 we still skip a full day so totalTicks always grows.
  const ticksRemaining = TIME.TICKS_PER_DAY - tod;
  advance(clock, ticksRemaining);
}
