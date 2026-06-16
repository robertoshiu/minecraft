/**
 * block-registry.ts — SHARED CONTRACT: per-block visual + physical properties.
 *
 * This is the single source of truth that the mesher (face culling), renderer
 * (atlas UVs + render-pass selection), lighting, and interaction systems all
 * consume. It maps every {@link BlockId} in {@link Blocks} to a {@link BlockDef}.
 *
 * Pure data + tiny accessors. No Babylon, no game logic.
 *
 * ---------------------------------------------------------------------------
 * Property semantics (read carefully — other systems branch on these):
 *
 *  - `solid`       Has collision; the player/mobs cannot pass through it.
 *  - `opaque`      Fully occludes the neighbor face touching it. The mesher
 *                  skips a face when the adjacent block is `opaque`, and
 *                  lighting treats `opaque` blocks as light blockers.
 *  - `transparent` Needs the alpha render pass (water/glass/leaves/torch).
 *                  Mutually exclusive with `opaque`: a block is exactly one of
 *                  {opaque, transparent}. (AIR is transparent, drawn by nobody.)
 *  - `liquid`      Water/lava. Always non-solid + non-opaque + transparent.
 *
 * Mesher note re: AIR — AIR is transparent and non-opaque, so a solid block
 * adjacent to AIR DOES emit a face (the face is only culled against `opaque`
 * neighbors). AIR itself contributes no geometry.
 *
 * ---------------------------------------------------------------------------
 * ATLAS TILE-INDEX MAPPING (16×16 grid → indices 0..255).
 *
 * Each distinct texture gets one tile index. The renderer must lay textures
 * out in the atlas at these indices (row-major: index = row*16 + col, so
 * index 0..15 is the top row, etc.). Per-face mapping lets one block use
 * multiple tiles (e.g. grass top/side/bottom, log end/bark).
 *
 *   idx  textureName            used by (block · faces)
 *   ---  --------------------   -----------------------------------------------
 *    0   air_blank              AIR (all faces — never rendered)
 *    1   stone                  STONE (all)
 *    2   dirt                   DIRT (all); GRASS bottom (ny)
 *    3   grass_top              GRASS top (py)
 *    4   grass_side             GRASS sides (px,nx,pz,nz)
 *    5   sand                   SAND (all)
 *    6   water                  WATER (all)
 *    7   oak_log_side           OAK_LOG bark sides (px,nx,pz,nz)
 *    8   oak_log_end            OAK_LOG end-grain (py,ny)
 *    9   oak_leaves             OAK_LEAVES (all)
 *   10   oak_planks             OAK_PLANKS (all)
 *   11   cobblestone            COBBLESTONE (all)
 *   12   glass                  GLASS (all)
 *   13   coal_ore               COAL_ORE (all)
 *   14   iron_ore               IRON_ORE (all)
 *   15   gold_ore               GOLD_ORE (all)
 *   16   redstone_ore           REDSTONE_ORE (all)
 *   17   diamond_ore            DIAMOND_ORE (all)
 *   18   lapis_ore              LAPIS_ORE (all)
 *   19   bedrock                BEDROCK (all)
 *   20   snow                   SNOW (all)
 *   21   gravel                 GRAVEL (all)
 *   22   crafting_table_top     CRAFTING_TABLE top (py)
 *   23   crafting_table_bottom  CRAFTING_TABLE bottom (ny) — plain planks look
 *   24   crafting_table_side    CRAFTING_TABLE sides (px,nx,pz,nz)
 *   25   furnace_top            FURNACE top + bottom (py,ny)
 *   26   furnace_side           FURNACE side/back (nx,pz,nz)
 *   27   furnace_front          FURNACE front (px) — the fire-hole face
 *   28   torch                  TORCH (all)
 *   29   glowstone              GLOWSTONE (all)
 *   30   lava                   LAVA (all)
 *   31   birch_log_side         BIRCH_LOG bark sides (px,nx,pz,nz)
 *   32   birch_log_end          BIRCH_LOG end-grain (py,ny)
 *   33   birch_leaves           BIRCH_LEAVES (all)
 *   34   birch_planks           BIRCH_PLANKS (all)
 *   35   bed                    BED (all)
 *   36   brewing_stand          BREWING_STAND (all)
 *
 * Highest index used: 36 (well within 0..255).
 */

import { Blocks, type BlockId } from "./mc-1.20";
import type { FaceDir } from "../chunk/data";

/** Per-block visual + physical properties. The shared contract. */
export interface BlockDef {
  /** The numeric block id this def describes. */
  id: BlockId;
  /** Human-readable name (debug/UI). */
  name: string;
  /** Has collision (player/mob can't pass). */
  solid: boolean;
  /** Fully occludes the neighbor face it touches (face-culling + lighting). */
  opaque: boolean;
  /** Needs the alpha render pass (water/glass/leaves/torch). `opaque===false`. */
  transparent: boolean;
  /** Water or lava. */
  liquid: boolean;
  /** Atlas tile index (0..255) for each of the six faces. */
  faceTiles: Record<FaceDir, number>;
}

