# Phase 4 — Combat + Equipment: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add armor (defense reduction + durability), invulnerability frames, and mob knockback to combat — making the player survivable and melee hits feel impactful — without widening the 36-slot inventory or breaking the pinned combat/persistence tests.
**Architecture:** A PURE `armorReduction(damage, defensePoints)` (additive points × 4%, capped 80%, rounded to integer half-hearts) feeds a single new player-damage chokepoint helper (`applyPlayerDamage`) that wraps the existing `damage()` — applying armor first, then an i-frame guard keyed on `SurvivalState.lastDamageTick`, decrementing armor durability on a real hit. Armor lives in a SEPARATE `Equipment` holder (4 slots) on `Player` — the 36-slot `Inventory` is never widened. Right-click on an armor item routes through an extended `resolveUse` `"equip"` action that swaps the piece into its slot. Mob knockback is a PURE `knockbackImpulse(attackerXZ, mobFeet, strength)` vector applied to a new `Mob.knockback` accumulator (XZ) plus `velocity.y` (up), blended in `mobStep` before the unconditional horizontal overwrite. Persistence adds `equipment` as an additive, default-empty field behind a `SAVE_VERSION` 3→4 bump (and `SAVE_FORMAT` 3→4). DEFERRED: player-knockback (no impulse channel on the player body), ranged/bow/arrow, potions/status-effects (so armor order is just armor→clamp — no resistance), and the off-hand slot.
**Tech Stack:** Babylon.js 8, TypeScript, Vite, Vitest

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `src/combat/armor.ts` | **Create** | Pure `armorReduction(damage, defensePoints)` — additive 4%/point, cap 80%, integer round. |
| `src/combat/armor.test.ts` | **Create** | Unit tests for `armorReduction` (0 def, cap, rounding, full sets). |
| `src/combat/knockback.ts` | **Create** | Pure `knockbackImpulse(attackerXZ, mobFeet, strength)` → `Vec3`. |
| `src/combat/knockback.test.ts` | **Create** | Unit tests for direction, magnitude, zero-length guard, upward component. |
| `src/combat/iframes.ts` | **Create** | Pure `isInvulnerable(lastDamageTick, currentTick, iframeTicks)` predicate + `INVULNERABLE_TICKS`. |
| `src/combat/iframes.test.ts` | **Create** | Unit tests for the i-frame window boundaries. |
| `src/rules/mc-1.20.ts` | **Modify** (after line 115; HEALTH near 257) | Add `ARMOR_DEFENSE`, `ARMOR_DURABILITY`, `ARMOR_REDUCTION_PER_POINT`, `ARMOR_MAX_REDUCTION`. |
| `src/rules/items.ts` | **Modify** (lines 16–48, 54–104, 129–136, 200–249, 318–323) | Extend `ItemDef` kind union + armor fields; add `ArmorTier`/`ArmorSlot`; 12 armor ids + defs; `armor()` builder; `armorOf()`/`isArmor()` accessors. |
| `src/rules/items.test.ts` | **Modify** (append) | New armor-specific invariant tests; existing invariants stay green. |
| `src/inventory/equipment.ts` | **Create** | `Equipment` holder: 4 nullable armor slots, `get`/`set`/`equip`/`totalDefense`/iteration. |
| `src/inventory/equipment.test.ts` | **Create** | Unit tests: empty default, equip-swaps-out, defense sum. |
| `src/inventory/stack.ts` | **Modify** | Add `makeArmorStack(itemId)` — seeds per-slot durability so equipped armor actually wears (`damageTool` gates on the durability field's presence). |
| `src/inventory/stack.test.ts` | **Modify** (append) | Test `makeArmorStack` seeds full durability. |
| `src/inventory/default-inventory.ts` | **Modify** | Add a starter iron armor set (via `makeArmorStack`) so equipment is acquirable + the equip live-QA is runnable. |
| `src/player/controller.ts` | **Modify** (lines 62–78) | Add `readonly equipment: Equipment` field. |
| `src/interaction/use-item.ts` | **Modify** (lines 16–20, 36–44) | Add `"equip"` to `UseAction`; route armor → equip. |
| `src/interaction/use-item.test.ts` | **Modify** (append) | Test armor → `{kind:"equip"}`. |
| `src/survival/stats.ts` | **Modify** (lines 34–41, 47–56) | Add `lastDamageTick: number` field + init. |
| `src/survival/stats.test.ts` | **Modify** (append; lines 257–264 untouched) | Test `makeSurvivalState().lastDamageTick`. |
| `src/game/mob-driver.ts` | **Modify** (lines 278–281, 356–359, 505–515) | New `applyPlayerDamage` chokepoint helper (armor + i-frames + durability); knockback in `attackMob`. |
| `src/game/mob-driver.test.ts` | **Modify** (append; lines 203–239 untouched) | Tests for `applyPlayerDamage` + `attackMob` knockback. |
| `src/mobs/entity.ts` | **Modify** (lines 41–92) | Add `knockback: Vec3` accumulator field + init. |
| `src/mobs/physics.ts` | **Modify** (lines 180–182) | Blend `mob.knockback` into horizontal velocity, then decay. |
| `src/mobs/physics.test.ts` | **Modify** (append) | Test knockback blend + decay across ticks. |
| `src/main.ts` | **Modify** (lines 278–281 mirror, 684–689, 736–748) | Route damage via `applyPlayerDamage`; wire equip; apply knockback. |
| `src/save/serialize.ts` | **Modify** (lines 25–40, 183–192, 327–363, 365–423) | Add `equipment` to `PlayerSave`; `SAVE_FORMAT` 3→4; write/read equipment slots. |
| `src/save/serialize.test.ts` | **Modify** | Extend `samplePlayer()` fixture with `equipment`; round-trip it. |
| `src/save/migration.ts` | **Modify** (line 14, 30–42) | `SAVE_VERSION` 3→4; add `MIGRATIONS[3]` defaulting `equipment`. |
| `src/save/migration.test.ts` | **Modify** (line 115–117) | Update pinned `SAVE_VERSION` 3→4; add v3→v4 migration test. |
| `src/game/persistence.ts` | **Modify** (lines 52–60, 76–90) | `snapshotEquipment()` + `equipment` in `playerSave`; restore equipment. |
| `src/game/persistence.test.ts` | **Modify** | Extend fixture + round-trip equipment. |

---

### Task 1: Pure `armorReduction` + armor constants

Pure reduction math. Fully UNIT-testable; no Babylon.

**Files:**
- Create: `src/combat/armor.ts`, `src/combat/armor.test.ts`
- Modify: `src/rules/mc-1.20.ts` (add constants after `TOOL_DURABILITY` at line 115; reference `HEALTH.MAX` at 257)

Steps:

- [ ] **(CODE, UNIT)** Add armor constants to `src/rules/mc-1.20.ts` immediately after `TOOL_DURABILITY` (ends line 115). Before (lines 108–115):
  ```ts
  /** Durability (uses) per tool tier. `none` (hand) is not a tool and is omitted. */
  export const TOOL_DURABILITY: Record<Exclude<ToolTier, "none">, number> = {
    wood: 59,
    stone: 131,
    iron: 250,
    diamond: 1561,
    gold: 32,
  };
  ```
  After — append below the closing `};`:
  ```ts
  /** Durability (uses) per tool tier. `none` (hand) is not a tool and is omitted. */
  export const TOOL_DURABILITY: Record<Exclude<ToolTier, "none">, number> = {
    wood: 59,
    stone: 131,
    iron: 250,
    diamond: 1561,
    gold: 32,
  };

  // ---------------------------------------------------------------------------
  // Armor (MC 1.20 canonical defense points + per-slot durability)
  // ---------------------------------------------------------------------------

  /** Armor material tiers. NOTE: distinct from ToolTier (no stone armor). */
  export type ArmorTier = "leather" | "iron" | "diamond" | "gold";
  /** The four armor slots. */
  export type ArmorSlot = "helmet" | "chestplate" | "leggings" | "boots";

  /** Defense points (armor points) per tier × slot. Each point ≈ 4% reduction. */
  export const ARMOR_DEFENSE: Record<ArmorTier, Record<ArmorSlot, number>> = {
    leather: { helmet: 1, chestplate: 3, leggings: 2, boots: 1 },
    iron: { helmet: 2, chestplate: 6, leggings: 5, boots: 2 },
    diamond: { helmet: 3, chestplate: 8, leggings: 6, boots: 3 },
    gold: { helmet: 2, chestplate: 5, leggings: 3, boots: 1 },
  };

  /** Durability (hits absorbed) per tier × slot. */
  export const ARMOR_DURABILITY: Record<ArmorTier, Record<ArmorSlot, number>> = {
    leather: { helmet: 55, chestplate: 80, leggings: 75, boots: 65 },
    iron: { helmet: 165, chestplate: 240, leggings: 225, boots: 195 },
    diamond: { helmet: 363, chestplate: 528, leggings: 495, boots: 429 },
    gold: { helmet: 77, chestplate: 112, leggings: 105, boots: 91 },
  };

  /** Damage reduction contributed per defense point (4%). */
  export const ARMOR_REDUCTION_PER_POINT = 0.04;
  /** Hard cap on total armor reduction (80%). */
  export const ARMOR_MAX_REDUCTION = 0.8;
  ```
- [ ] **(CODE, UNIT)** Create `src/combat/armor.ts`:
  ```ts
  /**
   * armor.ts — PURE armor damage-reduction math.
   *
   * MC-style additive model: each defense point reduces incoming damage by
   * ARMOR_REDUCTION_PER_POINT (4%), capped at ARMOR_MAX_REDUCTION (80%). The
   * health economy is integer half-hearts, so the result is rounded to an
   * integer. Resistance/status-effects are DEFERRED (Phase 5), so the order is
   * simply armor → clamp.
   *
   * No Babylon, no game state — a single pure function.
   */

  import {
    ARMOR_REDUCTION_PER_POINT,
    ARMOR_MAX_REDUCTION,
  } from "../rules/mc-1.20";

  /**
   * Reduce `damage` (half-hearts) by `defensePoints` of armor.
   *
   * - Reduction fraction = min(defensePoints × 4%, 80%).
   * - Result rounded to the nearest integer half-heart (never below 0).
   * - 0 defense → damage unchanged (still rounded to an integer).
   */
  export function armorReduction(damage: number, defensePoints: number): number {
    const fraction = Math.min(
      defensePoints * ARMOR_REDUCTION_PER_POINT,
      ARMOR_MAX_REDUCTION,
    );
    const reduced = damage * (1 - fraction);
    return Math.max(0, Math.round(reduced));
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/combat/armor.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { armorReduction } from "./armor";

  describe("armorReduction", () => {
    it("0 defense → damage unchanged (rounded)", () => {
      expect(armorReduction(6, 0)).toBe(6);
      expect(armorReduction(7, 0)).toBe(7);
    });
    it("applies 4% per point, rounded to integer half-hearts", () => {
      // 10 damage, 5 points → 20% off → 8.0
      expect(armorReduction(10, 5)).toBe(8);
      // 7 damage, 5 points → 20% off → 5.6 → 6
      expect(armorReduction(7, 5)).toBe(6);
    });
    it("caps reduction at 80% regardless of defense", () => {
      // 20 points would be 80% exactly; 25 points must still cap at 80%.
      expect(armorReduction(10, 20)).toBe(2);
      expect(armorReduction(10, 25)).toBe(2);
      expect(armorReduction(10, 100)).toBe(2);
    });
    it("never returns below 0", () => {
      expect(armorReduction(0, 5)).toBe(0);
      expect(armorReduction(1, 25)).toBe(0); // 1 × 0.2 = 0.2 → 0
    });
    it("full iron set (13 points) on a 6-damage hit", () => {
      // 13 × 4% = 52% off → 6 × 0.48 = 2.88 → 3
      expect(armorReduction(6, 13)).toBe(3);
    });
  });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/combat/armor.test.ts` → all green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(combat): pure armorReduction + armor constants`

---

### Task 2: Armor `ItemDef`s in `items.ts`

Extend the registry with 12 armor pieces WITHOUT shifting any existing id (so `items.test.ts` invariants stay green automatically).

**Files:**
- Modify: `src/rules/items.ts` (imports 16–21; `ItemDef` 35–48; `Items` enum 54–104; builders ~136; `NON_BLOCK_DEFS` 200–249; accessors ~323)
- Modify: `src/rules/items.test.ts` (append; existing invariants at 21–61 untouched)
- **Must-protect:** `items.test.ts` Invariants 3 (≥256), 4 (unique), 5 (every `Items.*` in registry).

Steps:

- [ ] **(CODE)** Extend the import from `mc-1.20` in `src/rules/items.ts`. Before (lines 16–21):
  ```ts
  import {
    Blocks,
    type BlockId,
    FOOD_VALUES,
    TOOL_DURABILITY,
  } from "./mc-1.20";
  ```
  After:
  ```ts
  import {
    Blocks,
    type BlockId,
    FOOD_VALUES,
    TOOL_DURABILITY,
    type ArmorTier,
    type ArmorSlot,
    ARMOR_DEFENSE,
    ARMOR_DURABILITY,
  } from "./mc-1.20";
  ```
- [ ] **(CODE)** Extend `ItemDef` in `src/rules/items.ts`. Before (lines 35–48):
  ```ts
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
  ```
  After — add `"armor"` to the union and three armor fields:
  ```ts
  export interface ItemDef {
    id: ItemId;
    name: string;
    maxStack: number;
    kind: "block" | "tool" | "food" | "material" | "armor";
    /** Block placed when this item is used (block items only). */
    placesBlock?: BlockId;
    /** Tool material tier (tools only). */
    toolTier?: ToolTier;
    /** Tool kind (tools only). */
    toolType?: ToolType;
    /** Hunger/saturation restored when eaten (food only). */
    food?: { hunger: number; saturation: number };
    /** Armor material tier (armor only). */
    armorTier?: ArmorTier;
    /** Armor slot this piece occupies (armor only). */
    armorSlot?: ArmorSlot;
  }
  ```
- [ ] **(CODE)** Add 12 armor ids to the `Items` enum after `GOLDEN_HOE` (line 103, offset +46; next free is +47). Before (lines 102–104):
  ```ts
    GOLDEN_SWORD: NON_BLOCK_BASE + 45,
    GOLDEN_HOE: NON_BLOCK_BASE + 46,
  } as const;
  ```
  After:
  ```ts
    GOLDEN_SWORD: NON_BLOCK_BASE + 45,
    GOLDEN_HOE: NON_BLOCK_BASE + 46,

    // Armor — tier × slot. (Separate ids from the LEATHER material at +19.)
    LEATHER_HELMET: NON_BLOCK_BASE + 47,
    LEATHER_CHESTPLATE: NON_BLOCK_BASE + 48,
    LEATHER_LEGGINGS: NON_BLOCK_BASE + 49,
    LEATHER_BOOTS: NON_BLOCK_BASE + 50,
    IRON_HELMET: NON_BLOCK_BASE + 51,
    IRON_CHESTPLATE: NON_BLOCK_BASE + 52,
    IRON_LEGGINGS: NON_BLOCK_BASE + 53,
    IRON_BOOTS: NON_BLOCK_BASE + 54,
    DIAMOND_HELMET: NON_BLOCK_BASE + 55,
    DIAMOND_CHESTPLATE: NON_BLOCK_BASE + 56,
    DIAMOND_LEGGINGS: NON_BLOCK_BASE + 57,
    DIAMOND_BOOTS: NON_BLOCK_BASE + 58,
  } as const;
  ```
- [ ] **(CODE)** Add an `armor()` builder after `tool()` in `src/rules/items.ts`. Before (lines 129–136):
  ```ts
  function tool(
    id: ItemId,
    name: string,
    toolTier: ToolTier,
    toolType: ToolType,
  ): ItemDef {
    return { id, name, maxStack: 1, kind: "tool", toolTier, toolType };
  }
  ```
  After — append below the closing `}`:
  ```ts
  function tool(
    id: ItemId,
    name: string,
    toolTier: ToolTier,
    toolType: ToolType,
  ): ItemDef {
    return { id, name, maxStack: 1, kind: "tool", toolTier, toolType };
  }

  function armor(
    id: ItemId,
    name: string,
    armorTier: ArmorTier,
    armorSlot: ArmorSlot,
  ): ItemDef {
    return { id, name, maxStack: 1, kind: "armor", armorTier, armorSlot };
  }
  ```
- [ ] **(CODE)** Append 12 armor entries to `NON_BLOCK_DEFS` after the last `tool(...)` (line 248). Before (lines 247–249):
  ```ts
    tool(Items.GOLDEN_SWORD, "Golden Sword", "gold", "sword"),
    tool(Items.GOLDEN_HOE, "Golden Hoe", "gold", "hoe"),
  ];
  ```
  After:
  ```ts
    tool(Items.GOLDEN_SWORD, "Golden Sword", "gold", "sword"),
    tool(Items.GOLDEN_HOE, "Golden Hoe", "gold", "hoe"),

    armor(Items.LEATHER_HELMET, "Leather Helmet", "leather", "helmet"),
    armor(Items.LEATHER_CHESTPLATE, "Leather Chestplate", "leather", "chestplate"),
    armor(Items.LEATHER_LEGGINGS, "Leather Leggings", "leather", "leggings"),
    armor(Items.LEATHER_BOOTS, "Leather Boots", "leather", "boots"),
    armor(Items.IRON_HELMET, "Iron Helmet", "iron", "helmet"),
    armor(Items.IRON_CHESTPLATE, "Iron Chestplate", "iron", "chestplate"),
    armor(Items.IRON_LEGGINGS, "Iron Leggings", "iron", "leggings"),
    armor(Items.IRON_BOOTS, "Iron Boots", "iron", "boots"),
    armor(Items.DIAMOND_HELMET, "Diamond Helmet", "diamond", "helmet"),
    armor(Items.DIAMOND_CHESTPLATE, "Diamond Chestplate", "diamond", "chestplate"),
    armor(Items.DIAMOND_LEGGINGS, "Diamond Leggings", "diamond", "leggings"),
    armor(Items.DIAMOND_BOOTS, "Diamond Boots", "diamond", "boots"),
  ];
  ```
- [ ] **(CODE)** Add armor accessors after `toolDurabilityOf` in `src/rules/items.ts`. Before (lines 318–323):
  ```ts
  /** Durability (uses) for a tool item, or null for non-tools. */
  export function toolDurabilityOf(id: ItemId): number | null {
    const def = getItemDef(id);
    if (def.kind !== "tool" || def.toolTier === undefined) return null;
    return TOOL_DURABILITY[def.toolTier];
  }
  ```
  After — append below the closing `}`:
  ```ts
  /** Durability (uses) for a tool item, or null for non-tools. */
  export function toolDurabilityOf(id: ItemId): number | null {
    const def = getItemDef(id);
    if (def.kind !== "tool" || def.toolTier === undefined) return null;
    return TOOL_DURABILITY[def.toolTier];
  }

  /** True iff this item is a wearable armor piece. */
  export function isArmor(id: ItemId): boolean {
    return getItemDef(id).kind === "armor";
  }

  /** Defense points for an armor item, or 0 for non-armor. */
  export function armorDefenseOf(id: ItemId): number {
    const def = getItemDef(id);
    if (def.kind !== "armor" || def.armorTier === undefined || def.armorSlot === undefined) {
      return 0;
    }
    return ARMOR_DEFENSE[def.armorTier][def.armorSlot];
  }

  /** Durability (hits) for an armor item, or null for non-armor. */
  export function armorDurabilityOf(id: ItemId): number | null {
    const def = getItemDef(id);
    if (def.kind !== "armor" || def.armorTier === undefined || def.armorSlot === undefined) {
      return null;
    }
    return ARMOR_DURABILITY[def.armorTier][def.armorSlot];
  }
  ```
- [ ] **(CODE, UNIT)** Append armor invariants to `src/rules/items.test.ts` (do NOT touch the existing block at lines 21–61):
  ```ts
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
  ```
  (Add `armorDefenseOf, armorDurabilityOf, isArmor` to the existing `import { ... } from "./items"` line and `Blocks` if not already imported.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/rules/items.test.ts` → all green, including the unchanged invariants (ids unique, ≥256, every `Items.*` registered).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors. NOTE: adding `"armor"` to `kind` may surface exhaustive-`switch` errors. Before committing, run `corepack pnpm typecheck` and resolve any `switch (def.kind)` that lacks a default by adding an `"armor"` branch or default. (Grep first: `grep -rn "def.kind" src/`.)
