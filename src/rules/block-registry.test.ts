import { describe, it, expect } from "vitest";
import { Blocks, type BlockId } from "./mc-1.20";
import type { FaceDir } from "../chunk/data";
import {
  BLOCK_REGISTRY,
  getBlockDef,
  isSolid,
  isOpaque,
  isTransparent,
  isLiquid,
  faceTile,
} from "./block-registry";

const ALL_IDS: readonly BlockId[] = Object.values(Blocks);
const ALL_FACES: readonly FaceDir[] = ["px", "nx", "py", "ny", "pz", "nz"];

describe("BLOCK_REGISTRY — completeness", () => {
  it("has an entry for every id in Blocks", () => {
    for (const id of ALL_IDS) {
      const def = BLOCK_REGISTRY[id];
      expect(def, `missing registry entry for block id ${id}`).toBeDefined();
      expect(def?.id).toBe(id);
    }
  });

  it("has no entries for unknown ids beyond Blocks", () => {
    const known = new Set<number>(ALL_IDS);
    for (const key of Object.keys(BLOCK_REGISTRY)) {
      expect(known.has(Number(key))).toBe(true);
    }
  });

  it("every def has a non-empty name and 6 face tiles", () => {
    for (const id of ALL_IDS) {
      const def = getBlockDef(id);
      expect(def.name.length).toBeGreaterThan(0);
      for (const f of ALL_FACES) {
        expect(typeof def.faceTiles[f]).toBe("number");
      }
    }
  });
});

describe("BLOCK_REGISTRY — per-block property contracts", () => {
  it("AIR: not solid, not opaque, transparent, not liquid", () => {
    const air = getBlockDef(Blocks.AIR);
    expect(air.solid).toBe(false);
    expect(air.opaque).toBe(false);
    expect(air.transparent).toBe(true);
    expect(air.liquid).toBe(false);
  });

  it("STONE: solid + opaque + not transparent + not liquid", () => {
    const stone = getBlockDef(Blocks.STONE);
    expect(stone.solid).toBe(true);
    expect(stone.opaque).toBe(true);
    expect(stone.transparent).toBe(false);
    expect(stone.liquid).toBe(false);
  });

  it("WATER: not solid, transparent, not opaque, liquid", () => {
    const water = getBlockDef(Blocks.WATER);
    expect(water.solid).toBe(false);
    expect(water.transparent).toBe(true);
    expect(water.opaque).toBe(false);
    expect(water.liquid).toBe(true);
  });

  it("LAVA: not solid, not opaque, transparent, liquid", () => {
    const lava = getBlockDef(Blocks.LAVA);
    expect(lava.solid).toBe(false);
    expect(lava.opaque).toBe(false);
    expect(lava.transparent).toBe(true);
    expect(lava.liquid).toBe(true);
  });

  it("GLASS: solid, transparent, not opaque, not liquid", () => {
    const glass = getBlockDef(Blocks.GLASS);
    expect(glass.solid).toBe(true);
    expect(glass.transparent).toBe(true);
    expect(glass.opaque).toBe(false);
    expect(glass.liquid).toBe(false);
  });

  it("LEAVES (oak + birch): solid, transparent, not opaque", () => {
    for (const id of [Blocks.OAK_LEAVES, Blocks.BIRCH_LEAVES] as const) {
      const def = getBlockDef(id);
      expect(def.solid, `${def.name} solid`).toBe(true);
      expect(def.transparent, `${def.name} transparent`).toBe(true);
      expect(def.opaque, `${def.name} opaque`).toBe(false);
    }
  });

  it("TORCH: not solid, not opaque, transparent", () => {
    const torch = getBlockDef(Blocks.TORCH);
    expect(torch.solid).toBe(false);
    expect(torch.opaque).toBe(false);
    expect(torch.transparent).toBe(true);
  });

  it("opaque blocks are never transparent and vice versa (mutually exclusive)", () => {
    for (const id of ALL_IDS) {
      const def = getBlockDef(id);
      expect(def.opaque && def.transparent, `${def.name} cannot be both`).toBe(false);
      // every block is either opaque or transparent (full classification)
      expect(def.opaque || def.transparent, `${def.name} must be one`).toBe(true);
    }
  });

  it("liquids are non-solid and transparent", () => {
    for (const id of ALL_IDS) {
      const def = getBlockDef(id);
      if (def.liquid) {
        expect(def.solid, `${def.name} liquid solid`).toBe(false);
        expect(def.opaque, `${def.name} liquid opaque`).toBe(false);
        expect(def.transparent, `${def.name} liquid transparent`).toBe(true);
      }
    }
  });
});

