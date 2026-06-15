import { describe, it, expect } from "vitest";

import { World } from "../world/world";
import { Player } from "../player/controller";
import { makeClock, type Clock } from "../time/clock";
import { TIME, Blocks, type BlockId } from "../rules/mc-1.20";
import type { RemeshNotifier } from "../rendering/world-renderer";
import { Mob } from "../mobs/entity";
import { MOB_STATS, type MobType } from "../rules/mob-stats";

import {
  MobDriver,
  pickMob,
  attackMob,
  attackDamageFor,
  PLAYER_ATTACK_DAMAGE,
} from "./mob-driver";
import { getItemDef, Items } from "../rules/items";

/** A renderer stub that records every blockChanged call. */
class RecordingRenderer implements RemeshNotifier {
  readonly changed: { x: number; y: number; z: number }[] = [];
  blockChanged(wx: number, wy: number, wz: number): void {
    this.changed.push({ x: wx, y: wy, z: wz });
  }
}

/** A deterministic RNG that yields a fixed sequence then repeats its last value. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)] ?? 0;
    i++;
    return v;
  };
}

/** A day clock (tickOfDay < SUNSET_START → not night). */
function dayClock(): Clock {
  return makeClock(0);
}

/** A night clock (NIGHT_START ≤ tickOfDay < SUNRISE_START). */
function nightClock(): Clock {
  return makeClock(TIME.NIGHT_START + 10);
}

/**
 * Build an empty world with a single floor block at (bx, floorY, bz) and two air
 * cells above it (a valid 2-block standing footprint).
 *
 * When `roof=true`, a THICK solid cap fills the column from floorY+6 up to the
 * scan ceiling. The surface scan (first solid top-down with 2 air above) skips
 * the cap (no 2-air gap inside it) and lands on the floor at floorY, whose
 * standing cell is now beneath an opaque block → DARK (column-only skylight 0),
 * which is what hostile-spawn gating requires.
 */
function worldWithFloor(
  bx: number,
  floorY: number,
  bz: number,
  floorBlock: BlockId,
  roof = false,
): World {
  const world = new World(1);
  world.ensureColumn(Math.floor(bx / 16), Math.floor(bz / 16));
  world.setBlock(bx, floorY, bz, floorBlock);
  if (roof) {
    for (let y = floorY + 6; y <= 210; y++) {
      world.setBlock(bx, y, bz, Blocks.STONE);
    }
  }
  return world;
}

function freshPlayer(): Player {
  return new Player({ x: 0.5, y: 64, z: 0.5 });
}

describe("MobDriver.spawnTick — day/night + cap gating", () => {
  // rng=0,0 → randomSpawnOffset = (dx=24, dz=0); player at x=0.5 → wx=24, wz=0.
  // A trailing draw selects the mob type from the category list.
  const SPAWN_AT = { x: 24, z: 0 };

  it("spawns a PASSIVE mob by day on a grass surface", () => {
    const floorY = 64;
    const world = worldWithFloor(SPAWN_AT.x, floorY, SPAWN_AT.z, Blocks.GRASS);
    const driver = new MobDriver(world, new RecordingRenderer());
    const player = freshPlayer();

    driver.spawnTick(player.feet, dayClock(), seqRng([0, 0, 0]));

    expect(driver.manager.countPassive()).toBe(1);
    expect(driver.manager.countHostile()).toBe(0);
    const mob = driver.manager.all()[0];
    expect(mob).toBeDefined();
    expect(mob?.isPassive()).toBe(true);
    // Spawned standing on top of the floor block.
    expect(mob?.feet.y).toBe(floorY + 1);
  });

  it("does NOT spawn a passive mob by day when the floor is not grass", () => {
    const world = worldWithFloor(SPAWN_AT.x, 64, SPAWN_AT.z, Blocks.STONE);
    const driver = new MobDriver(world, new RecordingRenderer());

    driver.spawnTick(freshPlayer().feet, dayClock(), seqRng([0, 0, 0]));

    expect(driver.manager.count()).toBe(0);
  });

  it("spawns a HOSTILE mob at night in darkness", () => {
    const world = worldWithFloor(
      SPAWN_AT.x,
      64,
      SPAWN_AT.z,
      Blocks.STONE,
      /* roof */ true,
    );
    const driver = new MobDriver(world, new RecordingRenderer());

    driver.spawnTick(freshPlayer().feet, nightClock(), seqRng([0, 0, 0]));

    expect(driver.manager.countHostile()).toBe(1);
    expect(driver.manager.countPassive()).toBe(0);
    expect(driver.manager.all()[0]?.isHostile()).toBe(true);
  });

  it("does NOT spawn a hostile mob at night when the cell is sky-lit", () => {
    // No roof → standing cell is open to the sky (skylight 15 > HOSTILE_MAX).
    const world = worldWithFloor(SPAWN_AT.x, 64, SPAWN_AT.z, Blocks.STONE);
    const driver = new MobDriver(world, new RecordingRenderer());

    driver.spawnTick(freshPlayer().feet, nightClock(), seqRng([0, 0, 0]));

    expect(driver.manager.count()).toBe(0);
  });

  it("respects the per-attempt cadence (a second immediate attempt is skipped)", () => {
    const world = worldWithFloor(SPAWN_AT.x, 64, SPAWN_AT.z, Blocks.GRASS);
    const driver = new MobDriver(world, new RecordingRenderer());
    const clock = dayClock();
    const player = freshPlayer();

    driver.spawnTick(player.feet, clock, seqRng([0, 0, 0]));
    // Same tick → within SPAWN_INTERVAL_TICKS → no second spawn.
    driver.spawnTick(player.feet, clock, seqRng([0, 0, 0]));

    expect(driver.manager.count()).toBe(1);
  });

  it("respects the passive cap (no spawn once the cap is reached)", () => {
    const world = worldWithFloor(SPAWN_AT.x, 64, SPAWN_AT.z, Blocks.GRASS);
    const driver = new MobDriver(world, new RecordingRenderer());
    // Fill the passive population to the cap directly via the manager.
    for (let i = 0; i < 10; i++) {
      driver.manager.spawn("cow", { x: 0, y: 64, z: 0 });
    }
    expect(driver.manager.countPassive()).toBe(10);

    driver.spawnTick(freshPlayer().feet, dayClock(), seqRng([0, 0, 0]));

    // Still capped — the spawn attempt was rejected by canSpawnMore.
    expect(driver.manager.countPassive()).toBe(10);
  });
});

