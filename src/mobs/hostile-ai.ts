/**
 * hostile-ai.ts — per-tick AI for hostile mobs (zombie / skeleton / creeper).
 *
 * Wave-5 feature, deliberately SIMPLE: there is NO A* and no pathfinding lib.
 * Hostiles chase the player by steering straight toward them on the horizontal
 * plane (greedy line-of-sight pursuit), auto-jumping single-block ledges via the
 * D5 step-up helper. When the player is out of detection range OR behind an
 * opaque block (no line-of-sight) the mob reverts to idle/wander so mobs do not
 * "stare at walls".
 *
 * Combat per type:
 *  - zombie   : melee — `damagePlayer(attackDamage)` when within `attackRangeBlocks`
 *               and the per-mob attack cooldown has elapsed.
 *  - skeleton : modelled as direct damage on a (longer-range, slower) cooldown.
 *               The real game fires an arrow ENTITY; that projectile is omitted
 *               for v1 (see deviations) — we apply `attackDamage` directly.
 *  - creeper  : does NOT damage on contact. Within 3 blocks it starts a 30-tick
 *               (1.5 s) fuse; beyond 7 blocks the fuse is cancelled; when the
 *               fuse reaches 0 it returns `{ explode: true }` and the integration
 *               layer (explosion.ts) handles the blast + damage.
 *
 * Sun-burn: mobs whose stats mark `burnsInSun` take 1 damage roughly every
 * SUN_BURN_INTERVAL ticks while it is day AND the mob is fully sky-exposed
 * (skylight === 15).
 *
 * Pure logic: gravity/collision is delegated to {@link mobStep}/{@link tryStepUp}
 * (size-aware mob physics), line-of-sight to {@link raycastVoxel}. No Babylon,
 * no Date, no Math.random.
 */

import { Blocks, type BlockId, TICKS_PER_SECOND } from "../rules/mc-1.20";
import { MOB_STATS } from "../rules/mob-stats";
import { isOpaque } from "../rules/block-registry";
import { raycastVoxel } from "../interaction/raycast";
import type { Mob, Vec3 } from "./entity";
import { mobStep, tryStepUp, type SolidQuery } from "./physics";

/** Look up the block id stored at integer voxel coordinates (bx,by,bz). */
export type BlockQuery = (bx: number, by: number, bz: number) => BlockId;

/**
 * Side-channel the AI uses to interact with the player. Kept tiny so tests can
 * pass plain fakes: `damagePlayer` records melee/ranged hits; `playerEyePos`
 * returns the player's current eye position (the chase/attack target).
 */
export interface CombatHooks {
  damagePlayer: (amount: number) => void;
  playerEyePos: () => Vec3;
}

// --- Tunables (ticks) -------------------------------------------------------

/** Creeper fuse length: 1.5 s at 20 tps. */
export const CREEPER_FUSE_TICKS = 30;
/** Distance (blocks) at which a creeper starts its fuse. */
export const CREEPER_FUSE_RANGE = 3;
/** Distance (blocks) beyond which a lit creeper's fuse is cancelled. */
export const CREEPER_CANCEL_RANGE = 7;

/** Melee attack cooldown (zombie). */
const ZOMBIE_ATTACK_COOLDOWN = TICKS_PER_SECOND; // ~1 s
/** Ranged "shot" cooldown (skeleton) — slower than melee. */
const SKELETON_ATTACK_COOLDOWN = TICKS_PER_SECOND * 2; // ~2 s

/** Sun-burn: 1 damage roughly per second of full sky exposure during the day. */
const SUN_BURN_INTERVAL = 20;
/** Skylight level that counts as "fully exposed to the sky". */
const FULL_SKYLIGHT = 15;

/** `extra` key holding the tick of this mob's most recent attack. */
const LAST_ATTACK_KEY = "lastAttackTick";
/** `extra` key holding the tick of this mob's most recent sun-burn. */
const LAST_BURN_KEY = "lastSunBurnTick";

/** Result of a single hostile AI tick. */
export interface HostileTickResult {
  /** Set when a creeper's fuse reached 0 this tick: integration should explode. */
  explode?: boolean;
}