describe("BLOCK_REGISTRY — per-face tiles", () => {
  it("GRASS: top tile !== bottom tile, side tile differs from top", () => {
    const grass = getBlockDef(Blocks.GRASS);
    const top = grass.faceTiles.py;
    const bottom = grass.faceTiles.ny;
    const side = grass.faceTiles.px;
    expect(top).not.toBe(bottom);
    expect(side).not.toBe(top);
    // all 4 horizontal sides share the same tile
    expect(grass.faceTiles.px).toBe(grass.faceTiles.nx);
    expect(grass.faceTiles.px).toBe(grass.faceTiles.pz);
    expect(grass.faceTiles.px).toBe(grass.faceTiles.nz);
  });

  it("GRASS bottom uses the same tile as DIRT (top of dirt)", () => {
    const grass = getBlockDef(Blocks.GRASS);
    const dirt = getBlockDef(Blocks.DIRT);
    expect(grass.faceTiles.ny).toBe(dirt.faceTiles.py);
  });

  it("OAK_LOG: top/bottom end-grain tile differs from side bark tile", () => {
    const log = getBlockDef(Blocks.OAK_LOG);
    expect(log.faceTiles.py).toBe(log.faceTiles.ny); // both ends share end-grain
    expect(log.faceTiles.py).not.toBe(log.faceTiles.px); // end vs bark
    expect(log.faceTiles.px).toBe(log.faceTiles.pz); // all bark sides equal
  });

  it("BIRCH_LOG: top/bottom end-grain tile differs from side bark tile", () => {
    const log = getBlockDef(Blocks.BIRCH_LOG);
    expect(log.faceTiles.py).toBe(log.faceTiles.ny);
    expect(log.faceTiles.py).not.toBe(log.faceTiles.px);
  });

  it("STONE: all six faces share one tile (uniform cube)", () => {
    const stone = getBlockDef(Blocks.STONE);
    const t = stone.faceTiles.px;
    for (const f of ALL_FACES) {
      expect(stone.faceTiles[f]).toBe(t);
    }
  });

  it("every tile index is an integer in 0..255 for all blocks/faces", () => {
    for (const id of ALL_IDS) {
      const def = getBlockDef(id);
      for (const f of ALL_FACES) {
        const t = faceTile(id, f);
        expect(Number.isInteger(t)).toBe(true);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(255);
        expect(t).toBe(def.faceTiles[f]);
      }
    }
  });
});

describe("getBlockDef / faceTile error handling", () => {
  it("getBlockDef throws on an unknown id", () => {
    expect(() => getBlockDef(9999 as BlockId)).toThrow();
  });

  it("faceTile throws on an unknown id", () => {
    expect(() => faceTile(9999 as BlockId, "px")).toThrow();
  });
});

describe("helper consistency with BLOCK_REGISTRY", () => {
  it("isSolid/isOpaque/isTransparent/isLiquid match the registry for all ids", () => {
    for (const id of ALL_IDS) {
      const def = BLOCK_REGISTRY[id];
      expect(def).toBeDefined();
      if (!def) continue;
      expect(isSolid(id)).toBe(def.solid);
      expect(isOpaque(id)).toBe(def.opaque);
      expect(isTransparent(id)).toBe(def.transparent);
      expect(isLiquid(id)).toBe(def.liquid);
    }
  });

  it("faceTile matches the registry for all ids and faces", () => {
    for (const id of ALL_IDS) {
      const def = BLOCK_REGISTRY[id];
      expect(def).toBeDefined();
      if (!def) continue;
      for (const f of ALL_FACES) {
        expect(faceTile(id, f)).toBe(def.faceTiles[f]);
      }
    }
  });

  it("solid helpers throw on unknown ids", () => {
    expect(() => isSolid(9999 as BlockId)).toThrow();
    expect(() => isOpaque(9999 as BlockId)).toThrow();
    expect(() => isTransparent(9999 as BlockId)).toThrow();
    expect(() => isLiquid(9999 as BlockId)).toThrow();
  });
});
