import { describe, it, expect } from "vitest";
import { Blocks } from "../rules/mc-1.20";
import { ChunkColumn } from "../chunk/column";
import { World } from "../world/world";
import { Player } from "../player/controller";
import { makeStack, makeToolStack } from "../inventory/stack";
import { makeClock } from "../time/clock";
import {
  serializeSave,
  deserializeSave,
  deserializeColumn,
} from "../save/serialize";
import { migrate, SAVE_VERSION } from "../save/migration";
import { MemoryStore } from "../save/store";
import { buildWorldSave, saveGame, loadGame } from "./persistence";
import { MobManager } from "../mobs/manager";
import { deserializeMobs } from "../mobs/persistence";

/** A tiny 2-column world with a couple of known voxels written in. */
function tinyWorld(): World {
  const columns = new Map<string, ChunkColumn>();
  const a = new ChunkColumn(0, 0);
  a.setBlock(1, 64, 2, Blocks.DIAMOND_ORE);
  const b = new ChunkColumn(1, 0);
  b.setBlock(3, 10, 4, Blocks.GOLD_ORE);
  columns.set(World.columnKey(0, 0), a);
  columns.set(World.columnKey(1, 0), b);
  return new World(4242, columns);
}

/** A player at a known feet position with a set survival economy + inventory. */
function makeTestPlayer(): Player {
  const player = new Player({ x: 8.5, y: 72.25, z: -3.5 });
  player.survival.health = 14;
  player.survival.food = 11;
  player.survival.saturation = 2.5;
  player.inventory.set(0, makeStack(Blocks.STONE, 32));
  player.inventory.set(4, makeToolStack(Blocks.OAK_LOG, "iron"));
  player.hotbar.select(2);
  return player;
}

describe("buildWorldSave → serialize → deserialize → migrate round-trip", () => {
  it("preserves seed, totalTicks, player fields, columns, and a sampled voxel", () => {
    const world = tinyWorld();
    const player = makeTestPlayer();
    const clock = makeClock(12345);

    const save = buildWorldSave(world, player, clock, {
      yaw: 1.25,
      pitch: -0.5,
    });
    const round = migrate(deserializeSave(serializeSave(save)));

    expect(round.version).toBe(SAVE_VERSION); // 3
    expect(round.seed).toBe(4242);
    expect(round.totalTicks).toBe(12345);

    // Player body + view.
    expect(round.player.x).toBe(8.5);
    expect(round.player.y).toBe(72.25);
    expect(round.player.z).toBe(-3.5);
    expect(round.player.yaw).toBe(1.25);
    expect(round.player.pitch).toBe(-0.5);

    // Survival economy.
    expect(round.player.health).toBe(14);
    expect(round.player.food).toBe(11);
    expect(round.player.saturation).toBe(2.5);
    expect(round.player.selectedSlot).toBe(2);

    // Inventory: a block stack and a durability tool stack survive.
    expect(round.player.inventory[0]).toEqual({
      itemId: Blocks.STONE,
      count: 32,
      maxStack: 64,
    });
    const tool = round.player.inventory[4];
    expect(tool?.durability).toBe(250);
    expect(tool?.maxDurability).toBe(250);

    // Column count + a sampled voxel survives byte-exactly.
    expect(Object.keys(round.columns).sort()).toEqual(["0,0", "1,0"]);
    const colA = round.columns["0,0"];
    const colB = round.columns["1,0"];
    expect(colA).toBeDefined();
    expect(colB).toBeDefined();
    if (colA === undefined || colB === undefined) throw new Error("missing column");
    expect(deserializeColumn(colA).getBlock(1, 64, 2)).toBe(Blocks.DIAMOND_ORE);
    expect(deserializeColumn(colB).getBlock(3, 10, 4)).toBe(Blocks.GOLD_ORE);
  });
});

describe("saveGame / loadGame over a MemoryStore (atomic write + safe read)", () => {
  it("persists and reloads the world state through the store", async () => {
    const store = new MemoryStore();
    const world = tinyWorld();
    const player = makeTestPlayer();
    const clock = makeClock(999);

    const ok = await saveGame(store, world, player, clock, {
      yaw: 0.1,
      pitch: 0.2,
    });
    expect(ok).toBe(true);

    const loaded = await loadGame(store);
    expect(loaded).not.toBeNull();
    if (loaded === null) throw new Error("expected a loaded save");

    expect(loaded.seed).toBe(4242);
    expect(loaded.totalTicks).toBe(999);
    expect(loaded.player.health).toBe(14);
    expect(loaded.player.yaw).toBe(0.1);
    expect(Object.keys(loaded.columns).length).toBe(2);

    const colA = loaded.columns["0,0"];
    expect(colA).toBeDefined();
    if (colA === undefined) throw new Error("missing column 0,0");
    expect(deserializeColumn(colA).getBlock(1, 64, 2)).toBe(Blocks.DIAMOND_ORE);
  });

  it("returns null when nothing has been saved", async () => {
    const store = new MemoryStore();
    expect(await loadGame(store)).toBeNull();
  });
});

describe("mob persistence end-to-end (buildWorldSave includes the manager)", () => {
  it("round-trips live mobs through serialize → deserialize → manager.load", () => {
    const world = tinyWorld();
    const player = makeTestPlayer();
    const clock = makeClock(7);

    const manager = new MobManager();
    const cow = manager.spawn("cow", { x: 2.5, y: 64, z: 3.5 });
    const zombie = manager.spawn("zombie", { x: -5.5, y: 70, z: 1.5 });
    zombie.takeDamage(6, 3); // health < max + lastDamageTick set

    const save = buildWorldSave(
      world,
      player,
      clock,
      { yaw: 0, pitch: 0 },
      manager,
    );
    expect(save.mobs?.length).toBe(2);

    const round = migrate(deserializeSave(serializeSave(save)));
    const restored = new MobManager();
    restored.load(deserializeMobs(round.mobs ?? []));

    expect(restored.count()).toBe(2);
    const rCow = restored.get(cow.id);
    const rZombie = restored.get(zombie.id);
    expect(rCow?.type).toBe("cow");
    expect(rCow?.feet).toEqual({ x: 2.5, y: 64, z: 3.5 });
    expect(rZombie?.type).toBe("zombie");
    expect(rZombie?.health).toBe(zombie.health);
    expect(rZombie?.lastDamageTick).toBe(3);

    // A future spawn must not collide with a restored id.
    const next = restored.spawn("pig", { x: 0, y: 64, z: 0 });
    expect(next.id).toBeGreaterThan(Math.max(cow.id, zombie.id));
  });

  it("buildWorldSave with no manager yields an empty mob list", () => {
    const save = buildWorldSave(tinyWorld(), makeTestPlayer(), makeClock(0), {
      yaw: 0,
      pitch: 0,
    });
    expect(save.mobs).toEqual([]);
  });
});
