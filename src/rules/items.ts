/**
 * items.ts — the ITEM REGISTRY: every thing that can live in an inventory slot.
 *
 * An item id (`ItemId`) is a bare number with two disjoint ranges:
 *
 *  - BLOCK items reuse the {@link BlockId} verbatim, so a placed block's item id
 *    is identical to its block id (0..27 for the current {@link Blocks} table).
 *    Their {@link ItemDef.placesBlock} points back at that block id.
 *  - NON-block items (materials, tools, food, sticks…) start at {@link NON_BLOCK_BASE}
 *    (256) to leave generous headroom above the block range and avoid collisions.
 *
 * Pure data + small accessors. No Babylon, no game logic. The durability/food
 * numbers all originate in {@link ../rules/mc-1.20}.
 */

import {
  Blocks,
  type BlockId,
  FOOD_VALUES,
  TOOL_DURABILITY,
} from "./mc-1.20";

/** A numeric item identifier. Block items reuse the block id; non-block items start at 256. */
export type ItemId = number;

/** Base id for the first non-block item. Block ids occupy 0..(this-1). */
export const NON_BLOCK_BASE = 256 as const;

/** Tool material tiers (carry durability via {@link TOOL_DURABILITY}). */
export type ToolTier = "wood" | "stone" | "iron" | "diamond" | "gold";
/** Tool kinds. */
export type ToolType = "pickaxe" | "axe" | "shovel" | "sword" | "hoe";

/** A single item's definition. */
export interface ItemDef {
  id: ItemId;
  name: string;
  maxStack: number;
  kind: "block" | "tool" | "food" | "material";
  /** Block placed when this item is used (block items only). */
  placesBlock?: BlockId;
  /** Tool material tier (tools only). */
  toolTier?: ToolTier;
  /** Tool kind (tools only). */
  toolType?: ToolType;
  /** Hunger/saturation restored when eaten (food only). */
  food?: { hunger: number; saturation: number };
}

/**
 * Non-block item ids. Contiguous from {@link NON_BLOCK_BASE} so the whole set
 * stays comfortably above the block range. Order here is only cosmetic.
 */
export const Items = {
  STICK: NON_BLOCK_BASE + 0,
  COAL: NON_BLOCK_BASE + 1,
  RAW_IRON: NON_BLOCK_BASE + 2,
  IRON_INGOT: NON_BLOCK_BASE + 3,
  GOLD_INGOT: NON_BLOCK_BASE + 4,
  DIAMOND: NON_BLOCK_BASE + 5,
  LAPIS: NON_BLOCK_BASE + 6,
  REDSTONE: NON_BLOCK_BASE + 7,
  APPLE: NON_BLOCK_BASE + 8,
  WHEAT: NON_BLOCK_BASE + 9,
  SEEDS: NON_BLOCK_BASE + 10,
  BREAD: NON_BLOCK_BASE + 11,
  RAW_BEEF: NON_BLOCK_BASE + 12,
  STEAK: NON_BLOCK_BASE + 13,
  RAW_PORKCHOP: NON_BLOCK_BASE + 14,
  COOKED_PORKCHOP: NON_BLOCK_BASE + 15,
  RAW_CHICKEN: NON_BLOCK_BASE + 16,
  COOKED_CHICKEN: NON_BLOCK_BASE + 17,
  WOOL: NON_BLOCK_BASE + 18,
  LEATHER: NON_BLOCK_BASE + 19,
  FEATHER: NON_BLOCK_BASE + 20,
  COAL_BLOCK: NON_BLOCK_BASE + 21,

  // Tools — tier × type. (gold is the "golden" prefix in MC naming.)
  WOODEN_PICKAXE: NON_BLOCK_BASE + 22,
  WOODEN_AXE: NON_BLOCK_BASE + 23,
  WOODEN_SHOVEL: NON_BLOCK_BASE + 24,
  WOODEN_SWORD: NON_BLOCK_BASE + 25,
  WOODEN_HOE: NON_BLOCK_BASE + 26,
  STONE_PICKAXE: NON_BLOCK_BASE + 27,
  STONE_AXE: NON_BLOCK_BASE + 28,
  STONE_SHOVEL: NON_BLOCK_BASE + 29,
  STONE_SWORD: NON_BLOCK_BASE + 30,
  STONE_HOE: NON_BLOCK_BASE + 31,
  IRON_PICKAXE: NON_BLOCK_BASE + 32,
  IRON_AXE: NON_BLOCK_BASE + 33,
  IRON_SHOVEL: NON_BLOCK_BASE + 34,
  IRON_SWORD: NON_BLOCK_BASE + 35,
  IRON_HOE: NON_BLOCK_BASE + 36,
  DIAMOND_PICKAXE: NON_BLOCK_BASE + 37,
  DIAMOND_AXE: NON_BLOCK_BASE + 38,
  DIAMOND_SHOVEL: NON_BLOCK_BASE + 39,
  DIAMOND_SWORD: NON_BLOCK_BASE + 40,
  DIAMOND_HOE: NON_BLOCK_BASE + 41,
  GOLDEN_PICKAXE: NON_BLOCK_BASE + 42,
  GOLDEN_AXE: NON_BLOCK_BASE + 43,
  GOLDEN_SHOVEL: NON_BLOCK_BASE + 44,
  GOLDEN_SWORD: NON_BLOCK_BASE + 45,
  GOLDEN_HOE: NON_BLOCK_BASE + 46,
} as const;

