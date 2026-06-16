import { describe, it, expect } from "vitest";
import { Blocks, type BlockId, TOOL_DURABILITY } from "./mc-1.20";
import {
  Items,
  ITEM_REGISTRY,
  NON_BLOCK_BASE,
  getItemDef,
  isPlaceable,
  placedBlock,
  isFood,
  isTool,
  maxStackOf,
  toolDurabilityOf,
  isArmor,
  armorDefenseOf,
  armorDurabilityOf,
  isPotion,
  potionEffectOf,
  type ItemId,
} from "./items";

const ALL_BLOCK_IDS: readonly BlockId[] = Object.values(Blocks);
const ALL_NON_BLOCK_IDS: readonly ItemId[] = Object.values(Items);

describe("ITEM_REGISTRY — block items", () => {
  it("has a block-item def for every Blocks id, placesBlock === that id", () => {
    // Block items that intentionally have a non-default max stack (e.g. bed = 1).
    const NON_DEFAULT_MAX_STACK: Partial<Record<BlockId, number>> = {
      [Blocks.BED]: 1,
    };
    for (const id of ALL_BLOCK_IDS) {
      const def = ITEM_REGISTRY[id];
      expect(def, `missing item def for block id ${id}`).toBeDefined();
      expect(def?.id).toBe(id);
      expect(def?.kind).toBe("block");
      expect(def?.placesBlock).toBe(id);
      const expectedMaxStack = NON_DEFAULT_MAX_STACK[id] ?? 64;
      expect(def?.maxStack).toBe(expectedMaxStack);
    }
  });

  it("block items use ids in 0..255 (the block range)", () => {
    for (const id of ALL_BLOCK_IDS) {
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(NON_BLOCK_BASE);
    }
  });
});

describe("ITEM_REGISTRY — non-block items", () => {
  it("all non-block item ids are >= 256 (no collision with block ids)", () => {
    for (const id of ALL_NON_BLOCK_IDS) {
      expect(id).toBeGreaterThanOrEqual(NON_BLOCK_BASE);
    }
  });

  it("item ids are unique across block + non-block ranges", () => {
    const all = [...ALL_BLOCK_IDS, ...ALL_NON_BLOCK_IDS];
    expect(new Set(all).size).toBe(all.length);
  });

  it("registers every declared non-block item", () => {
    for (const id of ALL_NON_BLOCK_IDS) {
      expect(ITEM_REGISTRY[id], `missing def for item ${id}`).toBeDefined();
    }
  });
});

describe("ITEM_REGISTRY — food", () => {
  it("STEAK is food with hunger 8, saturation 12.8", () => {
    const def = getItemDef(Items.STEAK);
    expect(def.kind).toBe("food");
    expect(def.food?.hunger).toBe(8);
    expect(def.food?.saturation).toBeCloseTo(12.8);
    expect(def.maxStack).toBe(64);
    expect(isFood(Items.STEAK)).toBe(true);
  });

  it("BREAD / APPLE / cooked variants are food with their rules values", () => {
    expect(getItemDef(Items.BREAD).food).toEqual({ hunger: 5, saturation: 6 });
    expect(getItemDef(Items.APPLE).food).toEqual({ hunger: 4, saturation: 2.4 });
    expect(getItemDef(Items.COOKED_PORKCHOP).food).toEqual({
      hunger: 8,
      saturation: 12.8,
    });
    expect(getItemDef(Items.COOKED_CHICKEN).food).toEqual({
      hunger: 6,
      saturation: 7.2,
    });
  });

  it("a non-food material is not food", () => {
    expect(isFood(Items.IRON_INGOT)).toBe(false);
  });
});

describe("ITEM_REGISTRY — tools", () => {
  it("DIAMOND_PICKAXE is a diamond pickaxe, maxStack 1", () => {
    const def = getItemDef(Items.DIAMOND_PICKAXE);
    expect(def.kind).toBe("tool");
    expect(def.toolTier).toBe("diamond");
    expect(def.toolType).toBe("pickaxe");
    expect(def.maxStack).toBe(1);
    expect(isTool(Items.DIAMOND_PICKAXE)).toBe(true);
  });

  it("every tier × type tool is registered with maxStack 1", () => {
    const tools: ItemId[] = [
      Items.WOODEN_PICKAXE, Items.WOODEN_AXE, Items.WOODEN_SHOVEL, Items.WOODEN_SWORD, Items.WOODEN_HOE,
      Items.STONE_PICKAXE, Items.STONE_AXE, Items.STONE_SHOVEL, Items.STONE_SWORD, Items.STONE_HOE,
      Items.IRON_PICKAXE, Items.IRON_AXE, Items.IRON_SHOVEL, Items.IRON_SWORD, Items.IRON_HOE,
      Items.DIAMOND_PICKAXE, Items.DIAMOND_AXE, Items.DIAMOND_SHOVEL, Items.DIAMOND_SWORD, Items.DIAMOND_HOE,
      Items.GOLDEN_PICKAXE, Items.GOLDEN_AXE, Items.GOLDEN_SHOVEL, Items.GOLDEN_SWORD, Items.GOLDEN_HOE,
    ];
    for (const id of tools) {
      const def = getItemDef(id);
      expect(def.kind, `${def.name} kind`).toBe("tool");
      expect(def.maxStack, `${def.name} maxStack`).toBe(1);
      expect(def.toolTier).toBeDefined();
      expect(def.toolType).toBeDefined();
    }
  });

  it("toolDurabilityOf maps tier → TOOL_DURABILITY; null for non-tools", () => {
    expect(toolDurabilityOf(Items.DIAMOND_PICKAXE)).toBe(TOOL_DURABILITY.diamond);
    expect(toolDurabilityOf(Items.WOODEN_AXE)).toBe(TOOL_DURABILITY.wood);
    expect(toolDurabilityOf(Items.GOLDEN_SWORD)).toBe(TOOL_DURABILITY.gold);
    expect(toolDurabilityOf(Items.IRON_INGOT)).toBeNull();
  });
});

