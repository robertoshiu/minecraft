/**
 * persistence.ts — save/reload for live mobs (review D4: mobs must survive a
 * save/reload cycle).
 *
 * Two layers:
 *  1. A plain-data {@link MobSave} snapshot (`toMobSave` / `fromMobSave`) that
 *     flattens a {@link Mob}'s `feet`/`velocity` vectors into scalar fields and
 *     captures every other piece of gameplay state.
 *  2. A byte encoding ({@link encodeMobs} / {@link decodeMobs}). v1 uses JSON
 *     serialized through {@link TextEncoder}/{@link TextDecoder} — simple, debuggable,
 *     and round-trip-exact for our numeric/string/boolean fields. A binary format
 *     can replace this later without changing the {@link MobSave} contract.
 *
 * NOTE on what is persisted: a MobSave carries the fields the design review
 * called out (identity, position, velocity, health, AI bookkeeping, breeding,
 * fuse, and the open `extra` map). Transient/derived fields — `onGround`
 * (recomputed by physics on the next tick), `target` (re-acquired by AI), and
 * `yaw` (cosmetic facing) — are intentionally NOT saved; they reset to their
 * fresh-spawn defaults on reload.
 */

import { Mob, type AiState, type Vec3 } from "./entity";
import type { MobType } from "../rules/mob-stats";
import { type EffectState, applyEffect, effectTypeFromId, EFFECT_TYPE_IDS } from "../effects/status";
import type { EffectSave } from "../save/serialize";

/** The set of valid {@link AiState} strings, used to validate decoded data. */
const AI_STATES: readonly AiState[] = [
  "idle",
  "wander",
  "chase",
  "attack",
  "flee",
  "fuse",
];

/**
 * A flat, plain-data snapshot of a {@link Mob}, suitable for JSON/byte
 * serialization. `feet` is stored as `x/y/z` and `velocity` as `vx/vy/vz`.
 */
export interface MobSave {
  id: number;
  type: MobType;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  health: number;
  aiState: string;
  aiTimer: number;
  age: number;
  lastDamageTick: number;
  breedCooldown: number;
  inLove: boolean;
  fuseTimer: number;
  extra: Record<string, number>;
  /**
   * Active status effects (Phase 6c). Same EffectSave shape the player uses
   * ({type,amplifier,ticksRemaining}). OPTIONAL: omitted entirely when the mob
   * has none (and absent on pre-v8 blobs) → restored as no effects. periodTimer
   * is scratch and is NOT saved (reset to 0 on load).
   */
  effects?: EffectSave[];
}

/** Coerce a decoded `aiState` string back to a valid {@link AiState}. */
function toAiState(s: string): AiState {
  return (AI_STATES as readonly string[]).includes(s) ? (s as AiState) : "idle";
}

/** Shallow-copy a numeric map so saves never alias the live mob's `extra`. */
function copyExtra(extra: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(extra)) {
    const value = extra[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Flatten a mob's EffectState into save shape (3 ints each; periodTimer dropped). */
function snapshotMobEffects(effects: EffectState): EffectSave[] {
  return effects.list.map((e) => ({
    type: EFFECT_TYPE_IDS[e.type],
    amplifier: e.amplifier,
    ticksRemaining: e.ticksRemaining,
  }));
}

/** Snapshot a single live {@link Mob} into a plain {@link MobSave}. */
export function toMobSave(mob: Mob): MobSave {
  const save: MobSave = {
    id: mob.id,
    type: mob.type,
    x: mob.feet.x,
    y: mob.feet.y,
    z: mob.feet.z,
    vx: mob.velocity.x,
    vy: mob.velocity.y,
    vz: mob.velocity.z,
    health: mob.health,
    aiState: mob.aiState,
    aiTimer: mob.aiTimer,
    age: mob.age,
    lastDamageTick: mob.lastDamageTick,
    breedCooldown: mob.breedCooldown,
    inLove: mob.inLove,
    fuseTimer: mob.fuseTimer,
    extra: copyExtra(mob.extra),
  };
  const fx = snapshotMobEffects(mob.effects);
  if (fx.length > 0) save.effects = fx; // omit the key entirely when empty
  return save;
}

/** Snapshot a list of live mobs. */
export function serializeMobs(mobs: Mob[]): MobSave[] {
  return mobs.map(toMobSave);
}

/**
 * Reconstruct a live {@link Mob} from a {@link MobSave}, restoring every saved
 * field. Transient fields (`onGround`, `target`, `yaw`) reset to fresh-spawn
 * defaults — see the file header.
 */
export function fromMobSave(s: MobSave): Mob {
  const spawn: Vec3 = { x: s.x, y: s.y, z: s.z };
  const mob = new Mob(s.id, s.type, spawn);
  mob.velocity = { x: s.vx, y: s.vy, z: s.vz };
  mob.health = s.health;
  mob.aiState = toAiState(s.aiState);
  mob.aiTimer = s.aiTimer;
  mob.age = s.age;
  mob.lastDamageTick = s.lastDamageTick;
  mob.breedCooldown = s.breedCooldown;
  mob.inLove = s.inLove;
  mob.fuseTimer = s.fuseTimer;
  mob.extra = copyExtra(s.extra);
  // Restore active effects (Phase 6c). Missing on pre-v8 blobs → none.
  for (const fx of s.effects ?? []) {
    const type = effectTypeFromId(fx.type);
    if (type === null) continue; // unknown id → skip (forward-compat)
    // applyEffect re-creates the ActiveEffect with periodTimer=0 (scratch reset).
    applyEffect(mob.effects, type, fx.amplifier, fx.ticksRemaining);
  }
  return mob;
}

/** Reconstruct a list of live mobs from saves. */
export function deserializeMobs(saves: MobSave[]): Mob[] {
  return saves.map(fromMobSave);
}

/**
 * Encode mobs to bytes. v1: JSON serialized through {@link TextEncoder} (UTF-8).
 * Chosen for simplicity and exact round-tripping of our numeric/string/boolean
 * fields; a compact binary layout can replace this later behind the same API.
 */
export function encodeMobs(mobs: Mob[]): Uint8Array {
  const json = JSON.stringify(serializeMobs(mobs));
  return new TextEncoder().encode(json);
}

/** Decode bytes produced by {@link encodeMobs} back into {@link MobSave}s. */
export function decodeMobs(bytes: Uint8Array): MobSave[] {
  const json = new TextDecoder().decode(bytes);
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error("decodeMobs: expected a JSON array of MobSave");
  }
  return parsed as MobSave[];
}
