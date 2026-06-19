import { describe, it, expect } from "vitest";

import { World } from "../world/world";
import { Player } from "../player/controller";
import { makeClock, advance, type Clock } from "../time/clock";
import { TIME, Blocks, type BlockId, BABY_SCALE, MOB_CAP } from "../rules/mc-1.20";
import type { RemeshNotifier } from "../rendering/world-renderer";
import { Mob } from "../mobs/entity";
import { MOB_STATS, type MobType } from "../rules/mob-stats";

import {
  MobDriver,
  pickMob,
  attackMob,
  attackDamageFor,
  PLAYER_ATTACK_DAMAGE,
  applyPlayerDamage,
} from "./mob-driver";
import { getItemDef, Items } from "../rules/items";
import { makeStack, makeArmorStack } from "../inventory/stack";
import { applyEffect } from "../effects/status";

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
    for (let i = 0; i < MOB_CAP.PASSIVE; i++) {
      driver.manager.spawn("cow", { x: 0, y: 64, z: 0 });
    }
    expect(driver.manager.countPassive()).toBe(MOB_CAP.PASSIVE);

    driver.spawnTick(freshPlayer().feet, dayClock(), seqRng([0, 0, 0]));

    // Still capped — the spawn attempt was rejected by canSpawnMore.
    expect(driver.manager.countPassive()).toBe(MOB_CAP.PASSIVE);
  });

  it("spawn cadence: ~3 attempts in 60 ticks (interval = 20 ticks)", () => {
    // World that always produces a valid passive spawn site.
    const world = worldWithFloor(SPAWN_AT.x, 64, SPAWN_AT.z, Blocks.GRASS);
    const driver = new MobDriver(world, new RecordingRenderer());
    const clock = makeClock(0);
    const player = freshPlayer();
    let attempts = 0;
    // Advance tick-by-tick; count how many times a mob is actually spawned
    // (each successful spawnTick call that passes the interval gate adds one).
    for (let t = 0; t < 60; t++) {
      const before = driver.manager.countPassive();
      driver.spawnTick(player.feet, clock, seqRng([0, 0, 0]));
      if (driver.manager.countPassive() > before) attempts++;
      advance(clock, 1);
    }
    // With SPAWN_INTERVAL_TICKS=20, ticks 0, 20, 40 each trigger a spawn → 3.
    expect(attempts).toBe(3);
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
    // Phase 6a: the blast also knocks the player back.
    expect(player.knockbackX !== 0 || player.knockbackZ !== 0).toBe(true);
  });
});

describe("applyPlayerDamage", () => {
  it("no armor → full damage reaches survival", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    applyPlayerDamage(player, 6, 100);
    expect(player.survival.health).toBe(14);
  });
  it("armor reduces damage (iron chestplate, 6 defense)", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    player.equipment.equip("chestplate", makeStack(Items.IRON_CHESTPLATE, 1, 1));
    // 6 def → 24% off → 6 × 0.76 = 4.56 → 5
    applyPlayerDamage(player, 6, 100);
    expect(player.survival.health).toBe(15);
  });
  it("decrements armor durability on a real hit", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.equipment.equip("chestplate", makeArmorStack(Items.IRON_CHESTPLATE));
    const startDur = player.equipment.get("chestplate")!.durability!;
    applyPlayerDamage(player, 6, 100);
    expect(player.equipment.get("chestplate")!.durability).toBe(startDur - 1);
  });
  it("fully-absorbed hit costs no health and no durability", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    // Full diamond set = 3 + 8 + 6 + 3 = 20 defense → 80% cap.
    player.equipment.equip("helmet", makeArmorStack(Items.DIAMOND_HELMET));
    player.equipment.equip("chestplate", makeArmorStack(Items.DIAMOND_CHESTPLATE));
    player.equipment.equip("leggings", makeArmorStack(Items.DIAMOND_LEGGINGS));
    player.equipment.equip("boots", makeArmorStack(Items.DIAMOND_BOOTS));
    const durBefore = player.equipment.get("chestplate")!.durability!;
    // 2 dmg × (1 − 0.8) = 0.4 → round → 0 → fully absorbed, early-return.
    applyPlayerDamage(player, 2, 100);
    expect(player.survival.health).toBe(20);
    expect(player.equipment.get("chestplate")!.durability).toBe(durBefore);
  });
  it("ignores a second hit inside the invulnerability window", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    applyPlayerDamage(player, 6, 100);
    expect(player.survival.health).toBe(14);
    applyPlayerDamage(player, 6, 101); // within INVULNERABLE_TICKS → ignored
    expect(player.survival.health).toBe(14);
    applyPlayerDamage(player, 6, 200); // window expired → applies
    expect(player.survival.health).toBe(8);
  });
});

