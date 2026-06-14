import { describe, it, expect } from "vitest";
import { Blocks } from "../rules/mc-1.20";
import { ChunkColumn } from "../chunk/column";
import {
  serializeColumn,
  deserializeColumn,
  serializeSave,
  deserializeSave,
  type WorldSave,
  type PlayerSave,
} from "./serialize";

describe("serializeColumn / deserializeColumn (binary, byte-exact)", () => {
  it("round-trips an all-air column exactly", () => {
    const col = new ChunkColumn(0, 0);
    const bytes = serializeColumn(col);
    const round = deserializeColumn(bytes);
    // Byte-equality of a re-serialize proves the voxels match without a 65536x scan.
    expect(serializeColumn(round)).toEqual(bytes);
    expect(round.getBlock(0, 0, 0)).toBe(Blocks.AIR);
    expect(round.getBlock(15, 255, 15)).toBe(Blocks.AIR);
    expect(round.columnX).toBe(0);
    expect(round.columnZ).toBe(0);
  });

  it("preserves the column coords (incl. negatives) in the header", () => {
    const col = new ChunkColumn(-7, 12);
    const round = deserializeColumn(serializeColumn(col));
    expect(round.columnX).toBe(-7);
    expect(round.columnZ).toBe(12);
  });

  it("round-trips varied blocks across multiple sections + boundary y=0 and y=255", () => {
    const col = new ChunkColumn(5, -3);
    // Spread distinct blocks across distinct sections and (x,z) positions.
    col.setBlock(0, 0, 0, Blocks.BEDROCK); // section 0, very bottom
    col.setBlock(15, 255, 15, Blocks.SNOW); // section 15, very top
    col.setBlock(1, 17, 2, Blocks.STONE); // section 1
    col.setBlock(8, 64, 8, Blocks.WATER); // section 4
    col.setBlock(3, 130, 11, Blocks.DIAMOND_ORE); // section 8
    col.setBlock(14, 200, 5, Blocks.GLASS); // section 12
    col.setBlock(7, 16, 9, Blocks.OAK_LOG); // section 1, local y 0
    col.setBlock(7, 31, 9, Blocks.BIRCH_LEAVES); // section 1, local y 15

    const bytes = serializeColumn(col);
    const round = deserializeColumn(bytes);

    // Exhaustive byte-exact comparison of every voxel.
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let y = 0; y < 256; y++) {
          expect(round.getBlock(lx, y, lz)).toBe(col.getBlock(lx, y, lz));
        }
      }
    }

    // Spot-check the specific writes + boundaries explicitly.
    expect(round.getBlock(0, 0, 0)).toBe(Blocks.BEDROCK);
    expect(round.getBlock(15, 255, 15)).toBe(Blocks.SNOW);
    expect(round.getBlock(8, 64, 8)).toBe(Blocks.WATER);
    expect(round.getBlock(3, 130, 11)).toBe(Blocks.DIAMOND_ORE);
  });

  it("produces a fixed-size encoding (header + 65536 u16 voxels)", () => {
    const col = new ChunkColumn(0, 0);
    const bytes = serializeColumn(col);
    // header (14) + 65536 * 2.
    expect(bytes.byteLength).toBe(14 + 65536 * 2);
  });

  it("round-trip is byte-stable (re-serializing yields identical bytes)", () => {
    const col = new ChunkColumn(2, 2);
    col.setBlock(4, 50, 6, Blocks.IRON_ORE);
    col.setBlock(9, 90, 1, Blocks.LAVA);
    const a = serializeColumn(col);
    const b = serializeColumn(deserializeColumn(a));
    expect(b).toEqual(a);
  });

  it("rejects truncated column bytes", () => {
    const col = new ChunkColumn(0, 0);
    const bytes = serializeColumn(col);
    expect(() => deserializeColumn(bytes.subarray(0, bytes.length - 4))).toThrow();
  });
});