// --- Atlas tile indices (see top-of-file mapping table) ---------------------
const TILE = {
  AIR_BLANK: 0,
  STONE: 1,
  DIRT: 2,
  GRASS_TOP: 3,
  GRASS_SIDE: 4,
  SAND: 5,
  WATER: 6,
  OAK_LOG_SIDE: 7,
  OAK_LOG_END: 8,
  OAK_LEAVES: 9,
  OAK_PLANKS: 10,
  COBBLESTONE: 11,
  GLASS: 12,
  COAL_ORE: 13,
  IRON_ORE: 14,
  GOLD_ORE: 15,
  REDSTONE_ORE: 16,
  DIAMOND_ORE: 17,
  LAPIS_ORE: 18,
  BEDROCK: 19,
  SNOW: 20,
  GRAVEL: 21,
  CRAFTING_TABLE_TOP: 22,
  CRAFTING_TABLE_BOTTOM: 23,
  CRAFTING_TABLE_SIDE: 24,
  FURNACE_TOP: 25,
  FURNACE_SIDE: 26,
  FURNACE_FRONT: 27,
  TORCH: 28,
  GLOWSTONE: 29,
  LAVA: 30,
  BIRCH_LOG_SIDE: 31,
  BIRCH_LOG_END: 32,
  BIRCH_LEAVES: 33,
  BIRCH_PLANKS: 34,
  BED: 35,
  BREWING_STAND: 36,
} as const;

/** Same tile on all six faces. */
function uniform(tile: number): Record<FaceDir, number> {
  return { px: tile, nx: tile, py: tile, ny: tile, pz: tile, nz: tile };
}

/**
 * A "pillar" block: distinct `top`/`bottom` (`py`/`ny`) end tile vs `side`
 * tile on the four horizontal faces (logs, crafting table, furnace).
 */
function pillar(top: number, bottom: number, side: number): Record<FaceDir, number> {
  return { px: side, nx: side, pz: side, nz: side, py: top, ny: bottom };
}

/** Build a fully-opaque solid cube (the common case). */
function opaqueCube(id: BlockId, name: string, faceTiles: Record<FaceDir, number>): BlockDef {
  return { id, name, solid: true, opaque: true, transparent: false, liquid: false, faceTiles };
}

/** Build a transparent solid (glass, leaves) — alpha pass, does not occlude. */
function transparentSolid(id: BlockId, name: string, faceTiles: Record<FaceDir, number>): BlockDef {
  return { id, name, solid: true, opaque: false, transparent: true, liquid: false, faceTiles };
}

/** Build a liquid (water, lava) — non-solid, non-opaque, transparent. */
function liquid(id: BlockId, name: string, tile: number): BlockDef {
  return {
    id,
    name,
    solid: false,
    opaque: false,
    transparent: true,
    liquid: true,
    faceTiles: uniform(tile),
  };
}