describe("attackMob knockback", () => {
  it("4-arg form applies an away-from-attacker impulse without changing damage", () => {
    const mob = new Mob(9, "zombie", { x: 5, y: 0, z: 0 });
    const full = MOB_STATS.zombie.maxHealth;
    attackMob(mob, 1, PLAYER_ATTACK_DAMAGE, { x: 0, z: 0 });
    expect(mob.health).toBe(full - PLAYER_ATTACK_DAMAGE);
    expect(mob.knockback.x).toBeGreaterThan(0);
    expect(mob.velocity.y).toBeGreaterThan(0);
  });
  it("2-arg form applies NO knockback (pinned behavior preserved)", () => {
    const mob = new Mob(10, "zombie", { x: 5, y: 0, z: 0 });
    attackMob(mob, 1);
    expect(mob.knockback.x).toBe(0);
    expect(mob.knockback.z).toBe(0);
  });
});

describe("applyPlayerDamage resistance (Phase 5)", () => {
  it("resistance reduces post-armor damage (armor → resistance → clamp)", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    // No armor; Resistance I → 20% off → 6 × 0.8 = 4.8 → 5.
    applyEffect(player.effects, "resistance", 0, 1000);
    applyPlayerDamage(player, 6, 100);
    expect(player.survival.health).toBe(15);
  });
  it("a resistance-reduced-to-zero hit costs no health AND no durability", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.survival.health = 20;
    player.equipment.equip("chestplate", makeArmorStack(Items.IRON_CHESTPLATE));
    const startDur = player.equipment.get("chestplate")!.durability!;
    // Resistance IV → 80% off. A 1-damage hit after armor → round(≤1 × 0.2)=0.
    applyEffect(player.effects, "resistance", 3, 1000);
    applyPlayerDamage(player, 1, 100);
    expect(player.survival.health).toBe(20);
    expect(player.equipment.get("chestplate")!.durability).toBe(startDur);
  });
});

describe("applyPlayerDamage — lastDamageMobType attribution clearing", () => {
  it("source=fall clears lastDamageMobType", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.lastDamageMobType = "zombie";
    player.survival.health = 20;
    applyPlayerDamage(player, 4, 100, "fall");
    expect(player.lastDamageMobType).toBeNull();
  });

  it("source=fire clears lastDamageMobType", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.lastDamageMobType = "skeleton";
    player.survival.health = 20;
    applyPlayerDamage(player, 1, 100, "fire");
    expect(player.lastDamageMobType).toBeNull();
  });

  it("source=melee does NOT clear lastDamageMobType", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.lastDamageMobType = "creeper";
    player.survival.health = 20;
    applyPlayerDamage(player, 4, 100, "melee");
    // melee does not touch lastDamageMobType — it remains set.
    expect(player.lastDamageMobType).toBe("creeper");
  });

  it("source=explosion does NOT clear lastDamageMobType", () => {
    const player = new Player({ x: 0, y: 0, z: 0 });
    player.lastDamageMobType = "creeper";
    player.survival.health = 20;
    applyPlayerDamage(player, 4, 100, "explosion");
    expect(player.lastDamageMobType).toBe("creeper");
  });
});

describe("aiTick — mob status effects (Phase 6c)", () => {
  it("ticks an active poison on a live mob (health drops, never below 1)", () => {
    // Build the minimal World + MobDriver harness, mirroring the aiTick tests above.
    const world = new World(2);
    // Provide a floor so the cow doesn't fall through the world.
    world.setBlock(0, 63, 0, Blocks.STONE);
    const driver = new MobDriver(world, new RecordingRenderer());

    const player = new Player({ x: 0.5, y: 64, z: 0.5 });
    const clock = nightClock();

    // Spawn a cow adjacent to the player and apply a strong, long poison.
    const cow = driver.manager.spawn("cow", { x: 0.5, y: 64, z: 1.5 });
    cow.health = 10;
    applyEffect(cow.effects, "poison", 4, 100000); // high amplifier → fast ticks

    // Run enough ticks to advance past at least one poison interval.
    for (let t = 0; t < 200; t++) driver.aiTick(player, clock, t);

    // Poison drained health but cannot kill.
    expect(cow.health).toBeLessThan(10);
    expect(cow.health).toBeGreaterThanOrEqual(1);
  });
});

