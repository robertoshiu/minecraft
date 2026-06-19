/**
 * mob-driver.ts — the live-game glue that owns mob spawning, AI, and combat.
 *
 * The pure mob LOGIC layer (src/mobs/*) is framerate-independent and Babylon-free.
 * This driver is the integration seam: it holds a {@link MobManager}, runs the
 * spawn ring + AI + combat hooks against the real {@link World}, bridges damage
 * into the player's survival economy, applies explosions back through the
 * renderer's remesh notifier, grants drops on player kills, and despawns far/idle
 * mobs. It owns NO rendering — {@link MobRenderer} consumes `manager.all()`.
 *
 * Skylight: column skylight is computed via {@link computeColumnSkylight} and
 * cached per column key. v1 invalidates lazily by simply never caching stale
 * data across edits that matter for spawn gating (recompute-on-miss is cheap and
 * correct enough — block edits that change a column's skylight are rare relative
 * to spawn cadence). The cache is keyed `"cx,cz"`, matching {@link World}.
 */

import { World } from "../world/world";
import type { RemeshNotifier } from "../rendering/world-renderer";
import type { Player } from "../player/controller";
import type { Clock } from "../time/clock";
import { isNight } from "../time/clock";
import { makeStack } from "../inventory/stack";
import type { ItemDef, ToolTier } from "../rules/items";
import { knockbackImpulse } from "../combat/knockback";
import { applyPlayerDamage, applyPlayerKnockback } from "../combat/player-damage";

import { MobManager } from "../mobs/manager";
import { Mob, type Vec3 } from "../mobs/entity";
import { tickPassive, type Rng } from "../mobs/passive-ai";
import { tickMobEffects } from "../mobs/effects";
import {
  tickHostile,
  type CombatHooks,
  type BlockQuery,
} from "../mobs/hostile-ai";
import { explode } from "../mobs/explosion";
import {
  canSpawnHostileAt,
  canSpawnPassiveAt,
  canSpawnMore,
  shouldDespawn,
  randomSpawnOffset,
  type MobKind,
} from "../mobs/spawn-rules";
import { computeColumnSkylight, skylightAt, type LightMap } from "../world/lighting";

import {
  MOB_STATS,
  MOB_DROPS,
  PASSIVE_TYPES,
  HOSTILE_TYPES,
  type MobType,
} from "../rules/mob-stats";

/** Half-hearts a single player melee swing deals to a mob (v1: fists, no sword bonus). */
export const PLAYER_ATTACK_DAMAGE = 4;

/** Sword damage per tier, in half-hearts (fists = PLAYER_ATTACK_DAMAGE = 4). */
const SWORD_DAMAGE: Record<ToolTier, number> = {
  wood: 6,
  stone: 8,
  iron: 10,
  diamond: 14,
  gold: 6,
};

/**
 * Half-hearts a melee hit deals given the held item. A sword deals its tier
 * value; anything else (fists, non-sword tools, blocks, food) deals
 * PLAYER_ATTACK_DAMAGE.
 */
export function attackDamageFor(heldDef: ItemDef | null): number {
  if (
    heldDef !== null &&
    heldDef.kind === "tool" &&
    heldDef.toolType === "sword" &&
    heldDef.toolTier !== undefined
  ) {
    return SWORD_DAMAGE[heldDef.toolTier];
  }
  return PLAYER_ATTACK_DAMAGE;
}

/** Attempt a spawn roughly every this many ticks. */
const SPAWN_INTERVAL_TICKS = 20;

/**
 * Distance (blocks) beyond which a mob accrues "far from player" ticks; matches
 * the despawn-rules threshold so the two agree.
 */
const FAR_DISTANCE = 64;

/** How far below the spawn candidate we scan for the first solid surface. */
const SURFACE_SCAN_TOP = 200;

/** Reach (blocks) within which a freshly-dead mob counts as a player kill. */
const KILL_CREDIT_RANGE = 6;

/** Creeper blast power (matches the explosion contract: creeper = 3). */
const CREEPER_POWER = 3;

/** Horizontal knockback strength of a creeper blast (vs the default melee shove). */
const CREEPER_BLAST_KNOCKBACK = 0.8;