- [ ] **Commit:** `feat(items): leather/iron/diamond armor item defs`

---

### Task 3: `Equipment` holder + add to `Player`

Separate 4-slot holder; the 36-slot `Inventory` is NEVER widened.

**Files:**
- Create: `src/inventory/equipment.ts`, `src/inventory/equipment.test.ts`
- Modify: `src/player/controller.ts` (Player class fields + constructor, lines 62–78)
- **Must-protect:** `inventory.test.ts` `SLOTS===36` — equipment is a separate class, `Inventory` is untouched.

Steps:

- [ ] **(CODE, UNIT)** Create `src/inventory/equipment.ts`:
  ```ts
  /**
   * equipment.ts — the player's worn-armor holder. SEPARATE from the 36-slot
   * Inventory (which is pinned at SLOTS === 36 and must never widen). Four
   * nullable armor slots keyed by ArmorSlot. Off-hand is DEFERRED.
   *
   * Pure data + small accessors: no Babylon, no world. `equip` swaps the
   * incoming piece into its slot and returns whatever was previously worn (so
   * the caller can return it to the bag).
   */

  import type { ItemStack } from "./stack";
  import type { ArmorSlot } from "../rules/mc-1.20";
  import { getItemDef, armorDefenseOf } from "../rules/items";

  /** The four armor slots, in head-to-toe order (also the persistence order). */
  export const ARMOR_SLOTS: readonly ArmorSlot[] = [
    "helmet",
    "chestplate",
    "leggings",
    "boots",
  ];

  export class Equipment {
    /** Number of armor slots (helmet/chestplate/leggings/boots). */
    static readonly SLOTS = 4;

    private readonly slots: Record<ArmorSlot, ItemStack | null> = {
      helmet: null,
      chestplate: null,
      leggings: null,
      boots: null,
    };

    /** The piece worn in `slot`, or null. */
    get(slot: ArmorSlot): ItemStack | null {
      return this.slots[slot] ?? null;
    }

    /** Force-set a slot (used by the persistence loader). */
    set(slot: ArmorSlot, stack: ItemStack | null): void {
      this.slots[slot] = stack;
    }

    /**
     * Wear `stack` in `slot`, returning the previously-worn piece (or null).
     * The caller is responsible for routing the returned piece back to the bag.
     */
    equip(slot: ArmorSlot, stack: ItemStack): ItemStack | null {
      const prev = this.slots[slot] ?? null;
      this.slots[slot] = stack;
      return prev;
    }

    /** Total defense points across all worn pieces. */
    totalDefense(): number {
      let sum = 0;
      for (const slot of ARMOR_SLOTS) {
        const piece = this.slots[slot];
        if (piece !== null) sum += armorDefenseOf(piece.itemId);
      }
      return sum;
    }

    /** The armor slot an item id belongs to, or null if it is not armor. */
    static slotFor(itemId: number): ArmorSlot | null {
      const def = getItemDef(itemId);
      if (def.kind !== "armor" || def.armorSlot === undefined) return null;
      return def.armorSlot;
    }
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/inventory/equipment.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { Equipment, ARMOR_SLOTS } from "./equipment";
  import { Items } from "../rules/items";
  import { makeStack } from "./stack";

  describe("Equipment", () => {
    it("has 4 slots, all empty initially", () => {
      expect(Equipment.SLOTS).toBe(4);
      const eq = new Equipment();
      for (const slot of ARMOR_SLOTS) expect(eq.get(slot)).toBeNull();
      expect(eq.totalDefense()).toBe(0);
    });
    it("equip sets the slot and returns the previous piece", () => {
      const eq = new Equipment();
      const iron = makeStack(Items.IRON_CHESTPLATE, 1, 1);
      const diamond = makeStack(Items.DIAMOND_CHESTPLATE, 1, 1);
      expect(eq.equip("chestplate", iron)).toBeNull();
      expect(eq.get("chestplate")).toBe(iron);
      // Swapping returns the displaced piece.
      expect(eq.equip("chestplate", diamond)).toBe(iron);
      expect(eq.get("chestplate")).toBe(diamond);
    });
    it("totalDefense sums worn pieces", () => {
      const eq = new Equipment();
      eq.equip("helmet", makeStack(Items.IRON_HELMET, 1, 1)); // 2
      eq.equip("chestplate", makeStack(Items.IRON_CHESTPLATE, 1, 1)); // 6
      expect(eq.totalDefense()).toBe(8);
    });
    it("slotFor maps armor ids to slots, null otherwise", () => {
      expect(Equipment.slotFor(Items.DIAMOND_BOOTS)).toBe("boots");
      expect(Equipment.slotFor(Items.IRON_PICKAXE)).toBeNull();
    });
  });
  ```
