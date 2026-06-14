/**
 * recipes.ts — the crafting + smelting recipe data.
 *
 * Recipes are pure data; matching logic lives in {@link ./matcher}. Two crafting
 * shapes are supported:
 *
 *  - SHAPED   — a `pattern` grid of item ids (or null for empty). Matching trims
 *               empty rows/cols (position-independent) and allows a horizontal
 *               mirror (see {@link ./matcher#findRecipe}).
 *  - SHAPELESS — an unordered `ingredients` multiset.
 *
 * Smelting is a separate flat input→output table.
 */

import { Blocks } from "../rules/mc-1.20";
import { Items, type ItemId } from "../rules/items";

export type RecipeType = "shaped" | "shapeless";

export interface Recipe {
  id: string;
  type: RecipeType;
  /** SHAPED only: rows of item ids; null = empty cell. */
  pattern?: (ItemId | null)[][];
  /** SHAPELESS only: the unordered ingredient multiset. */
  ingredients?: ItemId[];
  result: ItemId;
  count: number;
}

// Convenience aliases for readability in the pattern grids below.
const OAK_PLANKS = Blocks.OAK_PLANKS;
const BIRCH_PLANKS = Blocks.BIRCH_PLANKS;
const COBBLE = Blocks.COBBLESTONE;
const STICK = Items.STICK;
const WOOL = Items.WOOL;
const _ = null;