/** Column extent (blocks); must match the World's column size. */
const COLUMN_SIZE = 16;

/** worldX/worldZ → column index. */
function toColumn(world: number): number {
  return Math.floor(world / COLUMN_SIZE);
}

/** worldX/worldZ → local 0..15 within its column (handles negatives). */
function toLocal(world: number): number {
  return ((world % COLUMN_SIZE) + COLUMN_SIZE) % COLUMN_SIZE;
}

/** Euclidean distance between two points. */
function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** Pick a uniform element of `arr` using `rng`; throws only on an empty array. */
function pick<T>(arr: readonly T[], rng: Rng): T {
  const i = Math.min(arr.length - 1, Math.floor(rng() * arr.length));
  const v = arr[i];
  if (v === undefined) throw new Error("pick: empty array");
  return v;
}

/** Per-mob despawn bookkeeping (how long the mob has been far from the player). */
interface MobBookkeeping {
  ticksFarFromPlayer: number;
}

/**
 * Optional audio callbacks. Set {@link MobDriver.audioCallbacks} after
 * construction. All fields are optional — absent callbacks are simply skipped.
 * This is intentionally minimal so the audio layer remains an optional add-on
 * and existing tests need no changes.
 */
export interface MobAudioCallbacks {
  onSpawn?: (type: MobType, pos: Vec3) => void;
  onHurt?: (pos: Vec3) => void;
  onDeath?: (type: MobType, pos: Vec3) => void;
  onCreeperFuse?: (pos: Vec3) => void;
  onExplosion?: (pos: Vec3) => void;
}

/**
 * Owns + drives the live mob population: spawning, AI, combat, despawn, drops.
 */
export class MobDriver {
  /** The mob registry (also consumed by the renderer + persistence). */
  readonly manager = new MobManager();

  private readonly world: World;
  private readonly renderer: RemeshNotifier;

  /** Per-column skylight cache, keyed `"cx,cz"`. */
  private readonly skylightCache = new Map<string, LightMap>();

  /** Per-mob bookkeeping keyed by mob id. */
  private readonly bookkeeping = new Map<number, MobBookkeeping>();

  /** Tick of the most recent spawn attempt (drives the ~40-tick cadence). */
  private lastSpawnTick = Number.NEGATIVE_INFINITY;

  /**
   * Optional audio event hooks — set from the outside (e.g. main.ts) after
   * construction. Kept as a plain mutable field so no constructor changes are
   * needed and the existing test suite requires zero modifications.
   */
  audioCallbacks: MobAudioCallbacks | null = null;

  constructor(world: World, renderer: RemeshNotifier) {
    this.world = world;
    this.renderer = renderer;
  }

  /** Bound `World.isSolidAt` for the mob physics/AI queries. */
  private isSolid = (bx: number, by: number, bz: number): boolean =>
    this.world.isSolidAt(bx, by, bz);

  /** Bound `World.getBlock` as the hostile-AI line-of-sight block query. */
  private getBlock: BlockQuery = (bx, by, bz) => this.world.getBlock(bx, by, bz);

  /**
   * Skylight (0..15) at the given world position. Computes + caches the owning
   * column's {@link LightMap} on demand. Out-of-height reads resolve to 0 (dark).
   */
  skylightAtWorld(wx: number, wy: number, wz: number): number {
    if (!Number.isInteger(wy) || wy < 0 || wy > 255) return 0;
    const cx = toColumn(wx);
    const cz = toColumn(wz);
    const key = World.columnKey(cx, cz);
    let map = this.skylightCache.get(key);
    if (map === undefined) {
      const column = this.world.ensureColumn(cx, cz);
      map = computeColumnSkylight(column);
      this.skylightCache.set(key, map);
    }
    return skylightAt(map, toLocal(wx), wy, toLocal(wz));
  }

  /** Drop the cached skylight for the column owning (wx, wz) (after edits). */
  invalidateSkylightAt(wx: number, wz: number): void {
    this.skylightCache.delete(World.columnKey(toColumn(wx), toColumn(wz)));
  }