describe("accessors", () => {
  it("getItemDef throws on an unknown id", () => {
    expect(() => getItemDef(99999)).toThrow();
  });

  it("isPlaceable / placedBlock for block items vs materials", () => {
    expect(isPlaceable(Blocks.STONE)).toBe(true);
    expect(placedBlock(Blocks.STONE)).toBe(Blocks.STONE);
    expect(isPlaceable(Items.STICK)).toBe(false);
    expect(placedBlock(Items.STICK)).toBeNull();
  });

  it("maxStackOf returns 64 for materials/blocks and 1 for tools", () => {
    expect(maxStackOf(Items.COAL)).toBe(64);
    expect(maxStackOf(Blocks.DIRT)).toBe(64);
    expect(maxStackOf(Items.IRON_PICKAXE)).toBe(1);
  });
});

describe("ITEM_REGISTRY — armor", () => {
  it("registers all 12 armor pieces with armorTier + armorSlot + defense", () => {
    const armorIds = [
      Items.LEATHER_HELMET, Items.LEATHER_CHESTPLATE, Items.LEATHER_LEGGINGS, Items.LEATHER_BOOTS,
      Items.IRON_HELMET, Items.IRON_CHESTPLATE, Items.IRON_LEGGINGS, Items.IRON_BOOTS,
      Items.DIAMOND_HELMET, Items.DIAMOND_CHESTPLATE, Items.DIAMOND_LEGGINGS, Items.DIAMOND_BOOTS,
    ];
    for (const id of armorIds) {
      const def = ITEM_REGISTRY[id];
      expect(def, `missing armor def for ${id}`).toBeDefined();
      expect(def?.kind).toBe("armor");
      expect(def?.armorTier).toBeDefined();
      expect(def?.armorSlot).toBeDefined();
      expect(def?.maxStack).toBe(1);
      expect(armorDefenseOf(id)).toBeGreaterThan(0);
      expect(armorDurabilityOf(id)).toBeGreaterThan(0);
    }
  });
  it("isArmor is true only for armor, false for tools/blocks/food", () => {
    expect(isArmor(Items.IRON_CHESTPLATE)).toBe(true);
    expect(isArmor(Items.IRON_PICKAXE)).toBe(false);
    expect(isArmor(Items.BREAD)).toBe(false);
    expect(isArmor(Blocks.STONE)).toBe(false);
  });
});

describe("ITEM_REGISTRY — ranged + potions (Phase 5)", () => {
  it("registers BOW and ARROW with correct stack sizes", () => {
    expect(ITEM_REGISTRY[Items.BOW]?.maxStack).toBe(1);
    expect(ITEM_REGISTRY[Items.ARROW]?.maxStack).toBe(64);
    expect(isPotion(Items.BOW)).toBe(false);
  });
  it("registers all 8 potions with a potionEffect", () => {
    const potionIds = [
      Items.POTION_REGENERATION, Items.POTION_HEALING, Items.POTION_HARMING,
      Items.POTION_POISON, Items.POTION_RESISTANCE, Items.POTION_STRENGTH,
      Items.POTION_SWIFTNESS, Items.POTION_FIRE_RESISTANCE,
    ];
    for (const id of potionIds) {
      const def = ITEM_REGISTRY[id];
      expect(def, `missing potion def for ${id}`).toBeDefined();
      expect(def?.kind).toBe("potion");
      expect(def?.maxStack).toBe(1);
      expect(isPotion(id)).toBe(true);
      expect(potionEffectOf(id)).not.toBeNull();
    }
  });

  it("each potion maps to its correct effect type + amplifier (catches transposition)", () => {
    const expected: [number, string][] = [
      [Items.POTION_REGENERATION, "regeneration"],
      [Items.POTION_HEALING, "instant_health"],
      [Items.POTION_HARMING, "instant_damage"],
      [Items.POTION_POISON, "poison"],
      [Items.POTION_RESISTANCE, "resistance"],
      [Items.POTION_STRENGTH, "strength"],
      [Items.POTION_SWIFTNESS, "swiftness"],
      [Items.POTION_FIRE_RESISTANCE, "fire_resistance"],
    ];
    for (const [id, type] of expected) {
      expect(potionEffectOf(id)?.type).toBe(type);
      expect(potionEffectOf(id)?.amplifier).toBe(0);
    }
    // Instants carry no stored duration; timed potions do.
    expect(potionEffectOf(Items.POTION_HEALING)?.durationTicks).toBe(0);
    expect(potionEffectOf(Items.POTION_HARMING)?.durationTicks).toBe(0);
    expect(potionEffectOf(Items.POTION_REGENERATION)?.durationTicks).toBeGreaterThan(0);
  });
});