/** Default stack size for ordinary (non-tool) items. */
const DEFAULT_MAX_STACK = 64;

// --- Internal builders -----------------------------------------------------

function material(id: ItemId, name: string): ItemDef {
  return { id, name, maxStack: DEFAULT_MAX_STACK, kind: "material" };
}

function food(
  id: ItemId,
  name: string,
  value: { hunger: number; saturation: number },
): ItemDef {
  return {
    id,
    name,
    maxStack: DEFAULT_MAX_STACK,
    kind: "food",
    food: { hunger: value.hunger, saturation: value.saturation },
  };
}

function tool(
  id: ItemId,
  name: string,
  toolTier: ToolTier,
  toolType: ToolType,
): ItemDef {
  return { id, name, maxStack: 1, kind: "tool", toolTier, toolType };
}

function blockItem(id: BlockId, name: string): ItemDef {
  return {
    id,
    name,
    maxStack: DEFAULT_MAX_STACK,
    kind: "block",
    placesBlock: id,
  };
}

// --- Food values (pulled from FOOD_VALUES where present) -------------------

const STEAK_FOOD = FOOD_VALUES["steak"] ?? { hunger: 8, saturation: 12.8 };
const BREAD_FOOD = FOOD_VALUES["bread"] ?? { hunger: 5, saturation: 6 };
const APPLE_FOOD = FOOD_VALUES["apple"] ?? { hunger: 4, saturation: 2.4 };
const COOKED_PORK_FOOD =
  FOOD_VALUES["cooked_porkchop"] ?? { hunger: 8, saturation: 12.8 };
const COOKED_CHICKEN_FOOD =
  FOOD_VALUES["cooked_chicken"] ?? { hunger: 6, saturation: 7.2 };

// Raw foods are not in FOOD_VALUES (only cooked variants are referenced by the
// rules table); give them sensible MC-1.20 raw values.
const RAW_BEEF_FOOD = { hunger: 3, saturation: 1.8 };
const RAW_PORK_FOOD = { hunger: 3, saturation: 1.8 };
const RAW_CHICKEN_FOOD = { hunger: 2, saturation: 1.2 };

// --- Block id → display name (mirrors block-registry names) ----------------