describe("pickMob — ray vs mob AABBs", () => {
  function mobAt(type: MobType, x: number, y: number, z: number): Mob {
    return new Mob(1, type, { x, y, z });
  }

  it("returns the nearest mob along the ray", () => {
    const nearMob = new Mob(7, "zombie", { x: 0, y: 0, z: 5 });
    const farMob = new Mob(9, "zombie", { x: 0, y: 0, z: 10 });

    const hit = pickMob(
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      20,
      [farMob, nearMob], // far listed first; nearest must still win
    );
    expect(hit?.id).toBe(7);
  });

  it("returns null when the only mob is beyond maxDist", () => {
    const mob = mobAt("zombie", 0, 0, 30);
    const hit = pickMob({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 6, [mob]);
    expect(hit).toBeNull();
  });

  it("returns null when the ray misses every mob", () => {
    const mob = mobAt("zombie", 10, 0, 0); // off to the side of a +z ray
    const hit = pickMob({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 20, [mob]);
    expect(hit).toBeNull();
  });

  it("returns null for an empty mob list", () => {
    expect(pickMob({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 10, [])).toBeNull();
  });
});

describe("attackMob", () => {
  it("reduces mob health by PLAYER_ATTACK_DAMAGE and records lastDamageTick", () => {
    const mob = new Mob(1, "zombie", { x: 0, y: 0, z: 0 });
    const full = MOB_STATS.zombie.maxHealth;
    expect(mob.health).toBe(full);

    attackMob(mob, 1234);

    expect(mob.health).toBe(full - PLAYER_ATTACK_DAMAGE);
    expect(mob.lastDamageTick).toBe(1234);
  });
});

describe("attackDamageFor", () => {
  it("fists / null held → PLAYER_ATTACK_DAMAGE", () => {
    expect(attackDamageFor(null)).toBe(PLAYER_ATTACK_DAMAGE);
  });
  it("non-sword tool (pickaxe) → PLAYER_ATTACK_DAMAGE", () => {
    expect(attackDamageFor(getItemDef(Items.IRON_PICKAXE))).toBe(PLAYER_ATTACK_DAMAGE);
  });
  it("iron sword deals more than fists (10)", () => {
    const iron = attackDamageFor(getItemDef(Items.IRON_SWORD));
    expect(iron).toBeGreaterThan(PLAYER_ATTACK_DAMAGE);
    expect(iron).toBe(10);
  });
  it("diamond > iron > wooden sword", () => {
    const d = attackDamageFor(getItemDef(Items.DIAMOND_SWORD));
    const i = attackDamageFor(getItemDef(Items.IRON_SWORD));
    const w = attackDamageFor(getItemDef(Items.WOODEN_SWORD));
    expect(d).toBeGreaterThan(i);
    expect(i).toBeGreaterThan(w);
  });
  it("attackMob still defaults to PLAYER_ATTACK_DAMAGE with 2 args", () => {
    const mob = new Mob(2, "zombie", { x: 0, y: 0, z: 0 });
    const full = MOB_STATS.zombie.maxHealth;
    attackMob(mob, 7);
    expect(mob.health).toBe(full - PLAYER_ATTACK_DAMAGE);
  });
});

describe("MobDriver.aiTick — creeper explosion path", () => {
  it("blasts blocks, calls renderer.blockChanged for each, and despawns the creeper", () => {
    // Solid stone around the creeper so the blast has blocks to destroy.
    const world = new World(2);
    const cx = 4;
    const cy = 64;
    const cz = 4;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -3; dz <= 3; dz++) {
          world.setBlock(cx + dx, cy + dy, cz + dz, Blocks.STONE);
        }
      }
    }
    // Carve an air shaft at the creeper/player column so line-of-sight is clear
    // (a creeper buried in stone can't "see" the player and never primes).
    for (let dy = 0; dy <= 4; dy++) {
      world.setBlock(cx, cy + dy, cz, Blocks.AIR);
    }
    const renderer = new RecordingRenderer();
    const driver = new MobDriver(world, renderer);

    // Spawn a creeper standing in the stone pocket and prime its fuse so the
    // next aiTick detonates it.
    const creeper = driver.manager.spawn("creeper", {
      x: cx + 0.5,
      y: cy,
      z: cz + 0.5,
    });
    creeper.aiState = "fuse";
    creeper.fuseTimer = 1; // ticks to 0 → explode this aiTick

    // Player on top of (and within fuse cancel range of) the creeper so the
    // creeper stays "aware" and the fuse runs out instead of being cancelled.
    const player = new Player({ x: cx + 0.5, y: cy + 1, z: cz + 0.5 });

    driver.aiTick(player, nightClock(), 100);

    // The creeper is gone…
    expect(driver.manager.get(creeper.id)).toBeUndefined();
    // …and the renderer was told about destroyed blocks.
    expect(renderer.changed.length).toBeGreaterThan(0);
  });
});