  /**
   * Attempt a spawn roughly every {@link SPAWN_INTERVAL_TICKS} ticks.
   *
   * Picks a point in the [24,128] ring around the player, finds the surface
   * (first solid scanning down, with 2 air above), computes skylight there, and
   * gates on day/night + light + footprint + the per-kind cap before spawning a
   * random type of the active category via the {@link MobManager}.
   */
  spawnTick(playerFeet: Vec3, clock: Clock, rng: Rng): void {
    if (clock.totalTicks - this.lastSpawnTick < SPAWN_INTERVAL_TICKS) return;
    this.lastSpawnTick = clock.totalTicks;

    const { dx, dz } = randomSpawnOffset(rng);
    const wx = Math.floor(playerFeet.x + dx);
    const wz = Math.floor(playerFeet.z + dz);

    // Find the surface: first solid block scanning down, with two air cells above.
    let floorY: number | null = null;
    for (let y = SURFACE_SCAN_TOP; y >= 1; y--) {
      if (
        this.world.isSolidAt(wx, y, wz) &&
        !this.world.isSolidAt(wx, y + 1, wz) &&
        !this.world.isSolidAt(wx, y + 2, wz)
      ) {
        floorY = y;
        break;
      }
    }
    if (floorY === null) return;

    const feetY = floorY + 1; // standing on top of the floor block
    const skylight = this.skylightAtWorld(wx, feetY, wz);
    const night = isNight(clock);
    const hasHeadroom = !this.world.isSolidAt(wx, feetY + 1, wz);

    const spawn: Vec3 = { x: wx + 0.5, y: feetY, z: wz + 0.5 };

    if (night) {
      const ok = canSpawnHostileAt(skylight, night, true, hasHeadroom);
      if (!ok) return;
      const kind: MobKind = "hostile";
      if (!canSpawnMore(kind, this.manager.countHostile())) return;
      const type = pick<MobType>(HOSTILE_TYPES, rng);
      this.manager.spawn(type, spawn);
      this.audioCallbacks?.onSpawn?.(type, spawn);
    } else {
      const floorBlock = this.world.getBlock(wx, floorY, wz);
      const ok = canSpawnPassiveAt(skylight, night, floorBlock, hasHeadroom);
      if (!ok) return;
      const kind: MobKind = "passive";
      if (!canSpawnMore(kind, this.manager.countPassive())) return;
      const type = pick<MobType>(PASSIVE_TYPES, rng);
      this.manager.spawn(type, spawn);
      this.audioCallbacks?.onSpawn?.(type, spawn);
    }
  }

  /**
   * Advance every live mob one tick: run its AI (passive wander / hostile chase),
   * resolve creeper explosions, grant drops + remove dead mobs, and despawn
   * far/idle mobs.
   */
  aiTick(player: Player, clock: Clock, currentTick: number): void {
    const night = isNight(clock);
    const playerFeet: Vec3 = {
      x: player.feet.x,
      y: player.feet.y,
      z: player.feet.z,
    };
    const eye = player.eyePosition();

    // Tracks which hostile is currently being ticked so the damagePlayer closure
    // can attribute hits to the correct mob type.
    let currentAttacker: Mob | null = null;
    const hooks: CombatHooks = {
      damagePlayer: (amount: number) => {
        if (currentAttacker !== null) {
          player.lastDamageMobType = currentAttacker.type;
        }
        applyPlayerDamage(player, amount, clock.totalTicks);
      },
      playerEyePos: () => player.eyePosition(),
      knockbackPlayer: (attackerXZ) => applyPlayerKnockback(player, attackerXZ),
    };

    // Snapshot first: AI may spawn/despawn, and we mutate the manager below.
    for (const mob of this.manager.all()) {
      // Status effects (poison/regen from tipped arrows / splash potions) tick
      // first so a poisoned mob's health is current for this tick's death gate.
      // tickMobEffects is a fast no-op for unaffected mobs.
      tickMobEffects(mob, currentTick);
      if (mob.isPassive()) {
        tickPassive(mob, this.isSolid, () => Math.random());
      } else {
        const skylight = this.skylightAtWorld(
          Math.floor(mob.feet.x),
          clampY(Math.floor(mob.feet.y)),
          Math.floor(mob.feet.z),
        );
        // Track creeper fuse state before the tick to detect the rising edge.
        const wasFusing = mob.type === "creeper" && mob.aiState === "fuse";
        const prevHealth = mob.health;
        // Attribute any damage in this tick to this mob.
        currentAttacker = mob;
        const result = tickHostile(
          mob,
          this.isSolid,
          this.getBlock,
          night,
          skylight,
          hooks,
          currentTick,
        );
        if (result.explode === true) {
          this.detonateCreeper(mob, player, currentTick);
          continue; // mob already removed by detonateCreeper
        }
        // Fire audio: creeper fuse starting (rising edge only).
        if (
          !wasFusing &&
          mob.type === "creeper" &&
          mob.aiState === "fuse" &&
          this.audioCallbacks !== null
        ) {
          this.audioCallbacks.onCreeperFuse?.(mob.feet);
        }
        // Fire audio: mob hurt (health decreased this tick).
        if (mob.health < prevHealth && this.audioCallbacks !== null) {
          this.audioCallbacks.onHurt?.(mob.feet);
        }
      }

      // --- Death handling (player-kill drops vs. silent removal) ------------
      if (mob.isDead()) {
        this.handleDeath(mob, playerFeet, player);
        continue;
      }

      // --- Despawn far/idle mobs --------------------------------------------
      const book = this.bookkeepingFor(mob.id);
      const d = dist(mob.feet, eye);
      if (d > FAR_DISTANCE) book.ticksFarFromPlayer += 1;
      else book.ticksFarFromPlayer = 0;

      if (shouldDespawn(mob, d, book.ticksFarFromPlayer, currentTick)) {
        this.remove(mob.id);
      }
    }
  }

