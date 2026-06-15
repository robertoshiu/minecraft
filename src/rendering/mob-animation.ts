/**
 * mob-animation.ts — Pure, Babylon-free, deterministic mob animation math.
 *
 * All exports are stateless functions or constants. No imports from Babylon.js
 * or any scene/mesh types. This makes every function unit-testable without
 * spinning up a render engine.
 */

/** Per-species gait tuning. freq is rad per tick-equivalent; amp is max swing (rad). */
export interface GaitParams {
  freq: number;
  amp: number;
}

/** Default gait matching the legacy hardcoded numbers (sin(age*0.3)*0.5). */
export const DEFAULT_GAIT: GaitParams = { freq: 0.3, amp: 0.5 };

/** Leg rotation.x for one pivot. `t` is a CONTINUOUS clock; `phase` is 0 or PI per leg. */
export function legSwing(t: number, phase: number, gait: GaitParams): number {
  return Math.sin(t * gait.freq + phase) * gait.amp;
}

/** Ease a resting pivot angle toward 0. Multiplier 0.8 matches legacy. */
export function easeToRest(current: number, factor = 0.8): number {
  return current * factor;
}

/** Vertical idle bob (body y offset, blocks). Small, slow, continuous. */
export function idleBob(t: number, amp = 0.02, freq = 0.12): number {
  return Math.sin(t * freq) * amp;
}

/** Tail/ear sway angle (rad). Faster, low amplitude. */
export function tailSway(t: number, amp = 0.25, freq = 0.5): number {
  return Math.sin(t * freq) * amp;
}

/** Head pitch toward a target relative height. dyEyes = (targetY - headY). Clamped. */
export function headPitch(dyEyes: number, clamp = 0.6): number {
  const p = Math.atan2(dyEyes, 1);
  return Math.max(-clamp, Math.min(clamp, p));
}

/** True iff the mob took damage within `graceTicks` of `currentTick`. */
export function recentlyDamaged(lastDamageTick: number, currentTick: number, graceTicks = 4): boolean {
  const dt = currentTick - lastDamageTick;
  return dt >= 0 && dt < graceTicks;
}

/** Total ms a dying mob lingers before disposal. */
export const DEATH_GRACE_MS = 450;

export interface DeathGraceState {
  progress: number; // 0..1
  expired: boolean;
}

/** Pure: compute death-grace progress from elapsed ms. */
export function deathGrace(elapsedMs: number, totalMs = DEATH_GRACE_MS): DeathGraceState {
  const progress = Math.min(1, Math.max(0, elapsedMs / totalMs));
  return { progress, expired: elapsedMs >= totalMs };
}

/** Visual scale for a dying mob (shrinks to 0 over the tween). */
export function deathScale(progress: number): number {
  return 1 - progress;
}

/**
 * Deterministic per-individual tint multiplier. Each channel ~0.85..1.0, and
 * different mob ids produce different tints (no Math.random). Uses Math.imul
 * 32-bit mixing and extracts the HIGH byte (which varies reliably), with a
 * per-channel salt so the three channels differ.
 */
export function tintFor(mobId: number): [number, number, number] {
  const mix = (n: number): number => {
    let x = (n ^ 0x9e3779b9) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  };
  const chan = (salt: number): number => {
    const h = mix((Math.imul(mobId, 0x9e3779b1) + salt) >>> 0);
    return 0.85 + ((h >>> 24) / 255) * 0.15; // high byte → [0.85, 1.0]
  };
  return [chan(1), chan(2), chan(3)];
}