const DEFS: readonly BlockDef[] = [
  // AIR — empty; transparent + non-opaque so neighbors still draw faces against it.
  {
    id: Blocks.AIR,
    name: "Air",
    solid: false,
    opaque: false,
    transparent: true,
    liquid: false,
    faceTiles: uniform(TILE.AIR_BLANK),
  },

  // Opaque solids -----------------------------------------------------------
  opaqueCube(Blocks.STONE, "Stone", uniform(TILE.STONE)),
  opaqueCube(Blocks.DIRT, "Dirt", uniform(TILE.DIRT)),
  // GRASS: grass top, dirt bottom (matches DIRT's tile), grass-side on sides.
  opaqueCube(Blocks.GRASS, "Grass Block", pillar(TILE.GRASS_TOP, TILE.DIRT, TILE.GRASS_SIDE)),
  opaqueCube(Blocks.SAND, "Sand", uniform(TILE.SAND)),
  opaqueCube(Blocks.OAK_LOG, "Oak Log", pillar(TILE.OAK_LOG_END, TILE.OAK_LOG_END, TILE.OAK_LOG_SIDE)),
  opaqueCube(Blocks.OAK_PLANKS, "Oak Planks", uniform(TILE.OAK_PLANKS)),
  opaqueCube(Blocks.COBBLESTONE, "Cobblestone", uniform(TILE.COBBLESTONE)),
  opaqueCube(Blocks.COAL_ORE, "Coal Ore", uniform(TILE.COAL_ORE)),
  opaqueCube(Blocks.IRON_ORE, "Iron Ore", uniform(TILE.IRON_ORE)),
  opaqueCube(Blocks.GOLD_ORE, "Gold Ore", uniform(TILE.GOLD_ORE)),
  opaqueCube(Blocks.REDSTONE_ORE, "Redstone Ore", uniform(TILE.REDSTONE_ORE)),
  opaqueCube(Blocks.DIAMOND_ORE, "Diamond Ore", uniform(TILE.DIAMOND_ORE)),
  opaqueCube(Blocks.LAPIS_ORE, "Lapis Lazuli Ore", uniform(TILE.LAPIS_ORE)),
  opaqueCube(Blocks.BEDROCK, "Bedrock", uniform(TILE.BEDROCK)),
  opaqueCube(Blocks.SNOW, "Snow Block", uniform(TILE.SNOW)),
  opaqueCube(Blocks.GRAVEL, "Gravel", uniform(TILE.GRAVEL)),
  opaqueCube(
    Blocks.CRAFTING_TABLE,
    "Crafting Table",
    pillar(TILE.CRAFTING_TABLE_TOP, TILE.CRAFTING_TABLE_BOTTOM, TILE.CRAFTING_TABLE_SIDE),
  ),
  // FURNACE: top/bottom share furnace_top; front (px) is the fire hole, other sides plain.
  opaqueCube(Blocks.FURNACE, "Furnace", {
    py: TILE.FURNACE_TOP,
    ny: TILE.FURNACE_TOP,
    px: TILE.FURNACE_FRONT,
    nx: TILE.FURNACE_SIDE,
    pz: TILE.FURNACE_SIDE,
    nz: TILE.FURNACE_SIDE,
  }),
  opaqueCube(Blocks.GLOWSTONE, "Glowstone", uniform(TILE.GLOWSTONE)),
  opaqueCube(Blocks.BIRCH_LOG, "Birch Log", pillar(TILE.BIRCH_LOG_END, TILE.BIRCH_LOG_END, TILE.BIRCH_LOG_SIDE)),
  opaqueCube(Blocks.BIRCH_PLANKS, "Birch Planks", uniform(TILE.BIRCH_PLANKS)),

  // Transparent solids (alpha pass, no occlusion) --------------------------
  transparentSolid(Blocks.GLASS, "Glass", uniform(TILE.GLASS)),
  transparentSolid(Blocks.OAK_LEAVES, "Oak Leaves", uniform(TILE.OAK_LEAVES)),
  transparentSolid(Blocks.BIRCH_LEAVES, "Birch Leaves", uniform(TILE.BIRCH_LEAVES)),
  // TORCH: non-solid emissive decoration; treated transparent for the alpha pass.
  {
    id: Blocks.TORCH,
    name: "Torch",
    solid: false,
    opaque: false,
    transparent: true,
    liquid: false,
    faceTiles: uniform(TILE.TORCH),
  },

  // Bed — transparent solid (alpha pass, no occlusion); single-block simplification.
  transparentSolid(Blocks.BED, "Bed", uniform(TILE.BED)),

  // Brewing stand — transparent solid (alpha pass, no occlusion); interactive
  // block opened via RMB (mirrors crafting table). Solid so the player cannot
  // walk through it; non-opaque so it renders in the alpha pass like the bed.
  transparentSolid(Blocks.BREWING_STAND, "Brewing Stand", uniform(TILE.BREWING_STAND)),

  // Liquids -----------------------------------------------------------------
  liquid(Blocks.WATER, "Water", TILE.WATER),
  liquid(Blocks.LAVA, "Lava", TILE.LAVA),
];

/**
 * The registry: a frozen map from numeric block id to its {@link BlockDef}.
 * Keyed by `number` (not `BlockId`) so callers can index with raw values.
 */
export const BLOCK_REGISTRY: Readonly<Record<number, BlockDef>> = Object.freeze(
  DEFS.reduce<Record<number, BlockDef>>((acc, def) => {
    acc[def.id] = def;
    return acc;
  }, {}),
);

/** Look up a block's definition. Throws on an unknown id. */
export function getBlockDef(id: BlockId): BlockDef {
  const def = BLOCK_REGISTRY[id];
  if (def === undefined) {
    throw new Error(`getBlockDef: unknown block id ${String(id)}`);
  }
  return def;
}

/** True iff the block has collision. Throws on an unknown id. */
export function isSolid(id: BlockId): boolean {
  return getBlockDef(id).solid;
}

/** True iff the block fully occludes adjacent faces. Throws on an unknown id. */
export function isOpaque(id: BlockId): boolean {
  return getBlockDef(id).opaque;
}

/** True iff the block renders in the alpha pass. Throws on an unknown id. */
export function isTransparent(id: BlockId): boolean {
  return getBlockDef(id).transparent;
}

/** True iff the block is a liquid. Throws on an unknown id. */
export function isLiquid(id: BlockId): boolean {
  return getBlockDef(id).liquid;
}

/** Atlas tile index (0..255) for the given block face. Throws on an unknown id. */
export function faceTile(id: BlockId, dir: FaceDir): number {
  return getBlockDef(id).faceTiles[dir];
}
