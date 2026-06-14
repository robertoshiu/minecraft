import { describe, it, expect } from "vitest";
import { SFX, blockBreakSound, placeSound, footstepSound } from "./specs";
import { Blocks } from "../rules/mc-1.20";

// All required SFX keys from the spec.
const REQUIRED_KEYS = [
  "break_stone",
  "break_dirt",
  "break_grass",
  "break_wood",
  "break_sand",
  "break_glass",
  "place_block",
  "footstep_grass",
  "footstep_stone",
  "footstep_sand",
  "mob_zombie",
  "mob_skeleton",
  "mob_cow",
  "mob_pig",
  "mob_sheep",
  "mob_chicken",
  "mob_creeper_hiss",
  "mob_hurt",
  "mob_death",
  "explosion",
  "ambient_wind",
] as const;

describe("SFX catalogue", () => {
  it("contains all required keys", () => {
    for (const key of REQUIRED_KEYS) {
      expect(SFX).toHaveProperty(key);
    }
  });

  it("all entries have a positive durationMs", () => {
    for (const [key, spec] of Object.entries(SFX)) {
      expect(spec.durationMs, `${key}.durationMs`).toBeGreaterThan(0);
    }
  });

  it("ambient_wind has loop:true", () => {
    expect(SFX["ambient_wind"]?.loop).toBe(true);
  });

  it("ambient_wind has a durationMs >= 1000 (longer ambient)", () => {
    expect(SFX["ambient_wind"]?.durationMs).toBeGreaterThanOrEqual(1000);
  });

  it("all optional freqHz values are positive when present", () => {
    for (const [key, spec] of Object.entries(SFX)) {
      if (spec.freqHz !== undefined) {
        expect(spec.freqHz, `${key}.freqHz`).toBeGreaterThan(0);
      }
    }
  });

  it("all optional filterHz values are positive when present", () => {
    for (const [key, spec] of Object.entries(SFX)) {
      if (spec.filterHz !== undefined) {
        expect(spec.filterHz, `${key}.filterHz`).toBeGreaterThan(0);
      }
    }
  });
});

describe("blockBreakSound", () => {
  it("maps STONE to break_stone", () => {
    expect(blockBreakSound(Blocks.STONE)).toBe("break_stone");
  });

  it("maps COBBLESTONE to break_stone", () => {
    expect(blockBreakSound(Blocks.COBBLESTONE)).toBe("break_stone");
  });

  it("maps COAL_ORE to break_stone", () => {
    expect(blockBreakSound(Blocks.COAL_ORE)).toBe("break_stone");
  });

  it("maps IRON_ORE to break_stone", () => {
    expect(blockBreakSound(Blocks.IRON_ORE)).toBe("break_stone");
  });

  it("maps DIAMOND_ORE to break_stone", () => {
    expect(blockBreakSound(Blocks.DIAMOND_ORE)).toBe("break_stone");
  });

  it("maps DIRT to break_dirt", () => {
    expect(blockBreakSound(Blocks.DIRT)).toBe("break_dirt");
  });

  it("maps GRASS to break_grass", () => {
    expect(blockBreakSound(Blocks.GRASS)).toBe("break_grass");
  });

  it("maps OAK_LOG to break_wood", () => {
    expect(blockBreakSound(Blocks.OAK_LOG)).toBe("break_wood");
  });

  it("maps OAK_PLANKS to break_wood", () => {
    expect(blockBreakSound(Blocks.OAK_PLANKS)).toBe("break_wood");
  });

  it("maps CRAFTING_TABLE to break_wood", () => {
    expect(blockBreakSound(Blocks.CRAFTING_TABLE)).toBe("break_wood");
  });

  it("maps GLASS to break_glass", () => {
    expect(blockBreakSound(Blocks.GLASS)).toBe("break_glass");
  });

  it("maps SAND to break_sand", () => {
    expect(blockBreakSound(Blocks.SAND)).toBe("break_sand");
  });

  it("returns a key that exists in SFX", () => {
    const blockIds = Object.values(Blocks).filter(
      (v) => typeof v === "number",
    ) as number[];
    for (const id of blockIds) {
      const key = blockBreakSound(id);
      expect(SFX, `SFX["${key}"] for block id ${id}`).toHaveProperty(key);
    }
  });
});

describe("placeSound", () => {
  it("returns place_block", () => {
    expect(placeSound()).toBe("place_block");
  });

  it("returns a key present in SFX", () => {
    expect(SFX).toHaveProperty(placeSound());
  });
});

describe("footstepSound", () => {
  it("maps GRASS to footstep_grass", () => {
    expect(footstepSound(Blocks.GRASS)).toBe("footstep_grass");
  });

  it("maps STONE to footstep_stone", () => {
    expect(footstepSound(Blocks.STONE)).toBe("footstep_stone");
  });

  it("maps OAK_PLANKS to footstep_stone", () => {
    expect(footstepSound(Blocks.OAK_PLANKS)).toBe("footstep_stone");
  });

  it("maps SAND to footstep_sand", () => {
    expect(footstepSound(Blocks.SAND)).toBe("footstep_sand");
  });

  it("maps SNOW to footstep_grass", () => {
    expect(footstepSound(Blocks.SNOW)).toBe("footstep_grass");
  });

  it("returns a key that exists in SFX", () => {
    const blockIds = Object.values(Blocks).filter(
      (v) => typeof v === "number",
    ) as number[];
    for (const id of blockIds) {
      const key = footstepSound(id);
      expect(SFX, `SFX["${key}"] for block id ${id}`).toHaveProperty(key);
    }
  });
});