export const RECIPES: Recipe[] = [
  // --- Shapeless ----------------------------------------------------------
  // 1 log → 4 planks (oak + birch).
  {
    id: "oak_planks",
    type: "shapeless",
    ingredients: [Blocks.OAK_LOG],
    result: OAK_PLANKS,
    count: 4,
  },
  {
    id: "birch_planks",
    type: "shapeless",
    ingredients: [Blocks.BIRCH_LOG],
    result: BIRCH_PLANKS,
    count: 4,
  },

  // --- Shaped -------------------------------------------------------------
  // 2 planks stacked vertically → 4 sticks.
  {
    id: "sticks",
    type: "shaped",
    pattern: [[OAK_PLANKS], [OAK_PLANKS]],
    result: STICK,
    count: 4,
  },
  // 2×2 planks → 1 crafting table.
  {
    id: "crafting_table",
    type: "shaped",
    pattern: [
      [OAK_PLANKS, OAK_PLANKS],
      [OAK_PLANKS, OAK_PLANKS],
    ],
    result: Blocks.CRAFTING_TABLE,
    count: 1,
  },
  // 8 cobblestone ring (empty center) → 1 furnace.
  {
    id: "furnace",
    type: "shaped",
    pattern: [
      [COBBLE, COBBLE, COBBLE],
      [COBBLE, _, COBBLE],
      [COBBLE, COBBLE, COBBLE],
    ],
    result: Blocks.FURNACE,
    count: 1,
  },
  // 8 planks ring (empty center) → 1 chest. There is no dedicated CHEST block id
  // in the Blocks table, so we emit OAK_PLANKS (the material) as the placeholder
  // result while preserving MC's real 8-plank ring shape for matching.
  {
    id: "chest",
    type: "shaped",
    pattern: [
      [OAK_PLANKS, OAK_PLANKS, OAK_PLANKS],
      [OAK_PLANKS, _, OAK_PLANKS],
      [OAK_PLANKS, OAK_PLANKS, OAK_PLANKS],
    ],
    result: OAK_PLANKS,
    count: 1,
  },
  // Coal over a stick → 4 torches.
  {
    id: "torch",
    type: "shaped",
    pattern: [[Items.COAL], [STICK]],
    result: Blocks.TORCH,
    count: 4,
  },
  // Bread: 3 wheat in a row → 1 bread.
  {
    id: "bread",
    type: "shaped",
    pattern: [[Items.WHEAT, Items.WHEAT, Items.WHEAT]],
    result: Items.BREAD,
    count: 1,
  },

  // --- Tools: pickaxe (3 head, 2 stick handle) ----------------------------
  {
    id: "wooden_pickaxe",
    type: "shaped",
    pattern: [
      [OAK_PLANKS, OAK_PLANKS, OAK_PLANKS],
      [_, STICK, _],
      [_, STICK, _],
    ],
    result: Items.WOODEN_PICKAXE,
    count: 1,
  },
  {
    id: "stone_pickaxe",
    type: "shaped",
    pattern: [
      [COBBLE, COBBLE, COBBLE],
      [_, STICK, _],
      [_, STICK, _],
    ],
    result: Items.STONE_PICKAXE,
    count: 1,
  },
  {
    id: "iron_pickaxe",
    type: "shaped",
    pattern: [
      [Items.IRON_INGOT, Items.IRON_INGOT, Items.IRON_INGOT],
      [_, STICK, _],
      [_, STICK, _],
    ],
    result: Items.IRON_PICKAXE,
    count: 1,
  },

  // --- Tools: axe (2 head L-shape + 2 stick) ------------------------------
  // Real MC oak axe (right-handed): head occupies top-left 2 + middle-left 1.
  {
    id: "wooden_axe",
    type: "shaped",
    pattern: [
      [OAK_PLANKS, OAK_PLANKS],
      [OAK_PLANKS, STICK],
      [_, STICK],
    ],
    result: Items.WOODEN_AXE,
    count: 1,
  },
  {
    id: "stone_axe",
    type: "shaped",
    pattern: [
      [COBBLE, COBBLE],
      [COBBLE, STICK],
      [_, STICK],
    ],
    result: Items.STONE_AXE,
    count: 1,
  },
  {
    id: "iron_axe",
    type: "shaped",
    pattern: [
      [Items.IRON_INGOT, Items.IRON_INGOT],
      [Items.IRON_INGOT, STICK],
      [_, STICK],
    ],
    result: Items.IRON_AXE,
    count: 1,
  },

  // --- Tools: shovel (1 head, 2 stick) ------------------------------------
  {
    id: "wooden_shovel",
    type: "shaped",
    pattern: [[OAK_PLANKS], [STICK], [STICK]],
    result: Items.WOODEN_SHOVEL,
    count: 1,
  },
  {
    id: "stone_shovel",
    type: "shaped",
    pattern: [[COBBLE], [STICK], [STICK]],
    result: Items.STONE_SHOVEL,
    count: 1,
  },
  {
    id: "iron_shovel",
    type: "shaped",
    pattern: [[Items.IRON_INGOT], [STICK], [STICK]],
    result: Items.IRON_SHOVEL,
    count: 1,
  },

  // --- Bed: 3 wool top row + 3 planks bottom row --------------------------
  {
    id: "bed",
    type: "shaped",
    pattern: [
      [WOOL, WOOL, WOOL],
      [OAK_PLANKS, OAK_PLANKS, OAK_PLANKS],
    ],
    result: Blocks.BED,
    count: 1,
  },

  // --- Tools: sword (2 head stacked, 1 stick) -----------------------------
  {
    id: "wooden_sword",
    type: "shaped",
    pattern: [[OAK_PLANKS], [OAK_PLANKS], [STICK]],
    result: Items.WOODEN_SWORD,
    count: 1,
  },
  {
    id: "stone_sword",
    type: "shaped",
    pattern: [[COBBLE], [COBBLE], [STICK]],
    result: Items.STONE_SWORD,
    count: 1,
  },
];

/** Smelting (furnace) recipes: a flat input→output table. */
export const SMELTING: { input: ItemId; output: ItemId }[] = [
  { input: Blocks.IRON_ORE, output: Items.IRON_INGOT },
  { input: Blocks.GOLD_ORE, output: Items.GOLD_INGOT },
  { input: Items.RAW_IRON, output: Items.IRON_INGOT },
  { input: Blocks.SAND, output: Blocks.GLASS },
  { input: Items.RAW_BEEF, output: Items.STEAK },
  { input: Items.RAW_PORKCHOP, output: Items.COOKED_PORKCHOP },
  { input: Items.RAW_CHICKEN, output: Items.COOKED_CHICKEN },
  { input: Blocks.COBBLESTONE, output: Blocks.STONE },
];