- [ ] **(CODE, UNIT)** Add a `makeArmorStack` factory to `src/inventory/stack.ts` so worn armor carries per-slot durability. WHY: `damageTool` early-returns unchanged when `durability === undefined` (it gates on the field, NOT on item kind), so an armor stack made with plain `makeStack` would never wear down in the live game. After `makeToolStack`:
  ```ts
  /** Create a single armor piece at full per-slot durability. */
  export function makeArmorStack(itemId: number): ItemStack {
    const max = armorDurabilityOf(itemId);
    if (max === null) {
      // Not an armor id — fall back to a plain (durability-less) stack.
      return { itemId, count: 1, maxStack: 1 };
    }
    return { itemId, count: 1, maxStack: 1, durability: max, maxDurability: max };
  }
  ```
  (Add `import { armorDurabilityOf } from "../rules/items";` to `stack.ts`. `items.ts` does NOT import `stack.ts`, so this edge is not circular. If typecheck nonetheless flags a cycle, move `makeArmorStack` into `items.ts` instead, importing the `ItemStack` type only.)
- [ ] **(CODE, UNIT)** Append to `src/inventory/stack.test.ts`:
  ```ts
  it("makeArmorStack seeds full per-slot durability", () => {
    const s = makeArmorStack(Items.IRON_CHESTPLATE);
    expect(s.count).toBe(1);
    expect(s.maxStack).toBe(1);
    expect(s.durability).toBe(armorDurabilityOf(Items.IRON_CHESTPLATE)!);
    expect(s.maxDurability).toBe(s.durability);
  });
  it("makeArmorStack on a non-armor id → plain stack (no durability)", () => {
    expect(makeArmorStack(Items.IRON_PICKAXE).durability).toBeUndefined();
  });
  ```
  (Import `makeArmorStack` from `./stack` and `Items`, `armorDurabilityOf` from `../rules/items`; match the existing `stack.test.ts` import style.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/inventory/stack.test.ts` → green.
- [ ] **(CODE)** Add the `equipment` field to `Player` in `src/player/controller.ts`. Before (lines 62–78):
  ```ts
  export class Player {
    feet: Vec3;
    physics: PhysicsState;
    /** Full survival economy (health/food/saturation/exhaustion/timers). */
    survival: SurvivalState;
    readonly inventory: Inventory;
    readonly hotbar: Hotbar;
    private readonly spawn: Vec3;

    constructor(spawn: Vec3) {
      this.spawn = { x: spawn.x, y: spawn.y, z: spawn.z };
      this.feet = { x: spawn.x, y: spawn.y, z: spawn.z };
      this.physics = makePhysicsState();
      this.survival = makeSurvivalState();
      this.inventory = new Inventory();
      this.hotbar = new Hotbar();
    }
  ```
  After:
  ```ts
  export class Player {
    feet: Vec3;
    physics: PhysicsState;
    /** Full survival economy (health/food/saturation/exhaustion/timers). */
    survival: SurvivalState;
    readonly inventory: Inventory;
    readonly hotbar: Hotbar;
    /** Worn armor (4 slots). SEPARATE from the 36-slot inventory. */
    readonly equipment: Equipment;
    private readonly spawn: Vec3;

    constructor(spawn: Vec3) {
      this.spawn = { x: spawn.x, y: spawn.y, z: spawn.z };
      this.feet = { x: spawn.x, y: spawn.y, z: spawn.z };
      this.physics = makePhysicsState();
      this.survival = makeSurvivalState();
      this.inventory = new Inventory();
      this.hotbar = new Hotbar();
      this.equipment = new Equipment();
    }
  ```
  (Add `import { Equipment } from "../inventory/equipment";` near the existing `Inventory`/`Hotbar` imports.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/inventory/equipment.test.ts src/inventory/inventory.test.ts` → both green; `inventory.test.ts` still asserts `SLOTS===36`.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(inventory): Equipment holder (4 armor slots) on Player`

---

### Task 4: Right-click-to-equip (extend `resolveUse` + wire `main.ts`)

Add an `"equip"` action; route it in the glue layer.

**Files:**
- Modify: `src/interaction/use-item.ts` (`UseAction` 16–20; `resolveUse` 36–44)
- Modify: `src/interaction/use-item.test.ts` (append; existing cases 6–23 untouched)
- Modify: `src/main.ts` (right-click handler, lines 736–748)
- **Must-protect:** existing `use-item.test.ts` cases (food/place/tool/material) keep their results.

Steps:

- [ ] **(CODE, UNIT)** Extend `UseAction` + `resolveUse` in `src/interaction/use-item.ts`. Before (lines 16–20):
  ```ts
  /** The action a right-click resolves to. */
  export type UseAction =
    | { kind: "eat" }
    | { kind: "place" }
    | { kind: "use-other" }
    | { kind: "none" };
  ```
  After:
  ```ts
  /** The action a right-click resolves to. */
  export type UseAction =
    | { kind: "eat" }
    | { kind: "equip" }
    | { kind: "place" }
    | { kind: "use-other" }
    | { kind: "none" };
  ```
  Before (lines 36–44):
  ```ts
  export function resolveUse(def: ItemDef, ctx: UseContext): UseAction {
    if (def.kind === "food") {
      return ctx.hungry ? { kind: "eat" } : { kind: "none" };
    }
    if (def.placesBlock !== undefined) {
      return { kind: "place" };
    }
    return { kind: "use-other" };
  }
  ```
  After — armor takes precedence over the place/use-other fallthrough (armor has no `placesBlock`, so insert it before the place check):
  ```ts
  export function resolveUse(def: ItemDef, ctx: UseContext): UseAction {
    if (def.kind === "food") {
      return ctx.hungry ? { kind: "eat" } : { kind: "none" };
    }
    if (def.kind === "armor") {
      return { kind: "equip" };
    }
    if (def.placesBlock !== undefined) {
      return { kind: "place" };
    }
    return { kind: "use-other" };
  }
  ```
- [ ] **(CODE, UNIT)** Append to `src/interaction/use-item.test.ts`:
  ```ts
  it("armor → equip (regardless of hunger)", () => {
    const def = getItemDef(Items.IRON_CHESTPLATE);
    expect(resolveUse(def, { hungry: true })).toEqual({ kind: "equip" });
    expect(resolveUse(def, { hungry: false })).toEqual({ kind: "equip" });
  });
  ```
- [ ] **(CODE, LIVE-QA)** Wire equip into the right-click handler in `src/main.ts`. Before (lines 736–748):
  ```ts
      const action = resolveUse(def, { hungry: player.survival.food < HUNGER.MAX_FOOD });
      if (action.kind === "eat") {
        const f = def.food;
        if (f !== undefined) {
          eat(player.survival, f.hunger, f.saturation);
          player.inventory.removeFromSlot(slot, 1);
        }
        return;
      }
      if (action.kind === "use-other" || action.kind === "none") {
        // Tools / materials have no right-click effect yet; no place audio/particles.
        return;
      }
  ```
  After — add an `equip` branch between `eat` and `use-other` that moves the held armor into its slot and returns any displaced piece to the slot the armor came from:
  ```ts
      const action = resolveUse(def, { hungry: player.survival.food < HUNGER.MAX_FOOD });
      if (action.kind === "eat") {
        const f = def.food;
        if (f !== undefined) {
          eat(player.survival, f.hunger, f.saturation);
          player.inventory.removeFromSlot(slot, 1);
        }
        return;
      }
      if (action.kind === "equip") {
        const armorSlot = Equipment.slotFor(held.itemId);
        if (armorSlot !== null) {
          const prev = player.equipment.equip(armorSlot, held);
          // The held piece is now worn; the bag slot takes whatever it displaced.
          player.inventory.set(slot, prev);
        }
        return;
      }
      if (action.kind === "use-other" || action.kind === "none") {
        // Tools / materials have no right-click effect yet; no place audio/particles.
        return;
      }
  ```
  (Add `import { Equipment } from "./inventory/equipment";` to `main.ts`. NOTE: `held` is the full `ItemStack` already in scope at line 733; armor stacks are `count:1`, so moving the whole stack is correct.)
- [ ] **(CODE, LIVE-QA)** Give the player a starter iron armor set so the equipment system is acquirable (and the live-QA below is runnable). In `src/inventory/default-inventory.ts`, add four armor pieces via `makeArmorStack`, mirroring how the existing tools/food are seeded into free slots:
  ```ts
  // Starter armor (Phase 4) — lets the player actually use the equipment system.
  inv.set(NEXT_FREE_SLOT_0, makeArmorStack(Items.IRON_HELMET));
  inv.set(NEXT_FREE_SLOT_1, makeArmorStack(Items.IRON_CHESTPLATE));
  inv.set(NEXT_FREE_SLOT_2, makeArmorStack(Items.IRON_LEGGINGS));
  inv.set(NEXT_FREE_SLOT_3, makeArmorStack(Items.IRON_BOOTS));
  ```
  (Read the file first to pick the four next contiguous free slot indices after the current tools/food; replace `NEXT_FREE_SLOT_n` with concrete numbers. Add `makeArmorStack` to the existing `stack` import and `Items` as needed. MUST-PROTECT: if `default-inventory.test.ts` pins exact slot contents/counts, extend those assertions to include the four armor pieces; do NOT alter the pinned tool/food entries.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/interaction/use-item.test.ts src/inventory/default-inventory.test.ts` → all green (old cases + new equip case; default inventory still satisfies its invariants).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(LIVE-QA)** Run the app; right-click an iron chestplate in the held slot → it disappears from the bag and (later HUD task) the player's defense rises. Right-click again with a different chestplate held → the worn one returns to the bag. Manual only.
- [ ] **Commit:** `feat(combat): right-click-to-equip armor via resolveUse`

---

### Task 5: Wire armor reduction + durability into the player-damage chokepoint

Introduce `applyPlayerDamage` — the single wrapper around `damage()` that applies armor, durability, and (next task) i-frames. Replace the three call-site closures so they all route through it.

**Files:**
- Modify: `src/game/mob-driver.ts` (the two `damagePlayer` closures at 278–281 and 356–359; add `applyPlayerDamage` helper)
- Modify: `src/game/mob-driver.test.ts` (append; lines 203–239 untouched)
- **Must-protect:** `stats.test.ts` `damage(s,6)` → health 20→14 stays exact (armor is applied in the wrapper, NEVER inside `damage()`).

Steps:

- [ ] **(CODE, UNIT)** Add `applyPlayerDamage` to `src/game/mob-driver.ts`. It takes the `Player`, the raw amount, and the current tick. Insert it near the top-level combat helpers (e.g. just before `attackMob` at line 505). New code:
  ```ts
  /**
   * THE single player-damage chokepoint. Applies armor reduction, decrements
   * armor durability on a real hit, then routes the clamped integer amount to
   * the survival damage() function. (i-frames are added in Task 6.)
   *
   * Starvation does NOT pass through here (it writes s.health directly) — by
   * design, armor never mitigates starvation.
   */
  export function applyPlayerDamage(
    player: Player,
    rawAmount: number,
    _currentTick: number,
  ): void {
    const defense = player.equipment.totalDefense();
    const effective = armorReduction(rawAmount, defense);
    if (effective <= 0) return; // fully absorbed — no health loss, no durability wear
    // Decrement durability on each worn piece that took the hit.
    for (const slot of ARMOR_SLOTS) {
      const piece = player.equipment.get(slot);
      if (piece !== null) {
        player.equipment.set(slot, damageTool(piece));
      }
    }
    damage(player.survival, effective);
  }
  ```
  (Add imports to `mob-driver.ts`: `import { armorReduction } from "../combat/armor";`, `import { ARMOR_SLOTS } from "../inventory/equipment";`, `import { damageTool } from "../inventory/stack";`. `damage` and `Player` are already imported at lines 21 and 20. NOTE: `damageTool` returns `null` when the piece breaks — `set` accepts null, so a broken piece is correctly removed.)
- [ ] **(CODE)** Reroute the melee/ranged hook closure. Before (lines 278–281):
  ```ts
      const hooks: CombatHooks = {
        damagePlayer: (amount: number) => damage(player.survival, amount),
        playerEyePos: () => player.eyePosition(),
      };
  ```
  After:
  ```ts
      const hooks: CombatHooks = {
        damagePlayer: (amount: number) =>
          applyPlayerDamage(player, amount, clock.totalTicks),
        playerEyePos: () => player.eyePosition(),
      };
  ```
  (`clock` is already in scope in `aiTick`; confirm the local name — it is the `Clock` param. If named differently, use that.)
- [ ] **(CODE)** Reroute the creeper-explosion closure. Before (lines 356–359):
  ```ts
        damagePlayer: (n: number) => damage(player.survival, n),
        playerPos: () => player.feet,
  ```
  After:
  ```ts
        damagePlayer: (n: number) =>
          applyPlayerDamage(player, n, clock.totalTicks),
        playerPos: () => player.feet,
  ```
- [ ] **(CODE, UNIT)** Append to `src/game/mob-driver.test.ts` (do NOT touch the `attackMob` tests at 203–239):
  ```ts
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
  });
  ```
  (Import `Player`, `makeStack`, `makeArmorStack`, `Items`, `applyPlayerDamage` at the top of the test file. The armor-reduction test uses `makeStack(Items.IRON_CHESTPLATE, 1, 1)` — durability is irrelevant there; the durability test uses `makeArmorStack` so the equipped piece carries the per-slot durability that `damageTool` wears down.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/game/mob-driver.test.ts src/survival/stats.test.ts` → green; `stats.test.ts` `damage(s,6)` → 14 unchanged.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(combat): armor reduction + durability at the player-damage chokepoint`

---

### Task 6: Invulnerability frames at the chokepoint

A short immunity window after a real hit so a mob inside the player doesn't deal damage every tick.

**Files:**
- Create: `src/combat/iframes.ts`, `src/combat/iframes.test.ts`
- Modify: `src/survival/stats.ts` (`SurvivalState` 34–41; `makeSurvivalState` 47–56)
- Modify: `src/survival/stats.test.ts` (append; `damage()` test 257–264 untouched)
- Modify: `src/game/mob-driver.ts` (`applyPlayerDamage` from Task 5)
- Modify: `src/game/mob-driver.test.ts` (append i-frame case)
- **Must-protect:** `stats.test.ts` `damage()` (still a raw decrement); starvation path (lines 129–133) NOT routed through the chokepoint.

Steps:

- [ ] **(CODE, UNIT)** Create `src/combat/iframes.ts`:
  ```ts
  /**
   * iframes.ts — PURE invulnerability-frame predicate.
   *
   * After a real hit the player is immune for INVULNERABLE_TICKS. This stops a
   * mob standing inside the player from dealing damage on every 20 Hz tick (and
   * multiple mobs from each landing a hit the same tick). Starvation bypasses
   * this entirely (it does not go through the damage chokepoint).
   */

  /** Immunity window in ticks (~0.5 s at 20 Hz — matches MC's 10-tick hurt cooldown). */
  export const INVULNERABLE_TICKS = 10;

  /**
   * True iff a hit at `currentTick` should be IGNORED because the last damage at
   * `lastDamageTick` is still within the immunity window. A never-damaged
   * sentinel (negative / very old tick) is never invulnerable.
   */
  export function isInvulnerable(
    lastDamageTick: number,
    currentTick: number,
    iframeTicks: number = INVULNERABLE_TICKS,
  ): boolean {
    if (lastDamageTick < 0) return false;
    return currentTick - lastDamageTick < iframeTicks;
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/combat/iframes.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { isInvulnerable, INVULNERABLE_TICKS } from "./iframes";

  describe("isInvulnerable", () => {
    it("never-damaged sentinel is not invulnerable", () => {
      expect(isInvulnerable(-1, 0)).toBe(false);
    });
    it("within the window → invulnerable", () => {
      expect(isInvulnerable(100, 100)).toBe(true);
      expect(isInvulnerable(100, 100 + INVULNERABLE_TICKS - 1)).toBe(true);
    });
    it("at and beyond the window → vulnerable again", () => {
      expect(isInvulnerable(100, 100 + INVULNERABLE_TICKS)).toBe(false);
      expect(isInvulnerable(100, 200)).toBe(false);
    });
  });
  ```
- [ ] **(CODE)** Add `lastDamageTick` to `SurvivalState` in `src/survival/stats.ts`. Before (lines 34–41):
  ```ts
  export interface SurvivalState {
    health: number;
    food: number;
    saturation: number;
    exhaustion: number;
    regenTimer: number;
    starveTimer: number;
  }
  ```
  After:
  ```ts
  export interface SurvivalState {
    health: number;
    food: number;
    saturation: number;
    exhaustion: number;
    regenTimer: number;
    starveTimer: number;
    /** Absolute tick of the last hit through the damage chokepoint (i-frames). -1 = never. */
    lastDamageTick: number;
  }
  ```
  Before (`makeSurvivalState`, lines 47–56):
  ```ts
  export function makeSurvivalState(): SurvivalState {
    return {
      health: HEALTH.MAX,
      food: HUNGER.MAX_FOOD,
      saturation: 5,
      exhaustion: 0,
      regenTimer: 0,
      starveTimer: 0,
    };
  }
  ```
  After:
  ```ts
  export function makeSurvivalState(): SurvivalState {
    return {
      health: HEALTH.MAX,
      food: HUNGER.MAX_FOOD,
      saturation: 5,
      exhaustion: 0,
      regenTimer: 0,
      starveTimer: 0,
      lastDamageTick: -1,
    };
  }
  ```
- [ ] **(CODE)** Add the i-frame guard to `applyPlayerDamage` in `src/game/mob-driver.ts` (built in Task 5). Apply armor FIRST, then the i-frame check, so a fully-absorbed (0-damage) hit does NOT consume the window. Before:
  ```ts
  export function applyPlayerDamage(
    player: Player,
    rawAmount: number,
    _currentTick: number,
  ): void {
    const defense = player.equipment.totalDefense();
    const effective = armorReduction(rawAmount, defense);
    if (effective <= 0) return; // fully absorbed — no health loss, no durability wear
    // Decrement durability on each worn piece that took the hit.
    for (const slot of ARMOR_SLOTS) {
      const piece = player.equipment.get(slot);
      if (piece !== null) {
        player.equipment.set(slot, damageTool(piece));
      }
    }
    damage(player.survival, effective);
  }
  ```
  After:
  ```ts
  export function applyPlayerDamage(
    player: Player,
    rawAmount: number,
    currentTick: number,
  ): void {
    const defense = player.equipment.totalDefense();
    const effective = armorReduction(rawAmount, defense);
    if (effective <= 0) return; // fully absorbed — no health loss, no durability wear
    // i-frames: ignore hits within the immunity window of the last real hit.
    if (isInvulnerable(player.survival.lastDamageTick, currentTick)) return;
    // Decrement durability on each worn piece that took the hit.
    for (const slot of ARMOR_SLOTS) {
      const piece = player.equipment.get(slot);
      if (piece !== null) {
        player.equipment.set(slot, damageTool(piece));
      }
    }
    damage(player.survival, effective);
    player.survival.lastDamageTick = currentTick;
  }
  ```
  (Add `import { isInvulnerable } from "../combat/iframes";` to `mob-driver.ts`.)
- [ ] **(CODE, UNIT)** Append a `lastDamageTick` init test to `src/survival/stats.test.ts` (leave the `damage()` test at 257–264 untouched):
  ```ts
  it("makeSurvivalState seeds lastDamageTick to -1 (never damaged)", () => {
    expect(makeSurvivalState().lastDamageTick).toBe(-1);
  });
  ```
- [ ] **(CODE, UNIT)** Append an i-frame integration case to `src/game/mob-driver.test.ts` `applyPlayerDamage` describe block:
  ```ts
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
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/combat/iframes.test.ts src/survival/stats.test.ts src/game/mob-driver.test.ts` → green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors. NOTE: check `src/main.ts` persistence restore (lines 377–383) does not need a manual `lastDamageTick` reset — `makeSurvivalState()` already seeds it, and the restore overwrites only health/food/saturation/exhaustion/timers, leaving `lastDamageTick` at its constructed `-1`. Confirm no compile error there.
- [ ] **Commit:** `feat(combat): player invulnerability frames at the damage chokepoint`

---

### Task 7: Mob knockback impulse on player melee hit

A velocity impulse (away from the player, small upward) applied to a mob when the player melee-hits it — WITHOUT changing the damage `attackMob` deals.

**Files:**
- Create: `src/combat/knockback.ts`, `src/combat/knockback.test.ts`
- Modify: `src/mobs/entity.ts` (`Mob` fields + constructor, lines 41–92)
- Modify: `src/mobs/physics.ts` (horizontal-velocity overwrite, lines 180–182)
- Modify: `src/mobs/physics.test.ts` (append)
- Modify: `src/game/mob-driver.ts` (`attackMob`, lines 509–515)
- Modify: `src/game/mob-driver.test.ts` (append; DO NOT touch the pinned `attackMob` tests at 203–212, 234–239)
- Modify: `src/main.ts` (melee site, lines 684–689) to pass the player XZ
- **Must-protect:** `mob-driver.test.ts` `attackMob(mob, 1234)` (2-arg) keeps `health === full - PLAYER_ATTACK_DAMAGE` and `lastDamageTick === 1234`.

Steps:

- [ ] **(CODE, UNIT)** Create `src/combat/knockback.ts`:
  ```ts
  /**
   * knockback.ts — PURE knockback-impulse vector math.
   *
   * Given the attacker's XZ position and the mob's feet, returns a velocity
   * impulse (blocks/tick) pointing away from the attacker on the XZ plane plus a
   * small fixed upward component. Player knockback is DEFERRED (the player body
   * recomputes horizontal velocity from input each tick — no impulse channel),
   * so this is used only for MOBS.
   */

  import type { Vec3 } from "../mobs/entity";

  /** Horizontal knockback speed (blocks/tick) applied to a struck mob. */
  export const KNOCKBACK_HORIZONTAL = 0.4;
  /** Upward knockback speed (blocks/tick). */
  export const KNOCKBACK_UPWARD = 0.36;

  /**
   * Impulse pushing a mob away from `attackerXZ`. The XZ direction is
   * normalized; a zero-length separation (attacker exactly on the mob) yields a
   * default +X push so the mob is never left motionless.
   */
  export function knockbackImpulse(
    attackerXZ: { x: number; z: number },
    mobFeet: { x: number; z: number },
    strength: number = KNOCKBACK_HORIZONTAL,
  ): Vec3 {
    let dx = mobFeet.x - attackerXZ.x;
    let dz = mobFeet.z - attackerXZ.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      dx = 1;
      dz = 0;
    } else {
      dx /= len;
      dz /= len;
    }
    return { x: dx * strength, y: KNOCKBACK_UPWARD, z: dz * strength };
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/combat/knockback.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import {
    knockbackImpulse,
    KNOCKBACK_HORIZONTAL,
    KNOCKBACK_UPWARD,
  } from "./knockback";

  describe("knockbackImpulse", () => {
    it("pushes the mob directly away from the attacker on +X", () => {
      const k = knockbackImpulse({ x: 0, z: 0 }, { x: 5, z: 0 });
      expect(k.x).toBeCloseTo(KNOCKBACK_HORIZONTAL, 6);
      expect(k.z).toBeCloseTo(0, 6);
      expect(k.y).toBeCloseTo(KNOCKBACK_UPWARD, 6);
    });
    it("normalizes the XZ direction (magnitude == strength)", () => {
      const k = knockbackImpulse({ x: 0, z: 0 }, { x: 3, z: 4 });
      expect(Math.hypot(k.x, k.z)).toBeCloseTo(KNOCKBACK_HORIZONTAL, 6);
    });
    it("zero-length separation falls back to +X", () => {
      const k = knockbackImpulse({ x: 2, z: 2 }, { x: 2, z: 2 });
      expect(k.x).toBeCloseTo(KNOCKBACK_HORIZONTAL, 6);
      expect(k.z).toBeCloseTo(0, 6);
    });
    it("always includes the upward component", () => {
      const k = knockbackImpulse({ x: 0, z: 0 }, { x: -7, z: 0 });
      expect(k.y).toBeCloseTo(KNOCKBACK_UPWARD, 6);
      expect(k.x).toBeCloseTo(-KNOCKBACK_HORIZONTAL, 6);
    });
  });
  ```
- [ ] **(CODE)** Add a `knockback: Vec3` accumulator to `Mob` in `src/mobs/entity.ts`. Before (fields, around lines 45–73 + constructor 75–92):
  ```ts
    /** Reference point: center x/z, bottom y. */
    feet: Vec3;
    /** Velocity in blocks/tick. */
    velocity: Vec3;
  ```
  After:
  ```ts
    /** Reference point: center x/z, bottom y. */
    feet: Vec3;
    /** Velocity in blocks/tick. */
    velocity: Vec3;
    /**
     * Pending knockback impulse (blocks/tick) on the XZ plane. Survives the
     * unconditional horizontal overwrite in mobStep because it lives OUTSIDE
     * velocity.x/z; mobStep blends + decays it. (The upward component is written
     * straight into velocity.y, which mobStep carries forward via gravity.)
     */
    knockback: Vec3;
  ```
  In the constructor, before (line 79):
  ```ts
      this.velocity = { x: 0, y: 0, z: 0 };
  ```
  After:
  ```ts
      this.velocity = { x: 0, y: 0, z: 0 };
      this.knockback = { x: 0, y: 0, z: 0 };
  ```
- [ ] **(CODE)** Blend the knockback accumulator into the horizontal overwrite in `src/mobs/physics.ts`. Before (lines 180–182):
  ```ts
    // 2) Horizontal velocity from the AI's desired motion.
    mob.velocity.x = desiredHoriz.x;
    mob.velocity.z = desiredHoriz.z;
  ```
  After — add the accumulator, then decay it so it fades over a few ticks:
  ```ts
    // 2) Horizontal velocity from the AI's desired motion, plus any pending
    //    knockback impulse (which lives OUTSIDE velocity.x/z so this overwrite
    //    doesn't destroy it). Decay the accumulator so the shove fades.
    mob.velocity.x = desiredHoriz.x + mob.knockback.x;
    mob.velocity.z = desiredHoriz.z + mob.knockback.z;
    mob.knockback.x *= KNOCKBACK_DECAY;
    mob.knockback.z *= KNOCKBACK_DECAY;
    if (Math.abs(mob.knockback.x) < KNOCKBACK_EPSILON) mob.knockback.x = 0;
    if (Math.abs(mob.knockback.z) < KNOCKBACK_EPSILON) mob.knockback.z = 0;
  ```
  Add these constants near the top of `physics.ts` (with the other module constants):
  ```ts
  /** Per-tick decay of the horizontal knockback accumulator. */
  const KNOCKBACK_DECAY = 0.5;
  /** Below this magnitude the accumulator snaps to 0. */
  const KNOCKBACK_EPSILON = 0.01;
  ```
- [ ] **(CODE)** Apply the impulse inside `attackMob` in `src/game/mob-driver.ts`, keeping the 2-arg default intact. Before (lines 509–515):
  ```ts
  export function attackMob(
    mob: Mob,
    currentTick: number,
    amount: number = PLAYER_ATTACK_DAMAGE,
  ): void {
    mob.takeDamage(amount, currentTick);
  }
  ```
  After — add an OPTIONAL 4th `attackerXZ` param; when omitted (the pinned 2-arg tests), no knockback is applied so damage behavior is identical:
  ```ts
  export function attackMob(
    mob: Mob,
    currentTick: number,
    amount: number = PLAYER_ATTACK_DAMAGE,
    attackerXZ?: { x: number; z: number },
  ): void {
    mob.takeDamage(amount, currentTick);
    if (attackerXZ !== undefined) {
      const k = knockbackImpulse(attackerXZ, mob.feet);
      mob.knockback.x += k.x;
      mob.knockback.z += k.z;
      mob.velocity.y = k.y; // upward component rides the existing gravity carry
    }
  }
  ```
  (Add `import { knockbackImpulse } from "../combat/knockback";` to `mob-driver.ts`.)
- [ ] **(CODE)** Pass the player XZ at the melee call site in `src/main.ts`. Before (lines 684–689):
  ```ts
          attackMob(mob, clock.totalTicks, attackDamageFor(heldDef));
          // Play hurt sound at mob position.
          gameAudio?.onMobHurt(mob.feet);
          if (held !== null && isTool(held)) {
            player.inventory.set(slot, damageTool(held));
          }
  ```
  After:
  ```ts
          attackMob(mob, clock.totalTicks, attackDamageFor(heldDef), {
            x: eye.x,
            z: eye.z,
          });
          // Play hurt sound at mob position.
          gameAudio?.onMobHurt(mob.feet);
          if (held !== null && isTool(held)) {
            player.inventory.set(slot, damageTool(held));
          }
  ```
  (`eye` = `player.eyePosition()` is already in scope at line 659.)
- [ ] **(CODE, UNIT)** Append to `src/game/mob-driver.test.ts` (NEW describe, leaving the pinned `attackMob` tests untouched):
  ```ts
  describe("attackMob knockback", () => {
    it("4-arg form applies an away-from-attacker impulse without changing damage", () => {
      const mob = new Mob(9, "zombie", { x: 5, y: 0, z: 0 });
      const full = MOB_STATS.zombie.maxHealth;
      attackMob(mob, 1, PLAYER_ATTACK_DAMAGE, { x: 0, z: 0 });
      // Damage is identical to the 2-arg path.
      expect(mob.health).toBe(full - PLAYER_ATTACK_DAMAGE);
      // Impulse points away on +X with an upward component.
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
  ```
- [ ] **(CODE, UNIT)** Append a blend+decay test to `src/mobs/physics.test.ts`:
  ```ts
  it("mobStep blends the knockback accumulator into horizontal velocity then decays it", () => {
    const mob = new Mob(1, "zombie", { x: 0, y: 8, z: 0 });
    mob.knockback = { x: 0.4, y: 0, z: 0 };
    const noSolid = () => false; // open air
    mobStep(mob, { x: 0, y: 0, z: 0 }, noSolid);
    // The shove moved the mob on +X this tick.
    expect(mob.feet.x).toBeGreaterThan(0);
    // Accumulator decayed (0.4 → 0.2).
    expect(mob.knockback.x).toBeCloseTo(0.2, 6);
  });
  ```
  (Match the existing `physics.test.ts` import style for `Mob`/`mobStep`/`SolidQuery`.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/combat/knockback.test.ts src/mobs/physics.test.ts src/game/mob-driver.test.ts` → green; the pinned `attackMob` 2-arg tests (lines 203–212, 234–239) stay green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(LIVE-QA)** Run the app; melee a zombie → it visibly lurches backward and slightly up. Manual only.
- [ ] **Commit:** `feat(combat): mob knockback impulse on player melee hit`

---

### Task 8: Persistence — save/load equipment + SAVE_VERSION migration

Additive `equipment` field (4 slots, default all-null) behind a `SAVE_VERSION` 3→4 and `SAVE_FORMAT` 3→4 bump.

**Files:**
- Modify: `src/save/serialize.ts` (`PlayerSave` 25–40; `SAVE_FORMAT` 183–192; `writePlayer` 327–363; `readPlayer` 365–423)
- Modify: `src/save/serialize.test.ts` (extend `samplePlayer()` fixture; round-trip equipment)
- Modify: `src/save/migration.ts` (`SAVE_VERSION` 14; `MIGRATIONS` 30–42)
- Modify: `src/save/migration.test.ts` (line 115–117 pin 3→4; add v3→v4 test)
- Modify: `src/game/persistence.ts` (`snapshotEquipment` + `playerSave` 52–60, 76–90); restore in `src/main.ts` (377–390)
- Modify: `src/game/persistence.test.ts` (fixture + round-trip)
- **Must-protect:** `serialize.test.ts` inventory round-trip; `persistence.test.ts` slot-0/slot-4 assertions; `migration.test.ts` no-op-at-SAVE_VERSION test.

Steps:

- [ ] **(CODE)** Add `equipment` to `PlayerSave` in `src/save/serialize.ts`. Before (lines 25–40):
  ```ts
  export interface PlayerSave {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    health: number;
    food: number;
    saturation: number;
    selectedSlot: number;
    inventory: (ItemStackSave | null)[];
    /** Bed spawn point. Added in save v3; absent in older saves (migrated with defaults). */
    spawnX: number;
    spawnY: number;
    spawnZ: number;
  }
  ```
  After — append the field (length-4 array: helmet/chestplate/leggings/boots):
  ```ts
  export interface PlayerSave {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    health: number;
    food: number;
    saturation: number;
    selectedSlot: number;
    inventory: (ItemStackSave | null)[];
    /** Bed spawn point. Added in save v3; absent in older saves (migrated with defaults). */
    spawnX: number;
    spawnY: number;
    spawnZ: number;
    /** Worn armor [helmet, chestplate, leggings, boots]. Added in save v4; default all-null. */
    equipment: (ItemStackSave | null)[];
  }
  ```
- [ ] **(CODE)** Bump `SAVE_FORMAT` + changelog in `src/save/serialize.ts`. Before (lines 183–190):
  ```ts
  /**
   * Container format version.
   *  - 1: header + player + binary columns.
   *  - 2: …plus a trailing length-prefixed JSON {@link MobSave}[] blob.
   *  - 3: …plus spawnX/spawnY/spawnZ (f64×3) appended at the end of the player record.
   * Older containers are still readable (spawn defaults to the player position).
   */
  const SAVE_FORMAT = 3;
  ```
  After:
  ```ts
  /**
   * Container format version.
   *  - 1: header + player + binary columns.
   *  - 2: …plus a trailing length-prefixed JSON {@link MobSave}[] blob.
   *  - 3: …plus spawnX/spawnY/spawnZ (f64×3) appended at the end of the player record.
   *  - 4: …plus a length-prefixed equipment slot array at the end of the player record.
   * Older containers are still readable (spawn defaults to the player position;
   * equipment defaults to all-null).
   */
  const SAVE_FORMAT = 4;
  ```
- [ ] **(CODE)** Append equipment to `writePlayer` in `src/save/serialize.ts`. Before (end of `writePlayer`, lines 359–363):
  ```ts
    // Spawn point (added in save v3).
    w.f64(p.spawnX);
    w.f64(p.spawnY);
    w.f64(p.spawnZ);
  }
  ```
  After — reuse the same `SLOT_EMPTY`/`SLOT_PRESENT` + durability encoding as inventory:
  ```ts
    // Spawn point (added in save v3).
    w.f64(p.spawnX);
    w.f64(p.spawnY);
    w.f64(p.spawnZ);

    // Equipment slots (added in container format 4).
    w.u32(p.equipment.length);
    for (const slot of p.equipment) {
      if (slot === null) {
        w.u8(SLOT_EMPTY);
        continue;
      }
      w.u8(SLOT_PRESENT);
      w.i32(slot.itemId);
      w.i32(slot.count);
      w.i32(slot.maxStack);
      const hasDur =
        slot.durability !== undefined && slot.maxDurability !== undefined;
      if (hasDur) {
        w.u8(DURABILITY_PRESENT);
        w.i32(slot.durability ?? 0);
        w.i32(slot.maxDurability ?? 0);
      } else {
        w.u8(DURABILITY_ABSENT);
      }
    }
  }
  ```
- [ ] **(CODE)** Read equipment in `readPlayer`, defaulting to 4 nulls on older containers. Before (lines 397–422):
  ```ts
    // Spawn point (added in container format 3 / save v3).
    // Older containers default spawn to the player's current position.
    let spawnX = x;
    let spawnY = y;
    let spawnZ = z;
    if (containerFormat >= 3) {
      spawnX = r.f64();
      spawnY = r.f64();
      spawnZ = r.f64();
    }

    return {
      x,
      y,
      z,
      yaw,
      pitch,
      health,
      food,
      saturation,
      selectedSlot,
      inventory,
      spawnX,
      spawnY,
      spawnZ,
    };
  }
  ```
  After:
  ```ts
    // Spawn point (added in container format 3 / save v3).
    // Older containers default spawn to the player's current position.
    let spawnX = x;
    let spawnY = y;
    let spawnZ = z;
    if (containerFormat >= 3) {
      spawnX = r.f64();
      spawnY = r.f64();
      spawnZ = r.f64();
    }

    // Equipment (added in container format 4). Older containers → all-null.
    const equipment: (ItemStackSave | null)[] = [null, null, null, null];
    if (containerFormat >= 4) {
      const eqCount = r.u32();
      equipment.length = 0;
      for (let i = 0; i < eqCount; i++) {
        const present = r.u8();
        if (present === SLOT_EMPTY) {
          equipment.push(null);
          continue;
        }
        const itemId = r.i32();
        const count = r.i32();
        const maxStack = r.i32();
        const durFlag = r.u8();
        if (durFlag === DURABILITY_PRESENT) {
          const durability = r.i32();
          const maxDurability = r.i32();
          equipment.push({ itemId, count, maxStack, durability, maxDurability });
        } else {
          equipment.push({ itemId, count, maxStack });
        }
      }
    }

    return {
      x,
      y,
      z,
      yaw,
      pitch,
      health,
      food,
      saturation,
      selectedSlot,
      inventory,
      spawnX,
      spawnY,
      spawnZ,
      equipment,
    };
  }
  ```
- [ ] **(CODE)** Bump `SAVE_VERSION` + add `MIGRATIONS[3]` in `src/save/migration.ts`. Before (line 14):
  ```ts
  export const SAVE_VERSION = 3;
  ```
  After:
  ```ts
  export const SAVE_VERSION = 4;
  ```
  Before (`MIGRATIONS`, lines 30–42):
  ```ts
  export const MIGRATIONS: Record<number, Migration> = {
    1: (data) => ({ ...data, version: 2, mobs: [] }),
    2: (data) => ({
      ...data,
      version: 3,
      player: {
        ...data.player,
        spawnX: data.player.x,
        spawnY: data.player.y,
        spawnZ: data.player.z,
      },
    }),
  };
  ```
  After — add the v3→v4 step seeding an all-null equipment array (also extend the doc comment above to mention `MIGRATIONS[3]`):
  ```ts
  export const MIGRATIONS: Record<number, Migration> = {
    1: (data) => ({ ...data, version: 2, mobs: [] }),
    2: (data) => ({
      ...data,
      version: 3,
      player: {
        ...data.player,
        spawnX: data.player.x,
        spawnY: data.player.y,
        spawnZ: data.player.z,
      },
    }),
    3: (data) => ({
      ...data,
      version: 4,
      player: {
        ...data.player,
        equipment: [null, null, null, null],
      },
    }),
  };
  ```
- [ ] **(CODE)** Add `snapshotEquipment` + wire it into `buildWorldSave` in `src/game/persistence.ts`. After `snapshotInventory` (line 60):
  ```ts
  /** Snapshot the 4 armor slots [helmet, chestplate, leggings, boots] into save shape. */
  function snapshotEquipment(eq: Equipment): (ItemStackSave | null)[] {
    return ARMOR_SLOTS.map((slot) => {
      const stack = eq.get(slot);
      return stack === null ? null : toItemSave(stack);
    });
  }
  ```
  In `buildWorldSave`, before (lines 86–90):
  ```ts
      inventory: snapshotInventory(player.inventory),
      spawnX: sp.x,
      spawnY: sp.y,
      spawnZ: sp.z,
    };
  ```
  After:
  ```ts
      inventory: snapshotInventory(player.inventory),
      spawnX: sp.x,
      spawnY: sp.y,
      spawnZ: sp.z,
      equipment: snapshotEquipment(player.equipment),
    };
  ```
  (Add `import { Equipment, ARMOR_SLOTS } from "../inventory/equipment";` to `persistence.ts`.)
- [ ] **(CODE)** Restore equipment in `src/main.ts` after the inventory restore. Before (lines 385–390):
  ```ts
    // Inventory + selection.
    for (let i = 0; i < Inventory.SLOTS; i++) {
      const slot = p.inventory[i] ?? null;
      player.inventory.set(i, slot === null ? null : { ...slot });
    }
    player.hotbar.select(p.selectedSlot);
  ```
  After:
  ```ts
    // Inventory + selection.
    for (let i = 0; i < Inventory.SLOTS; i++) {
      const slot = p.inventory[i] ?? null;
      player.inventory.set(i, slot === null ? null : { ...slot });
    }
    player.hotbar.select(p.selectedSlot);

    // Worn armor (save v4+; older saves migrate to all-null).
    const eq = p.equipment ?? [null, null, null, null];
    ARMOR_SLOTS.forEach((armorSlot, i) => {
      const slot = eq[i] ?? null;
      player.equipment.set(armorSlot, slot === null ? null : { ...slot });
    });
  ```
  (Add `ARMOR_SLOTS` to the `equipment` import in `main.ts` — it already imports `Equipment` from Task 4.)
- [ ] **(CODE, UNIT)** Update `src/save/migration.test.ts` pin. Before (lines 115–117):
  ```ts
    it('exposes SAVE_VERSION = 3 and a MIGRATIONS registry', () => {
      expect(SAVE_VERSION).toBe(3);
      expect(typeof MIGRATIONS).toBe('object');
    });
  ```
  After:
  ```ts
    it('exposes SAVE_VERSION = 4 and a MIGRATIONS registry', () => {
      expect(SAVE_VERSION).toBe(4);
      expect(typeof MIGRATIONS).toBe('object');
    });
  ```
  Then add a v3→v4 migration test (model it on the existing v2→v3 spawn test in this file):
  ```ts
    it('MIGRATIONS[3] adds an all-null equipment array (v3 → v4)', () => {
      const v3 = saveAt(3, 42);
      const out = MIGRATIONS[3](v3);
      expect(out.version).toBe(4);
      expect(out.player.equipment).toEqual([null, null, null, null]);
    });
  ```
  (If `saveAt(...)` does not already produce a player record with all required fields for v3, mirror the helper's existing usage for the v2→v3 case.)
- [ ] **(CODE, UNIT)** Extend `samplePlayer()` in `src/save/serialize.test.ts` to include `equipment` and assert it round-trips. Add to the fixture literal:
  ```ts
    equipment: [
      { itemId: Items.IRON_HELMET, count: 1, maxStack: 1, durability: 165, maxDurability: 165 },
      null,
      null,
      { itemId: Items.LEATHER_BOOTS, count: 1, maxStack: 1 },
    ],
  ```
  And add a round-trip assertion alongside the existing inventory one:
  ```ts
    expect(round.player.equipment).toEqual(sample.player.equipment);
  ```
  (Import `Items` from `../rules/items` if not already.)
- [ ] **(CODE, UNIT)** Extend `src/game/persistence.test.ts`: in `makeTestPlayer()` (or its fixture), wear one armor piece, then assert it round-trips:
  ```ts
    player.equipment.equip("chestplate", makeStack(Items.DIAMOND_CHESTPLATE, 1, 1));
    // ...after round-trip restore...
    expect(restored.equipment.get("chestplate")?.itemId).toBe(Items.DIAMOND_CHESTPLATE);
  ```
  (Match the test's existing round-trip mechanism — it builds a save, serializes, deserializes, and reloads into a fresh `Player`; assert against that reloaded player's `equipment`.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/save/serialize.test.ts src/save/migration.test.ts src/game/persistence.test.ts` → all green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(save): persist equipment + SAVE_VERSION 3→4 migration`

---

### Task 9: Full regression + live-QA gate

**Files:**
- No new source — verification + manual combat-feel QA.

Steps:

- [ ] **(VERIFY, UNIT)** `corepack pnpm test` → the WHOLE suite green. Specifically confirm the must-protect tests pass unchanged in intent:
  - `src/inventory/inventory.test.ts` — `Inventory.SLOTS === 36` (not widened).
  - `src/game/mob-driver.test.ts` — the 2-arg `attackMob` tests still pin `health === full - PLAYER_ATTACK_DAMAGE` and `lastDamageTick === 1234`.
  - `src/rules/items.test.ts` — id-uniqueness / ≥256 / every-`Items.*`-registered invariants.
  - `src/survival/stats.test.ts` — `damage(s, 6)` → 14 (armor applied in the wrapper, not in `damage()`).
  - `src/save/migration.test.ts` — `SAVE_VERSION === 4`; no-op-at-`SAVE_VERSION` still passes.
  - `src/save/serialize.test.ts` + `src/game/persistence.test.ts` — inventory + new equipment round-trip.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors (especially no missing `"armor"` branch in any exhaustive `switch (def.kind)`).
- [ ] **(LIVE-QA)** Run the app (per CLAUDE.md, browse/▶-run). Verify the combat FEEL the headless suite cannot:
  - Equip an iron chestplate (right-click) → taking a zombie hit removes fewer hearts than bare.
  - A zombie standing inside the player no longer drains health every tick (i-frames) — hearts drop in discrete steps, not continuously.
  - Melee a mob → it lurches back and slightly up (knockback), and the damage dealt is unchanged.
  - Armor durability ticks down on hits (check via a debug readout or by wearing a low-durability piece until it breaks/disappears).
  - Save + reload → worn armor persists; loading a pre-Phase-4 save loads with empty equipment and does not crash.
- [ ] **Commit (if any test-only fixups were needed):** `test: green Phase-4 combat+equipment suite`

---

## Self-review resolutions (planner)

Verified against the live codebase before locking:
- **`damageTool` gates on `durability === undefined`, not on item kind** — it wears any stack carrying a durability field and silently no-ops on one without. Armor must therefore be created WITH durability. Resolved by `makeArmorStack` (Task 3), used at every armor source: the starter set in `default-inventory.ts` (Task 4) and the durability unit test (Task 5). Without this, armor would reduce damage but never wear out, and the player could not acquire any armor to equip.
- **No `switch (def.kind)` exists** anywhere in `src/` (only `=== "tool"/"food"` comparisons), so adding `"armor"` to the `kind` union causes NO exhaustiveness breakage. The Task 2 precaution scan will find nothing — that is expected, not a miss.
- **Exactly two player-damage sites** (`mob-driver.ts` 279, 357); `main.ts` has none. Both reroute through `applyPlayerDamage`. Starvation writes `health` directly in `stats.ts` and correctly bypasses armor + i-frames.
- **Rounding:** `armorReduction` uses `Math.round` (matches the spec's "round to integer half-hearts"); the fixtures are consistent with round. Floor would also stay integer but is not what the spec specified.
- **Deferred intentionally:** gold armor (defense/durability constants present, no item ids), a dedicated HUD armor bar (the armor effect is observable via the existing hearts HUD and the bag losing the equipped piece), player-knockback, ranged, potions, off-hand.

## Notes on testability

- **Unit-testable (no live QA):** `armorReduction` (Task 1), the `Equipment` holder (Task 3), `applyPlayerDamage` armor+durability+i-frame logic (Tasks 5–6), `isInvulnerable` predicate (Task 6), `knockbackImpulse` vector + `mobStep` blend/decay (Task 7), `MIGRATIONS[3]` + serialize round-trip (Task 8), and `resolveUse` armor→equip routing (Task 4).
- **Requires live QA (feel/glue only):** the visible equip click, armor mitigating hearts, i-frames stopping the 20 Hz drain, the mob lurch on melee, durability wear, and save/reload persistence of worn armor. The underlying logic for all of these is exercised by the pure modules above; only the Babylon/event/HUD glue is QA-only.

## Out of scope (explicitly deferred)

- **Player knockback** — `Player.update` recomputes horizontal velocity from raw input every tick with no accumulator; there is no impulse channel to inject a persistent shove. Deferred (spec §4.3, §5.6).
- **Ranged / bow / arrow** — needs a kinematic projectile entity + `mouseup` charge input; Phase 5.
- **Potions / status effects (incl. resistance)** — greenfield `effects.ts`; Phase 5. Because resistance is deferred, the armor order here is simply **armor → clamp** (no resistance stage).
- **Off-hand slot** — non-trivial (extra slot + UI + persistence column); not included. `Equipment` is 4 slots only.