describe("serializeSave / deserializeSave (player + binary columns)", () => {
  function samplePlayer(): PlayerSave {
    return {
      x: 12.5,
      y: 71.0,
      z: -340.25,
      yaw: 90.5,
      pitch: -12.75,
      health: 18.5,
      food: 17,
      saturation: 4.8,
      selectedSlot: 3,
      inventory: [
        { itemId: 1, count: 64, maxStack: 64 },
        null,
        // A tool stack carrying durability metadata.
        {
          itemId: 257,
          count: 1,
          maxStack: 1,
          durability: 187,
          maxDurability: 250,
        },
        { itemId: 2, count: 12, maxStack: 64 },
        null,
      ],
      spawnX: 12.5,
      spawnY: 71.0,
      spawnZ: -340.25,
    };
  }

  it("round-trips all player fields including a durability tool stack", () => {
    const player = samplePlayer();
    const col = new ChunkColumn(1, 1);
    col.setBlock(0, 0, 0, Blocks.STONE);

    const save: WorldSave = {
      version: 1,
      seed: 1234567890,
      totalTicks: 987654,
      player,
      columns: {
        "1,1": serializeColumn(col),
      },
    };

    const round = deserializeSave(serializeSave(save));

    expect(round.version).toBe(1);
    expect(round.seed).toBe(1234567890);
    expect(round.totalTicks).toBe(987654);

    expect(round.player.x).toBe(12.5);
    expect(round.player.y).toBe(71.0);
    expect(round.player.z).toBe(-340.25);
    expect(round.player.yaw).toBe(90.5);
    expect(round.player.pitch).toBe(-12.75);
    expect(round.player.health).toBe(18.5);
    expect(round.player.food).toBe(17);
    expect(round.player.saturation).toBe(4.8);
    expect(round.player.selectedSlot).toBe(3);

    expect(round.player.inventory).toEqual(player.inventory);

    // The tool slot specifically retains durability + maxDurability.
    const tool = round.player.inventory[2];
    expect(tool).not.toBeNull();
    expect(tool?.durability).toBe(187);
    expect(tool?.maxDurability).toBe(250);

    // Non-tool slots have no durability fields.
    const block = round.player.inventory[0];
    expect(block?.durability).toBeUndefined();
    expect(block?.maxDurability).toBeUndefined();
  });

  it("round-trips multiple binary columns byte-exactly", () => {
    const ca = new ChunkColumn(0, 0);
    ca.setBlock(1, 10, 1, Blocks.GOLD_ORE);
    const cb = new ChunkColumn(-5, 9);
    cb.setBlock(2, 200, 2, Blocks.GLOWSTONE);

    const save: WorldSave = {
      version: 1,
      seed: 42,
      totalTicks: 0,
      player: samplePlayer(),
      columns: {
        "0,0": serializeColumn(ca),
        "-5,9": serializeColumn(cb),
      },
    };

    const round = deserializeSave(serializeSave(save));
    expect(Object.keys(round.columns).sort()).toEqual(["-5,9", "0,0"]);

    // Bytes survive verbatim, and decoding them reproduces the columns.
    const colA = round.columns["0,0"];
    const colB = round.columns["-5,9"];
    expect(colA).toBeDefined();
    expect(colB).toBeDefined();
    if (colA === undefined || colB === undefined) throw new Error("missing column");

    expect(colA).toEqual(save.columns["0,0"]);
    expect(colB).toEqual(save.columns["-5,9"]);

    expect(deserializeColumn(colA).getBlock(1, 10, 1)).toBe(Blocks.GOLD_ORE);
    expect(deserializeColumn(colB).getBlock(2, 200, 2)).toBe(Blocks.GLOWSTONE);
  });

  it("round-trips an empty inventory and zero columns", () => {
    const save: WorldSave = {
      version: 1,
      seed: 0,
      totalTicks: 0,
      player: {
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
        health: 20,
        food: 20,
        saturation: 5,
        selectedSlot: 0,
        inventory: [],
        spawnX: 0,
        spawnY: 0,
        spawnZ: 0,
      },
      columns: {},
    };
    const round = deserializeSave(serializeSave(save));
    expect(round.player.inventory).toEqual([]);
    expect(round.columns).toEqual({});
  });

  function samplePlayerMin(): PlayerSave {
    return {
      x: 0,
      y: 64,
      z: 0,
      yaw: 0,
      pitch: 0,
      health: 20,
      food: 20,
      saturation: 5,
      selectedSlot: 0,
      inventory: [],
      spawnX: 0,
      spawnY: 64,
      spawnZ: 0,
    };
  }

  it("round-trips mobs (save v2) through serialize/deserialize", () => {
    const save: WorldSave = {
      version: 2,
      seed: 7,
      totalTicks: 5,
      player: samplePlayerMin(),
      columns: {},
      mobs: [
        {
          id: 3,
          type: "zombie",
          x: 1.5,
          y: 64,
          z: -2.25,
          vx: 0,
          vy: -0.1,
          vz: 0,
          health: 14,
          aiState: "chase",
          aiTimer: 7,
          age: 120,
          lastDamageTick: 42,
          breedCooldown: 0,
          inLove: false,
          fuseTimer: -1,
          extra: { lastAttackTick: 40 },
        },
      ],
    };

    const round = deserializeSave(serializeSave(save));
    expect(round.mobs).toEqual(save.mobs);
    expect(round.mobs?.[0]?.type).toBe("zombie");
    expect(round.mobs?.[0]?.extra.lastAttackTick).toBe(40);
  });

  it("decodes mobs as an empty list when the save carries none", () => {
    const save: WorldSave = {
      version: 2,
      seed: 1,
      totalTicks: 0,
      player: samplePlayerMin(),
      columns: {},
      // mobs intentionally omitted
    };
    const round = deserializeSave(serializeSave(save));
    expect(round.mobs).toEqual([]);
  });
});