/** Horizontal distance between two points (ignores y). */
function horizDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Full 3D distance between two points. */
function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** This mob's eye/centre position (centre of the hitbox top region). */
function mobEyePos(mob: Mob): Vec3 {
  const stats = MOB_STATS[mob.type];
  // Eyes sit near the top of the hitbox (90% up the body) — close enough for LOS.
  return {
    x: mob.feet.x,
    y: mob.feet.y + stats.height * 0.9,
    z: mob.feet.z,
  };
}

/**
 * True iff there is an unobstructed line of sight from `fromPos` to `toPos`:
 * no OPAQUE block lies strictly between the two points.
 *
 * We cast a ray from→to, but only treat opaque voxels as hittable (glass, water,
 * leaves, torches do not block sight). The line of sight is clear when either no
 * opaque block is hit, or the hit is at/after the target distance (i.e. the only
 * obstruction is at or beyond the target itself).
 */
export function hasLineOfSight(
  fromPos: Vec3,
  toPos: Vec3,
  getBlock: BlockQuery,
): boolean {
  const dir: Vec3 = {
    x: toPos.x - fromPos.x,
    y: toPos.y - fromPos.y,
    z: toPos.z - fromPos.z,
  };
  const dist = Math.hypot(dir.x, dir.y, dir.z);
  if (dist === 0) return true;

  // Only opaque voxels obstruct sight; everything else reads as AIR to the cast.
  const sightBlock: BlockQuery = (bx, by, bz) => {
    const id = getBlock(bx, by, bz);
    return isOpaque(id) ? id : Blocks.AIR;
  };

  const hit = raycastVoxel(fromPos, dir, dist, sightBlock);
  if (hit === null) return true;

  // Distance from origin to the entry corner of the hit voxel.
  const hitDist = distance(fromPos, {
    x: hit.block.x + 0.5,
    y: hit.block.y + 0.5,
    z: hit.block.z + 0.5,
  });
  // An obstruction strictly before the target blocks sight; at/after is fine.
  return hitDist >= dist;
}

/** True iff `mob` may attack `targetDist` blocks away given its cooldown. */
function attackReady(
  mob: Mob,
  targetDist: number,
  attackRange: number,
  cooldown: number,
  currentTick: number,
): boolean {
  if (targetDist > attackRange) return false;
  const last = mob.extra[LAST_ATTACK_KEY];
  if (last !== undefined && currentTick - last < cooldown) return false;
  return true;
}

/** Apply sun-burn damage if conditions hold. Returns true if damage was dealt. */
function applySunBurn(
  mob: Mob,
  night: boolean,
  skylight: number,
  currentTick: number,
): void {
  if (night) return;
  if (!MOB_STATS[mob.type].burnsInSun) return;
  if (skylight !== FULL_SKYLIGHT) return;

  const last = mob.extra[LAST_BURN_KEY];
  if (last !== undefined && currentTick - last < SUN_BURN_INTERVAL) return;

  mob.takeDamage(1, currentTick);
  mob.extra[LAST_BURN_KEY] = currentTick;
}

/**
 * Advance one hostile mob by a single tick.
 *
 * `night`/`skylight` describe the mob's current cell (skylight 15 == sky-exposed).
 * `isSolid`/`getBlock` are world queries (block-collision / block-id). `hooks`
 * is the player side-channel. Returns `{ explode: true }` only when a creeper's
 * fuse elapsed this tick.
 */