const BLOCK_ITEM_NAMES: Readonly<Record<BlockId, string>> = {
  [Blocks.AIR]: "Air",
  [Blocks.STONE]: "Stone",
  [Blocks.DIRT]: "Dirt",
  [Blocks.GRASS]: "Grass Block",
  [Blocks.SAND]: "Sand",
  [Blocks.WATER]: "Water",
  [Blocks.OAK_LOG]: "Oak Log",
  [Blocks.OAK_LEAVES]: "Oak Leaves",
  [Blocks.OAK_PLANKS]: "Oak Planks",
  [Blocks.COBBLESTONE]: "Cobblestone",
  [Blocks.GLASS]: "Glass",
  [Blocks.COAL_ORE]: "Coal Ore",
  [Blocks.IRON_ORE]: "Iron Ore",
  [Blocks.GOLD_ORE]: "Gold Ore",
  [Blocks.REDSTONE_ORE]: "Redstone Ore",
  [Blocks.DIAMOND_ORE]: "Diamond Ore",
  [Blocks.LAPIS_ORE]: "Lapis Lazuli Ore",
  [Blocks.BEDROCK]: "Bedrock",
  [Blocks.SNOW]: "Snow Block",
  [Blocks.GRAVEL]: "Gravel",
  [Blocks.CRAFTING_TABLE]: "Crafting Table",
  [Blocks.FURNACE]: "Furnace",
  [Blocks.TORCH]: "Torch",
  [Blocks.GLOWSTONE]: "Glowstone",
  [Blocks.LAVA]: "Lava",
  [Blocks.BIRCH_LOG]: "Birch Log",
  [Blocks.BIRCH_LEAVES]: "Birch Leaves",
  [Blocks.BIRCH_PLANKS]: "Birch Planks",
  [Blocks.BED]: "Bed",
};

// --- Assemble all defs -----------------------------------------------------

const NON_BLOCK_DEFS: readonly ItemDef[] = [
  material(Items.STICK, "Stick"),
  material(Items.COAL, "Coal"),
  material(Items.RAW_IRON, "Raw Iron"),
  material(Items.IRON_INGOT, "Iron Ingot"),
  material(Items.GOLD_INGOT, "Gold Ingot"),
  material(Items.DIAMOND, "Diamond"),
  material(Items.LAPIS, "Lapis Lazuli"),
  material(Items.REDSTONE, "Redstone Dust"),
  food(Items.APPLE, "Apple", APPLE_FOOD),
  material(Items.WHEAT, "Wheat"),
  material(Items.SEEDS, "Wheat Seeds"),
  food(Items.BREAD, "Bread", BREAD_FOOD),
  food(Items.RAW_BEEF, "Raw Beef", RAW_BEEF_FOOD),
  food(Items.STEAK, "Steak", STEAK_FOOD),
  food(Items.RAW_PORKCHOP, "Raw Porkchop", RAW_PORK_FOOD),
  food(Items.COOKED_PORKCHOP, "Cooked Porkchop", COOKED_PORK_FOOD),
  food(Items.RAW_CHICKEN, "Raw Chicken", RAW_CHICKEN_FOOD),
  food(Items.COOKED_CHICKEN, "Cooked Chicken", COOKED_CHICKEN_FOOD),
  material(Items.WOOL, "Wool"),
  material(Items.LEATHER, "Leather"),
  material(Items.FEATHER, "Feather"),
  material(Items.COAL_BLOCK, "Block of Coal"),

  tool(Items.WOODEN_PICKAXE, "Wooden Pickaxe", "wood", "pickaxe"),
  tool(Items.WOODEN_AXE, "Wooden Axe", "wood", "axe"),
  tool(Items.WOODEN_SHOVEL, "Wooden Shovel", "wood", "shovel"),
  tool(Items.WOODEN_SWORD, "Wooden Sword", "wood", "sword"),
  tool(Items.WOODEN_HOE, "Wooden Hoe", "wood", "hoe"),
  tool(Items.STONE_PICKAXE, "Stone Pickaxe", "stone", "pickaxe"),
  tool(Items.STONE_AXE, "Stone Axe", "stone", "axe"),
  tool(Items.STONE_SHOVEL, "Stone Shovel", "stone", "shovel"),
  tool(Items.STONE_SWORD, "Stone Sword", "stone", "sword"),
  tool(Items.STONE_HOE, "Stone Hoe", "stone", "hoe"),
  tool(Items.IRON_PICKAXE, "Iron Pickaxe", "iron", "pickaxe"),
  tool(Items.IRON_AXE, "Iron Axe", "iron", "axe"),
  tool(Items.IRON_SHOVEL, "Iron Shovel", "iron", "shovel"),
  tool(Items.IRON_SWORD, "Iron Sword", "iron", "sword"),
  tool(Items.IRON_HOE, "Iron Hoe", "iron", "hoe"),
  tool(Items.DIAMOND_PICKAXE, "Diamond Pickaxe", "diamond", "pickaxe"),
  tool(Items.DIAMOND_AXE, "Diamond Axe", "diamond", "axe"),
  tool(Items.DIAMOND_SHOVEL, "Diamond Shovel", "diamond", "shovel"),
  tool(Items.DIAMOND_SWORD, "Diamond Sword", "diamond", "sword"),
  tool(Items.DIAMOND_HOE, "Diamond Hoe", "diamond", "hoe"),
  tool(Items.GOLDEN_PICKAXE, "Golden Pickaxe", "gold", "pickaxe"),
  tool(Items.GOLDEN_AXE, "Golden Axe", "gold", "axe"),
  tool(Items.GOLDEN_SHOVEL, "Golden Shovel", "gold", "shovel"),
  tool(Items.GOLDEN_SWORD, "Golden Sword", "gold", "sword"),
  tool(Items.GOLDEN_HOE, "Golden Hoe", "gold", "hoe"),
];