describe("pickMob — baby hitbox (Phase 6c)", () => {
  it("a ray grazing the adult top edge MISSES the baby (smaller box)", () => {
    // Cow adult height = 1.4 → box [feet.y, feet.y+1.4].
    // Baby scale = 0.5 → baby height = 0.7 → box [feet.y, feet.y+0.7].
    // Feet at y=64. Origin y=65.0 is INSIDE the adult box (64 ≤ 65.0 < 65.4)
    // but ABOVE the baby box (65.0 > 64.7). Ray shoots +z toward the mob.
    // This geometry is the differential: adult hit / baby miss.
    const cowFeet = { x: 0, y: 64, z: 5 };
    const origin = { x: 0, y: 65.0, z: 0 };
    const dir = { x: 0, y: 0, z: 1 };

    // Confirm the ray hits an adult cow (adult box top = 64 + 1.4 = 65.4 > 65.0).
    const adult = new Mob(1, "cow", cowFeet);
    const hitAdult = pickMob(origin, dir, 50, [adult]);
    expect(hitAdult).toBe(adult);

    // Same ray must MISS a baby cow (baby box top = 64 + 0.7 = 64.7 < 65.0).
    const baby = new Mob(2, "cow", cowFeet);
    baby.extra["babyScale"] = BABY_SCALE;
    const hitBaby = pickMob(origin, dir, 50, [baby]);
    expect(hitBaby).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Death attribution — lastDamageMobType via aiTick
// ---------------------------------------------------------------------------

describe("aiTick — lastDamageMobType attribution (mob melee)", () => {
  /**
   * Build a world with solid stone around the combat cell (mirrors the creeper
   * explosion test). An air shaft at the column centre gives clear line-of-sight.
   * The zombie is placed at cy+1 and the player at cy, so bodyDist (mob.feet →
   * player eye) = distance({cy+1}, {cy+1.62}) = 0.62 < 1.6 (melee range).
   */
  function buildZombieInRange(): {
    driver: MobDriver;
    player: Player;
    zombie: Mob;
  } {
    const world = new World(2);
    const cx = 4;
    const cy = 64;
    const cz = 4;
    // Solid stone pocket so the column is seeded with deterministic blocks.
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -3; dz <= 3; dz++) {
          world.setBlock(cx + dx, cy + dy, cz + dz, Blocks.STONE);
        }
      }
    }
    // Carve air shaft so line-of-sight is unobstructed and neither mob nor
    // player is inside solid terrain.
    for (let dy = -1; dy <= 4; dy++) {
      world.setBlock(cx, cy + dy, cz, Blocks.AIR);
    }

    const driver = new MobDriver(world, new RecordingRenderer());
    // Player stands at cy (feet), eye at cy+1.62.
    const player = new Player({ x: cx + 0.5, y: cy, z: cz + 0.5 });
    // Zombie feet at cy+1 → bodyDist to player eye (cy+1.62) = 0.62 < 1.6.
    const zombie = driver.manager.spawn("zombie", {
      x: cx + 0.5,
      y: cy + 1,
      z: cz + 0.5,
    });
    return { driver, player, zombie };
  }

  it("sets player.lastDamageMobType to the attacking mob's type on a melee hit", () => {
    const { driver, player } = buildZombieInRange();
    expect(player.lastDamageMobType).toBeNull();

    // Use an advancing night clock so the zombie's attack cooldown advances.
    // On tick 0 the zombie is in range with no cooldown → attacks immediately.
    const clock = nightClock();
    let hit = false;
    for (let t = 0; t < 200; t++) {
      const before = player.survival.health;
      driver.aiTick(player, clock, clock.totalTicks);
      advance(clock, 1);
      if (player.survival.health < before) {
        hit = true;
        break;
      }
    }
    expect(hit).toBe(true);
    expect(player.lastDamageMobType).toBe("zombie");
  });

  it("sets player.lastDamageMobType to 'creeper' on a creeper explosion", () => {
    const world = new World(2);
    const cx = 4;
    const cy = 64;
    const cz = 4;
    // Solid stone pocket around the creeper for the blast to destroy.
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dz = -3; dz <= 3; dz++) {
          world.setBlock(cx + dx, cy + dy, cz + dz, Blocks.STONE);
        }
      }
    }
    // Air shaft at the creeper/player column so line-of-sight is clear.
    for (let dy = 0; dy <= 4; dy++) {
      world.setBlock(cx, cy + dy, cz, Blocks.AIR);
    }
    const driver = new MobDriver(world, new RecordingRenderer());

    const creeper = driver.manager.spawn("creeper", {
      x: cx + 0.5,
      y: cy,
      z: cz + 0.5,
    });
    creeper.aiState = "fuse";
    creeper.fuseTimer = 1; // detonates this tick

    const player = new Player({ x: cx + 0.5, y: cy + 1, z: cz + 0.5 });
    player.survival.health = 20;
    expect(player.lastDamageMobType).toBeNull();

    driver.aiTick(player, nightClock(), 100);

    // Creeper explosion should have attributed damage to "creeper".
    expect(player.lastDamageMobType).toBe("creeper");
  });
});