export function tickHostile(
  mob: Mob,
  isSolid: SolidQuery,
  getBlock: BlockQuery,
  night: boolean,
  skylight: number,
  hooks: CombatHooks,
  currentTick: number,
): HostileTickResult {
  mob.age++;

  // Daylight burning is independent of pursuit state.
  applySunBurn(mob, night, skylight, currentTick);

  const stats = MOB_STATS[mob.type];
  const detectionRange = stats.detectionRange ?? 16;

  const playerPos = hooks.playerEyePos();
  const eye = mobEyePos(mob);
  const horizDist = horizDistance(mob.feet, playerPos);
  // Detection uses eye-to-player (line-of-sight origin); attack range is measured
  // body-to-body, so it uses the feet reference rather than the raised eye point.
  const detectDist = distance(eye, playerPos);
  const bodyDist = distance(mob.feet, playerPos);

  const inRange = detectDist <= detectionRange;
  const los = inRange && hasLineOfSight(eye, playerPos, getBlock);
  const aware = inRange && los;

  // Direction toward the player on the horizontal plane.
  const dx = playerPos.x - mob.feet.x;
  const dz = playerPos.z - mob.feet.z;
  const horizLen = Math.hypot(dx, dz);

  if (!aware) {
    // No target / line-of-sight blocked → revert to wander/idle (do not stare).
    if (mob.aiState === "chase" || mob.aiState === "attack") {
      mob.aiState = "idle";
      mob.target = null;
    }
    // Creepers that lose the player well outside cancel range also stand down.
    if (mob.type === "creeper" && mob.aiState === "fuse") {
      mob.aiState = "idle";
      mob.fuseTimer = -1;
    }
    // Settle in place (gravity + friction); no horizontal drive.
    mobStep(mob, { x: 0, y: 0, z: 0 }, isSolid);
    return {};
  }

  // Aware of the player: face + chase.
  mob.target = { x: playerPos.x, y: playerPos.y, z: playerPos.z };
  if (horizLen > 0) {
    mob.yaw = Math.atan2(dx, dz);
  }

  // --- Creeper: fuse logic, never melee --------------------------------------
  if (mob.type === "creeper") {
    return tickCreeper(mob, isSolid, horizDist, dx, dz, horizLen);
  }

  // --- Zombie / skeleton: chase + attack -------------------------------------
  mob.aiState = "chase";

  const attackRange = stats.attackRangeBlocks ?? 1.6;
  const attackDamage = stats.attackDamage ?? 0;
  const cooldown =
    mob.type === "skeleton" ? SKELETON_ATTACK_COOLDOWN : ZOMBIE_ATTACK_COOLDOWN;

  if (attackReady(mob, bodyDist, attackRange, cooldown, currentTick)) {
    mob.aiState = "attack";
    hooks.damagePlayer(attackDamage);
    mob.extra[LAST_ATTACK_KEY] = currentTick;
  }

  driveTowardPlayer(mob, isSolid, dx, dz, horizLen, stats.speed);
  return {};
}

/** Creeper fuse state-machine for a single aware tick. */
function tickCreeper(
  mob: Mob,
  isSolid: SolidQuery,
  horizDist: number,
  dx: number,
  dz: number,
  horizLen: number,
): HostileTickResult {
  const stats = MOB_STATS[mob.type];

  if (mob.aiState === "fuse") {
    // Player ran far enough away → abort the fuse.
    if (horizDist > CREEPER_CANCEL_RANGE) {
      mob.aiState = "chase";
      mob.fuseTimer = -1;
      driveTowardPlayer(mob, isSolid, dx, dz, horizLen, stats.speed);
      return {};
    }
    // Tick the fuse down; a creeper holds position while priming.
    mob.fuseTimer -= 1;
    mobStep(mob, { x: 0, y: 0, z: 0 }, isSolid);
    if (mob.fuseTimer <= 0) {
      mob.fuseTimer = -1;
      return { explode: true };
    }
    return {};
  }

  // Not yet fusing: start the fuse once close enough.
  if (horizDist <= CREEPER_FUSE_RANGE) {
    mob.aiState = "fuse";
    mob.fuseTimer = CREEPER_FUSE_TICKS;
    mobStep(mob, { x: 0, y: 0, z: 0 }, isSolid);
    return {};
  }

  // Otherwise close the distance.
  mob.aiState = "chase";
  driveTowardPlayer(mob, isSolid, dx, dz, horizLen, stats.speed);
  return {};
}

/**
 * Steer the mob horizontally toward the player at `speedBps` (blocks/second),
 * auto-jumping a single-block ledge in the path via {@link tryStepUp}.
 */
function driveTowardPlayer(
  mob: Mob,
  isSolid: SolidQuery,
  dx: number,
  dz: number,
  horizLen: number,
  speedBps: number,
): void {
  if (horizLen === 0) {
    mobStep(mob, { x: 0, y: 0, z: 0 }, isSolid);
    return;
  }

  const speedPerTick = speedBps / TICKS_PER_SECOND;
  const nx = dx / horizLen;
  const nz = dz / horizLen;
  const dir: Vec3 = { x: nx, y: 0, z: nz };

  // D5: hop a 1-block ledge between mob and player before moving.
  tryStepUp(mob, isSolid, dir);

  mobStep(
    mob,
    { x: nx * speedPerTick, y: 0, z: nz * speedPerTick },
    isSolid,
  );
}