/** Block items whose max stack differs from the default 64. */
const BLOCK_MAX_STACK_OVERRIDES: Partial<Record<BlockId, number>> = {
  [Blocks.BED]: 1,
};

const BLOCK_DEFS: readonly ItemDef[] = (Object.values(Blocks) as BlockId[]).map(
  (id) => {
    const def = blockItem(id, BLOCK_ITEM_NAMES[id] ?? `Block ${String(id)}`);
    const override = BLOCK_MAX_STACK_OVERRIDES[id];
    if (override !== undefined) {
      return { ...def, maxStack: override };
    }
    return def;
  },
);

/**
 * The registry: a frozen map from numeric item id to {@link ItemDef}. Keyed by
 * `number` so callers can index with raw values. Contains a block-item def for
 * every {@link BlockId} plus every non-block item.
 */
export const ITEM_REGISTRY: Readonly<Record<number, ItemDef>> = Object.freeze(
  [...BLOCK_DEFS, ...NON_BLOCK_DEFS].reduce<Record<number, ItemDef>>(
    (acc, def) => {
      acc[def.id] = def;
      return acc;
    },
    {},
  ),
);

// --- Accessors -------------------------------------------------------------

/** Look up an item's definition. Throws on an unknown id. */
export function getItemDef(id: ItemId): ItemDef {
  const def = ITEM_REGISTRY[id];
  if (def === undefined) {
    throw new Error(`getItemDef: unknown item id ${String(id)}`);
  }
  return def;
}

/** True iff using this item places a block in the world. */
export function isPlaceable(id: ItemId): boolean {
  return getItemDef(id).placesBlock !== undefined;
}

/** The block this item places, or null if it places nothing. */
export function placedBlock(id: ItemId): BlockId | null {
  return getItemDef(id).placesBlock ?? null;
}

/** True iff this item is edible. */
export function isFood(id: ItemId): boolean {
  return getItemDef(id).kind === "food";
}

/** True iff this item is a tool. */
export function isTool(id: ItemId): boolean {
  return getItemDef(id).kind === "tool";
}

/** Maximum stack size for the item. Throws on an unknown id. */
export function maxStackOf(id: ItemId): number {
  return getItemDef(id).maxStack;
}

/** Durability (uses) for a tool item, or null for non-tools. */
export function toolDurabilityOf(id: ItemId): number | null {
  const def = getItemDef(id);
  if (def.kind !== "tool" || def.toolTier === undefined) return null;
  return TOOL_DURABILITY[def.toolTier];
}