  /** Detonate a fused creeper: blast the world, remesh, damage entities, despawn. */
  private detonateCreeper(mob: Mob, player: Player, currentTick: number): void {
    const stats = MOB_STATS[mob.type];
    // Blast center: the vertical middle of the creeper's hitbox.
    const center: Vec3 = {
      x: mob.feet.x,
      y: mob.feet.y + stats.height / 2,
      z: mob.feet.z,
    };
    // Attribute any explosion damage to this creeper before the blast.
    const result = explode(
      this.world,
      center,
      CREEPER_POWER,
      this.manager.all(),
      {
        damagePlayer: (n: number) => {
          player.lastDamageMobType = mob.type;
          applyPlayerDamage(player, n, currentTick);
        },
        playerPos: () => player.feet,
      },
      currentTick,
    );

    // Blast knockback: push the player away from the creeper's feet (blast
    // center XZ). The Mob object stays alive in the local `mob` until removal
    // below, so mob.feet is valid here. Strength 0.8 reflects the blast.
    applyPlayerKnockback(player, { x: mob.feet.x, z: mob.feet.z }, CREEPER_BLAST_KNOCKBACK);

    // Re-mesh + invalidate skylight for every destroyed coordinate.
    for (const c of result.destroyed) {
      this.renderer.blockChanged(c.x, c.y, c.z);
      this.invalidateSkylightAt(c.x, c.z);
    }

    // The creeper consumes itself in the blast.
    this.remove(mob.id);

    // Fire explosion audio callback.
    this.audioCallbacks?.onExplosion?.(center);

    // Other mobs the blast killed are cleaned up on their next aiTick death pass;
    // remove any that are already dead now to avoid a one-tick ghost.
    for (const other of this.manager.all()) {
      if (other.isDead()) this.remove(other.id);
    }
  }

  /**
   * On death: if the mob was player-killed (damaged recently AND within
   * {@link KILL_CREDIT_RANGE} of the player) grant its drops to the inventory;
   * otherwise just remove it. Items that don't fit a full inventory are lost (v1).
   */
  private handleDeath(mob: Mob, playerFeet: Vec3, player: Player): void {
    const playerKilled = dist(mob.feet, playerFeet) <= KILL_CREDIT_RANGE;
    if (playerKilled) {
      for (const drop of MOB_DROPS[mob.type]) {
        const count = drop.min; // deterministic v1: grant the floor of the range
        if (count <= 0) continue;
        player.inventory.add(makeStack(drop.item, count));
      }
    }
    // Fire death audio callback before removing so position is still valid.
    this.audioCallbacks?.onDeath?.(mob.type, mob.feet);
    this.remove(mob.id);
  }

  /** Get-or-create the despawn bookkeeping for a mob id. */
  private bookkeepingFor(id: number): MobBookkeeping {
    let book = this.bookkeeping.get(id);
    if (book === undefined) {
      book = { ticksFarFromPlayer: 0 };
      this.bookkeeping.set(id, book);
    }
    return book;
  }

  /** Remove a mob from the manager + its bookkeeping. */
  private remove(id: number): void {
    this.manager.despawn(id);
    this.bookkeeping.delete(id);
  }
}

/** Clamp a Y to the valid skylight range so a falling mob never throws. */
function clampY(y: number): number {
  if (y < 0) return 0;
  if (y > 255) return 255;
  return y;
}

/**
 * Ray vs. each mob AABB (slab test); returns the nearest mob hit within
 * `maxDist`, or null. `rayDir` need not be normalized.
 */
export function pickMob(
  rayOrigin: Vec3,
  rayDir: Vec3,
  maxDist: number,
  mobs: Mob[],
): Mob | null {
  const len = Math.hypot(rayDir.x, rayDir.y, rayDir.z);
  if (len === 0 || maxDist <= 0) return null;
  const dx = rayDir.x / len;
  const dy = rayDir.y / len;
  const dz = rayDir.z / len;

  let nearest: Mob | null = null;
  let nearestT = Number.POSITIVE_INFINITY;

  for (const mob of mobs) {
    const box = mob.aabb();
    const t = raySlab(rayOrigin, dx, dy, dz, box.min, box.max);
    if (t === null) continue;
    if (t > maxDist) continue;
    if (t < nearestT) {
      nearestT = t;
      nearest = mob;
    }
  }

  return nearest;
}

/**
 * Slab-test a ray (origin + t·dir, dir already normalized) against an AABB.
 * Returns the entry distance `t` (>= 0) along the ray, or null if no hit.
 * A ray that starts inside the box returns 0.
 */
function raySlab(
  origin: Vec3,
  dx: number,
  dy: number,
  dz: number,
  min: Vec3,
  max: Vec3,
): number | null {
  let tmin = Number.NEGATIVE_INFINITY;
  let tmax = Number.POSITIVE_INFINITY;

  const axes: { o: number; d: number; lo: number; hi: number }[] = [
    { o: origin.x, d: dx, lo: min.x, hi: max.x },
    { o: origin.y, d: dy, lo: min.y, hi: max.y },
    { o: origin.z, d: dz, lo: min.z, hi: max.z },
  ];

  for (const a of axes) {
    if (Math.abs(a.d) < 1e-12) {
      // Ray parallel to this slab: must start within the slab to ever hit.
      if (a.o < a.lo || a.o > a.hi) return null;
      continue;
    }
    const inv = 1 / a.d;
    let t1 = (a.lo - a.o) * inv;
    let t2 = (a.hi - a.o) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Box is entirely behind the ray origin.
  if (tmax < 0) return null;
  // Entry distance: 0 if the origin is already inside the box.
  return tmin < 0 ? 0 : tmin;
}

// The player-side combat chokepoint now lives in src/combat/player-damage.ts
// (extracted in Phase 6a so controller.ts can route fall damage through it
// without a circular import). Re-exported here so existing callers/tests that
// import from "./mob-driver" are unaffected.
export { applyPlayerDamage, applyPlayerKnockback };
export type { DamageSource } from "../combat/player-damage";

/**
 * Deal one player melee hit to `mob` at `currentTick`. Defaults to
 * {@link PLAYER_ATTACK_DAMAGE} (fists); pass `amount` to apply sword damage.
 * The optional 4th arg `attackerXZ` applies a knockback impulse pushing the
 * mob away from the attacker; omitting it preserves the pre-knockback behavior.
 */
export function attackMob(
  mob: Mob,
  currentTick: number,
  amount: number = PLAYER_ATTACK_DAMAGE,
  attackerXZ?: { x: number; z: number },
): void {
  mob.takeDamage(amount, currentTick);
  if (attackerXZ !== undefined) {
    const k = knockbackImpulse(attackerXZ, mob.feet);
    mob.knockback.x += k.x;
    mob.knockback.z += k.z;
    mob.velocity.y = k.y; // upward component rides the existing gravity carry
  }
}
