# Phase 2 — Interaction Core: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make right-click route by item kind (interact → eat → place → use-other), make tools matter (tier × hardness mining timer + sword damage), and fix the fake starter inventory — all without touching `placeBlock`'s `BLOCK_COUNT` guard.
**Architecture:** A pure, Babylon-free `resolveUse(itemDef, ctx)` dispatcher (`interaction/use-item.ts`) decides the right-click action; `main.ts` wires it in *upstream* of `placeBlock` (the existing guard stays the safe fallback). Mining becomes a pure `breakTicks(blockId, heldDef)` timer (`interaction/mining.ts`) accumulated on the fixed 20 Hz tick, with durability charged exactly once on break. Sword damage flows through `attackDamageFor(heldDef)` (mob-driver), with `attackMob`'s signature kept defaulted so its test stays green. A single `makeDefaultInventory()` factory localizes starter-loadout churn. Armor / off-hand / ranged / potions are explicitly deferred to later phases.
**Tech Stack:** Babylon.js 8, TypeScript, Vite, Vitest

---

## File Structure

| File | Responsibility |
|---|---|
| `src/interaction/use-item.ts` | **Create.** Pure `resolveUse(itemDef, ctx)` returning a tagged `UseAction` union (`"interact-block" \| "eat" \| "place" \| "use-other" \| "none"`). No Babylon, no world writes. |
| `src/interaction/use-item.test.ts` | **Create.** Routing-matrix unit tests for `resolveUse` (food-when-hungry vs food-when-full, placeable, tool, material, empty). |
| `src/interaction/mining.ts` | **Create.** Pure `breakTicks(blockId, heldDef)` (tier × hardness → integer ticks; `Infinity` → never breaks). No Babylon. |
| `src/interaction/mining.test.ts` | **Create.** `breakTicks` unit tests (hand vs tier; missing-hardness fallback; bedrock/Infinity). |
| `src/game/mob-driver.ts` | **Modify** (lines 53–54, 478–484). Add `attackDamageFor(heldDef)`; keep `PLAYER_ATTACK_DAMAGE = 4` exported; default `attackMob`'s 3rd arg. |
| `src/game/mob-driver.test.ts` | **Modify** (after line 211). Add `attackDamageFor` tests; existing `attackMob` test stays untouched/green. |
| `src/inventory/default-inventory.ts` | **Create.** `makeDefaultInventory()` factory: real `Items.*` tools + food via `makeStack`/`makeToolStack`. |
| `src/inventory/default-inventory.test.ts` | **Create.** Asserts starter slot contents (real tool ids, food present, no fake block-id tools). |
| `src/main.ts` | **Modify.** Wire `resolveUse` into RMB branch (lines 697–733), add `mouseup` listener (after line 738), drive mining timer on the fixed tick (lines 823–844), swap LMB instant-break for timer start (lines 675–696), use `makeDefaultInventory()` (lines 303–312), pass held def to `attackMob` + durability on hit (lines 656–671). |

---

### Task 1: Pure `resolveUse` dispatcher module + test

Pure routing only. Fully unit-testable; no live QA needed.

**Files:**
- Create: `src/interaction/use-item.ts`
- Test: `src/interaction/use-item.test.ts`

Steps:

- [ ] Create `src/interaction/use-item.ts` with the `UseAction` union and the pure `resolveUse` function. `ItemDef` is imported from the registry; the context carries only what the decision needs (whether the player is hungry, i.e. `food < MAX_FOOD`). Precedence mirrors spec §4.2: interact-block is decided in glue (table/bed already handled before this point), so `resolveUse` covers eat → place → use-other. Add code:

```ts
/**
 * use-item.ts — PURE right-click action router.
 *
 * Decides WHAT a right-click should do given the held item's definition and a
 * tiny context. It performs NO world writes, NO Babylon calls, NO stack
 * mutation — the caller (main.ts) maps the returned action to real effects.
 *
 * Block-interaction special cases (crafting table, bed, future furnace) are
 * handled by the caller BEFORE resolveUse is consulted (spec §4.2 precedence:
 * interact-block → eat-if-food-and-hungry → place-if-placeable → use-other).
 */

import type { ItemDef } from "../rules/items";

/** The action a right-click resolves to. */
export type UseAction =
  | { kind: "eat" }
  | { kind: "place" }
  | { kind: "use-other" }
  | { kind: "none" };

/** Minimal decision context (no Babylon, no world). */
export interface UseContext {
  /** True when the player can still benefit from eating (food < MAX_FOOD). */
  readonly hungry: boolean;
}

/**
 * Resolve the right-click action for a held item.
 *
 * - food + hungry  → eat
 * - food + full    → none (don't waste the food)
 * - placeable      → place
 * - anything else  → use-other (tools, materials with future behaviour)
 */
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

- [ ] Create `src/interaction/use-item.test.ts` covering the routing matrix. Use real registry defs via `getItemDef` so the test tracks the live registry. Add code:

```ts
import { describe, it, expect } from "vitest";
import { resolveUse } from "./use-item";
import { getItemDef, Items } from "../rules/items";
import { Blocks } from "../rules/mc-1.20";

describe("resolveUse", () => {
  it("food while hungry → eat", () => {
    const def = getItemDef(Items.BREAD);
    expect(resolveUse(def, { hungry: true })).toEqual({ kind: "eat" });
  });

  it("food while full → none (don't waste it)", () => {
    const def = getItemDef(Items.BREAD);
    expect(resolveUse(def, { hungry: false })).toEqual({ kind: "none" });
  });

  it("placeable block → place (regardless of hunger)", () => {
    const def = getItemDef(Blocks.OAK_PLANKS);
    expect(resolveUse(def, { hungry: true })).toEqual({ kind: "place" });
    expect(resolveUse(def, { hungry: false })).toEqual({ kind: "place" });
  });

  it("tool → use-other (not placeable, not food)", () => {
    const def = getItemDef(Items.IRON_PICKAXE);
    expect(resolveUse(def, { hungry: true })).toEqual({ kind: "use-other" });
  });

  it("material → use-other", () => {
    const def = getItemDef(Items.STICK);
    expect(resolveUse(def, { hungry: false })).toEqual({ kind: "use-other" });
  });
});
```

- [ ] Verify: `corepack pnpm vitest run src/interaction/use-item.test.ts`
  Expected: 5 tests pass, 0 fail.
- [ ] Verify: `corepack pnpm typecheck`
  Expected: no errors.
- [ ] Commit: `feat(interaction): add pure resolveUse right-click action router`

---

### Task 2: Wire right-click routing + eat into main.ts (fixes the no-op bug)

This is the bug fix: non-block items currently silently no-op because `placeBlock`'s guard (`itemId >= BLOCK_COUNT`, `edit.ts:79`) drops them. We intercept BEFORE `placeBlock`. The `edit.test.ts` placeBlock cases stay green because `placeBlock` itself is untouched (block ids still fall through to it). Eat-wiring is unit-testable via survival state; the click *feel* needs live QA.

**Files:**
- Modify: `src/main.ts` (imports near lines 36/39/41/46; RMB branch lines 697–733)
- Test: covered by `src/interaction/use-item.test.ts` (Task 1) for routing; eat math already covered by `src/survival/stats.test.ts`. Live QA for click feel.

Steps:

- [ ] Add registry + eat imports to `src/main.ts`. Current import of edit (line 36):

```ts
import { breakBlock, placeBlock } from "./interaction/edit";
```

  Add immediately after it:

```ts
import { resolveUse } from "./interaction/use-item";
import { getItemDef } from "./rules/items";
import { eat } from "./survival/stats";
```

  And extend the existing mc-1.20 import (line 41) from:

```ts
import { Blocks, EXHAUSTION, TICKS_PER_SECOND, TIME } from "./rules/mc-1.20";
```

  to add `HUNGER`:

```ts
import { Blocks, EXHAUSTION, HUNGER, TICKS_PER_SECOND, TIME } from "./rules/mc-1.20";
```

- [ ] In the RMB branch, insert the use-item dispatcher AFTER the bed early-return and BEFORE the `placeBlock(...)` call. Current code (lines 706–733):

```ts
    // RMB on a bed → sleep (or show "can only sleep at night" message).
    if (targetBlock === Blocks.BED) {
      if (canSleep(clock)) {
        sleepToDawn(clock);
        // Update the player's spawn point to one block above the bed.
        const bedSpawn = {
          x: hit.block.x + 0.5,
          y: hit.block.y + 2,
          z: hit.block.z + 0.5,
        };
        spawnPoint = bedSpawn;
        player.setSpawn(bedSpawn);
        showToast("Good morning!");
      } else {
        showToast("You can only sleep at night.");
      }
      return;
    }
    placeBlock(world, hit, renderer, player);
    const placePos = {
      x: hit.previous.x + 0.5,
      y: hit.previous.y + 0.5,
      z: hit.previous.z + 0.5,
    };
    // Play place sound at the placement position.
    gameAudio?.onPlace(placePos);
    // Spawn placement-puff particles.
    gameEffects?.onPlace(placePos);
  }
```

  Replace the `placeBlock(world, hit, renderer, player);` line and the audio/effects block that follows it with the dispatcher + a place-only effects guard. New code (the bed branch above is unchanged):

```ts
    // Route the right-click by held-item kind BEFORE falling through to place.
    // placeBlock's BLOCK_COUNT guard (edit.ts:79) stays the safe fallback — we
    // never weaken it; non-block items are simply handled here first.
    const slot = player.hotbar.selected;
    const held = player.inventory.get(slot);
    if (held === null || held.count <= 0) return;
    const def = getItemDef(held.itemId);
    const action = resolveUse(def, {
      hungry: player.survival.food < HUNGER.MAX_FOOD,
    });
    if (action.kind === "eat") {
      const f = def.food;
      if (f !== undefined) {
        eat(player.survival, f.hunger, f.saturation);
        player.inventory.removeFromSlot(slot, 1);
        gameAudio?.onEat?.(player.eyePosition());
      }
      return;
    }
    if (action.kind === "use-other" || action.kind === "none") {
      // Tools / materials have no right-click effect yet; do nothing (and do
      // NOT play place audio/particles).
      return;
    }
    // action.kind === "place": fall through to the existing block placement.
    placeBlock(world, hit, renderer, player);
    const placePos = {
      x: hit.previous.x + 0.5,
      y: hit.previous.y + 0.5,
      z: hit.previous.z + 0.5,
    };
    // Play place sound at the placement position.
    gameAudio?.onPlace(placePos);
    // Spawn placement-puff particles.
    gameEffects?.onPlace(placePos);
  }
```

  Note: `gameAudio?.onEat?.(...)` uses optional-chaining on the method so it compiles whether or not `GameAudio` defines `onEat`; if it does not, the call is a no-op (no Phase-2 audio work required).

- [ ] Verify: `corepack pnpm typecheck`
  Expected: no errors. (If `onEat` is reported as a type error rather than silently optional, drop that one line — it is non-essential.)
- [ ] Verify: `corepack pnpm vitest run src/interaction/edit.test.ts`
  Expected: all `placeBlock` / `breakBlock` cases still pass (the dispatcher lives in main.ts, not in `edit.ts`; the guard is untouched).
- [ ] Verify: `corepack pnpm vitest run src/survival/stats.test.ts`
  Expected: `eat` tests still pass (eat's signature is unchanged — we call `eat(s, hunger, saturation)`).
- [ ] LIVE-QA (not unit-testable): hold food with hunger < 20 and right-click → food bar rises, one item consumed; hold food at full → nothing happens; hold a tool/material and right-click → no place sound, no block placed; hold a block → places as before.
- [ ] Commit: `fix(interaction): route right-click by item kind and wire eating`

---

### Task 3: Fix the fake starter inventory via `makeDefaultInventory()` factory

The starter "tools" are fake (block ids `OAK_LOG`/`STONE` carrying durability). Replace with real `Items.*` tools + add food, behind one factory to localize churn (spec §4.2 latent bug 2). Fully unit-testable.

**Files:**
- Create: `src/inventory/default-inventory.ts`
- Test: `src/inventory/default-inventory.test.ts`
- Modify: `src/main.ts` (lines 303–312, plus imports)

Steps:

- [ ] Create `src/inventory/default-inventory.ts`. It populates a fresh `Inventory` and is the single source of truth for the starter loadout. Add code:

```ts
/**
 * default-inventory.ts — the single source of truth for the starter loadout.
 *
 * Centralizing this (spec §4.2) keeps the real-tool ids + food in one place so
 * test churn is localized and the old fake block-id "tools" bug can't recur.
 */

import { Inventory } from "./inventory";
import { makeStack, makeToolStack } from "./stack";
import { Blocks } from "../rules/mc-1.20";
import { Items } from "../rules/items";

/** Build a fresh inventory with the starter loadout (real tools + food). */
export function makeDefaultInventory(): Inventory {
  const inv = new Inventory();
  inv.set(0, makeStack(Blocks.OAK_PLANKS, 64));
  inv.set(1, makeStack(Blocks.STONE, 64));
  inv.set(2, makeStack(Blocks.GLASS, 64));
  inv.set(3, makeStack(Blocks.COBBLESTONE, 64));
  // Real tool items (were Blocks.OAK_LOG / Blocks.STONE — fake block-id tools).
  inv.set(4, makeToolStack(Items.WOODEN_PICKAXE, "wood"));
  inv.set(5, makeToolStack(Items.STONE_PICKAXE, "stone"));
  inv.set(6, makeStack(Blocks.CRAFTING_TABLE, 4));
  inv.set(7, makeStack(Blocks.BED, 1));
  // Food (previously absent entirely).
  inv.set(8, makeStack(Items.BREAD, 8));
  return inv;
}
```

- [ ] Create `src/inventory/default-inventory.test.ts`. Add code:

```ts
import { describe, it, expect } from "vitest";
import { makeDefaultInventory } from "./default-inventory";
import { Items } from "../rules/items";
import { Blocks } from "../rules/mc-1.20";
import { isTool } from "./stack";

describe("makeDefaultInventory", () => {
  it("seeds real tool items, not fake block-id tools", () => {
    const inv = makeDefaultInventory();
    const pick = inv.get(4);
    const stonePick = inv.get(5);
    expect(pick?.itemId).toBe(Items.WOODEN_PICKAXE);
    expect(stonePick?.itemId).toBe(Items.STONE_PICKAXE);
    // The old bug seeded Blocks.OAK_LOG / Blocks.STONE here — guard against it.
    expect(pick?.itemId).not.toBe(Blocks.OAK_LOG);
    expect(stonePick?.itemId).not.toBe(Blocks.STONE);
  });

  it("tools carry durability and are single-stack", () => {
    const inv = makeDefaultInventory();
    const pick = inv.get(4);
    expect(pick).not.toBeNull();
    if (pick !== null) {
      expect(isTool(pick)).toBe(true);
      expect(pick.maxStack).toBe(1);
    }
  });

  it("includes food in the starter loadout", () => {
    const inv = makeDefaultInventory();
    const food = inv.get(8);
    expect(food?.itemId).toBe(Items.BREAD);
    expect(food?.count).toBe(8);
  });

  it("seeds the placeable starter blocks", () => {
    const inv = makeDefaultInventory();
    expect(inv.get(0)?.itemId).toBe(Blocks.OAK_PLANKS);
    expect(inv.get(0)?.count).toBe(64);
    expect(inv.get(7)?.itemId).toBe(Blocks.BED);
  });
});
```

- [ ] Wire the factory into `main.ts`. Current starter block (lines 303–312):

```ts
// Starter inventory: blocks to place immediately + a couple of tools.
player.inventory.set(0, makeStack(Blocks.OAK_PLANKS, 64));
player.inventory.set(1, makeStack(Blocks.STONE, 64));
player.inventory.set(2, makeStack(Blocks.GLASS, 64));
player.inventory.set(3, makeStack(Blocks.COBBLESTONE, 64));
player.inventory.set(4, makeToolStack(Blocks.OAK_LOG, "wood"));
player.inventory.set(5, makeToolStack(Blocks.STONE, "stone"));
player.inventory.set(6, makeStack(Blocks.CRAFTING_TABLE, 4));
player.inventory.set(7, makeStack(Blocks.BED, 1));
player.hotbar.select(0);
```

  Replace the eight `player.inventory.set(...)` lines with a copy from the factory (keeps `player.inventory` as the live instance other code already references):

```ts
// Starter inventory: real tools + blocks + food, from the single factory.
const starter = makeDefaultInventory();
for (let i = 0; i < Inventory.SLOTS; i++) {
  player.inventory.set(i, starter.get(i));
}
player.hotbar.select(0);
```

- [ ] Add the factory import to `main.ts` near the existing inventory import (line 40 `import { Inventory } from "./inventory/inventory";`). Add after it:

```ts
import { makeDefaultInventory } from "./inventory/default-inventory";
```

  (`makeStack`/`makeToolStack` remain imported at line 39; they may now be unused at the call site — keep them if still used elsewhere in main.ts, otherwise remove only the now-unused names to satisfy typecheck.)

- [ ] Verify: `corepack pnpm vitest run src/inventory/default-inventory.test.ts`
  Expected: 4 tests pass.
- [ ] Verify: `corepack pnpm typecheck`
  Expected: no errors (resolve any unused-import warning from `makeStack`/`makeToolStack` at the old site).
- [ ] LIVE-QA (not unit-testable): on a fresh world, slots 5 and 6 show a wooden + stone pickaxe sprite (not an oak-log / stone-block sprite), and bread occupies slot 9.
- [ ] Commit: `fix(inventory): real starter tools + food via makeDefaultInventory factory`

---

### Task 4: Pure `breakTicks` mining-time module + test

Pure tier × hardness → integer ticks. `Infinity` hardness never breaks; missing hardness uses a fast hand-break fallback. Fully unit-testable.

**Files:**
- Create: `src/interaction/mining.ts`
- Test: `src/interaction/mining.test.ts`

Grounding constants (verified): `TOOL_TIER_MULTIPLIER` (mc-1.20.ts:99) = `{ none:1, wood:2, stone:4, iron:6, diamond:8, gold:12 }`; `BLOCK_HARDNESS` (mc-1.20.ts:192) is a `Partial<Record<BlockId, number>>` (STONE=1.5, OAK_LOG=2, BEDROCK=Infinity, etc.; many blocks absent). `TICKS_PER_SECOND` is exported from mc-1.20. `ItemDef.toolTier` is `"wood"|"stone"|"iron"|"diamond"|"gold"` (items.ts:30).

Steps:

- [ ] Create `src/interaction/mining.ts`. Add code:

```ts
/**
 * mining.ts — PURE break-time calculation (tools matter, spec §4.3).
 *
 * breakTicks(blockId, heldDef) returns the whole number of fixed 20 Hz ticks a
 * block takes to break: base seconds (BLOCK_HARDNESS) ÷ tier speed multiplier,
 * converted to ticks and rounded up to at least one. No Babylon, no world, no
 * mutation — the caller accumulates these on the fixed tick.
 *
 *  - Infinity hardness (e.g. BEDROCK) → Infinity ticks (never breaks).
 *  - Missing hardness → a fast hand-break fallback (so unlisted blocks aren't
 *    accidentally unbreakable; spec/analysis: ~0.5 s by hand).
 */

import {
  BLOCK_HARDNESS,
  TOOL_TIER_MULTIPLIER,
  TICKS_PER_SECOND,
  type BlockId,
} from "../rules/mc-1.20";
import type { ItemDef } from "../rules/items";

/** Hand-break seconds for blocks absent from BLOCK_HARDNESS. */
const DEFAULT_HARDNESS_SECONDS = 0.5;

/** Whole fixed-ticks to break `blockId` with `heldDef` (null = bare hand). */
export function breakTicks(blockId: BlockId, heldDef: ItemDef | null): number {
  const hardness = BLOCK_HARDNESS[blockId] ?? DEFAULT_HARDNESS_SECONDS;
  if (!Number.isFinite(hardness)) return Infinity; // unbreakable (e.g. bedrock)

  const tier =
    heldDef !== null && heldDef.kind === "tool" && heldDef.toolTier !== undefined
      ? heldDef.toolTier
      : "none";
  const multiplier = TOOL_TIER_MULTIPLIER[tier];

  const seconds = hardness / multiplier;
  return Math.max(1, Math.ceil(seconds * TICKS_PER_SECOND));
}
```

- [ ] Create `src/interaction/mining.test.ts`. Add code (numbers derived from the real tables: STONE hardness 1.5 s × 20 tps = 30 ticks by hand; ÷ multiplier for tools; `Math.ceil`):

```ts
import { describe, it, expect } from "vitest";
import { breakTicks } from "./mining";
import { Blocks } from "../rules/mc-1.20";
import { getItemDef, Items } from "../rules/items";

describe("breakTicks", () => {
  it("hand-breaks STONE in 30 ticks (1.5s × 20tps ÷ 1)", () => {
    expect(breakTicks(Blocks.STONE, null)).toBe(30);
  });

  it("wood pickaxe halves STONE break time (÷2 → 15 ticks)", () => {
    const wood = getItemDef(Items.WOODEN_PICKAXE);
    expect(breakTicks(Blocks.STONE, wood)).toBe(15);
  });

  it("diamond pickaxe is much faster on STONE (1.5×20÷8 → ceil(3.75)=4)", () => {
    const diamond = getItemDef(Items.DIAMOND_PICKAXE);
    expect(breakTicks(Blocks.STONE, diamond)).toBe(4);
  });

  it("BEDROCK is never breakable (Infinity hardness → Infinity ticks)", () => {
    expect(breakTicks(Blocks.BEDROCK, null)).toBe(Infinity);
  });

  it("missing-hardness block uses the fast hand fallback (0.5s → 10 ticks)", () => {
    // GRAVEL is absent from BLOCK_HARDNESS → fallback 0.5s × 20 = 10.
    expect(breakTicks(Blocks.GRAVEL, null)).toBe(10);
  });

  it("never returns less than 1 tick", () => {
    // OAK_LEAVES hardness 0.2s ÷ 1 = 4 ticks by hand; with a tool it floors at 1.
    const diamond = getItemDef(Items.DIAMOND_AXE);
    expect(breakTicks(Blocks.OAK_LEAVES, diamond)).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] Verify: `corepack pnpm vitest run src/interaction/mining.test.ts`
  Expected: 6 tests pass.
- [ ] Verify: `corepack pnpm typecheck`
  Expected: no errors.
- [ ] Commit: `feat(interaction): add pure breakTicks tier×hardness mining timer`

---

### Task 5: Integrate the mining timer on the fixed tick (mousedown start / mouseup reset / break-once)

Replace instant LMB break with a held-progress timer accumulated on the 20 Hz tick. Durability is charged exactly ONCE on break (the old per-click charge at lines 691–696 must move to the completion site — leaving both is a double-charge). Add the missing `mouseup` listener. Resetting on look-away / target-change / mouseup is integration logic; the *feel* needs live QA, but the no-double-charge invariant and reset behaviour are partly observable via the test-api if present.

**Files:**
- Modify: `src/main.ts` (LMB branch lines 675–696; mousedown wiring lines 736–738; fixed-tick loop lines 823–844; imports)
- Test: `breakTicks` math covered by Task 4; integration is LIVE-QA. Add a guard comment marking the single durability site.

Steps:

- [ ] Add a small mining-state holder near the top of the module-level state in `main.ts` (after `const player = new Player(spawnPoint);`, line 301). Add code:

```ts
// --- Mining timer (Phase 2): hold LMB to break; progress on the fixed tick.
interface MiningState {
  active: boolean;
  x: number;
  y: number;
  z: number;
  slot: number;
  elapsed: number; // fixed-ticks accumulated against the current target
}
const mining: MiningState = { active: false, x: 0, y: 0, z: 0, slot: -1, elapsed: 0 };
function resetMining(): void {
  mining.active = false;
  mining.elapsed = 0;
}
```

- [ ] Add the `breakTicks` + `getItemDef` imports to `main.ts`. `getItemDef` is already imported in Task 2; add mining import after the use-item import:

```ts
import { breakTicks } from "./interaction/mining";
```

- [ ] Replace the LMB instant-break body with a timer start. Current code (lines 675–696):

```ts
  if (button === 0) {
    const brokenId = world.getBlock(hit.block.x, hit.block.y, hit.block.z);
    breakBlock(world, hit, renderer, player.inventory);
    const breakPos = {
      x: hit.block.x + 0.5,
      y: hit.block.y + 0.5,
      z: hit.block.z + 0.5,
    };
    // Play break sound at block world position.
    gameAudio?.onBreak(brokenId, breakPos);
    // Spawn block-debris particles at the same position.
    gameEffects?.onBreak(brokenId, breakPos);
    // Hint: first block broken → show "place a block" hint.
    hintManager?.onBlockBreak();
    // Breaking costs exhaustion; if a tool is held, wear it down by one use
    // and write the result back (clearing the slot when the tool breaks).
    addExhaustion(player.survival, EXHAUSTION.BREAK_BLOCK);
    const slot = player.hotbar.selected;
    const held = player.inventory.get(slot);
    if (held !== null && isTool(held)) {
      player.inventory.set(slot, damageTool(held));
    }
  } else if (button === 2) {
```

  Replace the whole `if (button === 0) { ... }` block (NOT the `else if`) with a timer start. The actual break + sound + particles + exhaustion + durability move to the tick-completion site in the next step:

```ts
  if (button === 0) {
    // Start (or retarget) the mining timer; the fixed tick does the breaking.
    mining.active = true;
    mining.x = hit.block.x;
    mining.y = hit.block.y;
    mining.z = hit.block.z;
    mining.slot = player.hotbar.selected;
    mining.elapsed = 0;
  } else if (button === 2) {
```

- [ ] Add a `mouseup` listener (none exists today) to stop mining on release. Current wiring (lines 736–738):

```ts
canvas.addEventListener("mousedown", (e) => {
  handleClick(e.button);
});
```

  Add immediately after it:

```ts
canvas.addEventListener("mouseup", (e) => {
  if (e.button === 0) resetMining();
});
```

- [ ] Drive the timer inside the fixed-tick loop, BEFORE `player.update(...)`. Current loop head (lines 823–824):

```ts
  while (!frozen && accumulator >= TICK_SECONDS) {
    player.update(input, camera.rotation.y, world);
```

  Insert the mining step between the `while` line and `player.update(...)`:

```ts
  while (!frozen && accumulator >= TICK_SECONDS) {
    // --- Mining: accumulate progress; break exactly once when complete.
    if (mining.active) {
      const eyeNow = player.eyePosition();
      const fwdNow = camera.getDirection(Vector3.Forward());
      const hitNow = raycastVoxel(
        eyeNow,
        { x: fwdNow.x, y: fwdNow.y, z: fwdNow.z },
        REACH,
        (bx, by, bz) => world.getBlock(bx, by, bz),
      );
      // Reset if the player looked away or the target voxel changed.
      if (
        hitNow === null ||
        hitNow.block.x !== mining.x ||
        hitNow.block.y !== mining.y ||
        hitNow.block.z !== mining.z ||
        player.hotbar.selected !== mining.slot
      ) {
        resetMining();
      } else {
        const id = world.getBlock(mining.x, mining.y, mining.z);
        const held = player.inventory.get(mining.slot);
        const heldDef = held === null ? null : getItemDef(held.itemId);
        const need = breakTicks(id, heldDef);
        mining.elapsed += 1;
        if (mining.elapsed >= need) {
          const brokenId = id;
          breakBlock(world, hitNow, renderer, player.inventory);
          const breakPos = {
            x: mining.x + 0.5,
            y: mining.y + 0.5,
            z: mining.z + 0.5,
          };
          gameAudio?.onBreak(brokenId, breakPos);
          gameEffects?.onBreak(brokenId, breakPos);
          hintManager?.onBlockBreak();
          addExhaustion(player.survival, EXHAUSTION.BREAK_BLOCK);
          // Durability charged EXACTLY ONCE, here on break (NOT per click).
          if (held !== null && isTool(held)) {
            player.inventory.set(mining.slot, damageTool(held));
          }
          resetMining();
        }
      }
    }
    player.update(input, camera.rotation.y, world);
```

  Note: `breakBlock`'s own guard already no-ops AIR/BEDROCK, and `breakTicks` returns `Infinity` for BEDROCK so `mining.elapsed >= need` is never true — bedrock never breaks (double-safe).

- [ ] Confirm there is now exactly ONE `damageTool` call on the break path (it was removed from the LMB mousedown branch and added once at completion). Search to be sure: `corepack pnpm vitest run` is not the check here — grep the file for `damageTool(` and confirm the only break-path occurrence is inside the tick-completion block above (the melee site in Task 6 is separate and intended).

- [ ] Verify: `corepack pnpm typecheck`
  Expected: no errors.
- [ ] Verify: `corepack pnpm vitest run src/interaction/edit.test.ts`
  Expected: still green (`breakBlock`'s signature/behaviour unchanged — we only changed WHEN it is called).
- [ ] LIVE-QA (not unit-testable — the feel): hold LMB on STONE → it takes ~1.5 s by hand, faster with a pickaxe; release mid-break or look away → progress resets (re-aiming restarts from 0); breaking a block with a tool removes exactly one durability point (not two); bedrock never breaks no matter how long you hold.
- [ ] Commit: `feat(interaction): hold-to-mine timer on the fixed tick (durability once on break)`

---

### Task 6: Sword `attackDamageFor` + durability on hit (keep attackMob test green)

Replace the flat `PLAYER_ATTACK_DAMAGE` per-hit value with a tier-based sword lookup, keeping the constant exported at 4 and `attackMob`'s 2-arg call working (3rd param defaulted). Tool durability is charged on a successful mob hit, mirroring the block-break pattern, in `main.ts` (NOT inside `attackMob`). `attackDamageFor` is fully unit-testable; the durability-on-hit wiring needs a quick live check.

**Files:**
- Modify: `src/game/mob-driver.ts` (lines 53–54 constant; 478–484 `attackMob`; add `attackDamageFor`)
- Modify: `src/game/mob-driver.test.ts` (add tests AFTER line 211; do NOT touch the existing `attackMob` test)
- Modify: `src/main.ts` (melee call site lines 656–671)

Scope: `toolType === "sword"` only. Axes-as-weapons, knockback, and i-frames are out of Phase-2 interaction-core scope here (knockback/i-frames belong to the mob-textures/combat-feedback work per spec §4.3).

Steps:

- [ ] In `mob-driver.ts`, add a sword damage table + `attackDamageFor`, keeping `PLAYER_ATTACK_DAMAGE` exported. Current code (lines 53–54):

```ts
/** Half-hearts a single player melee swing deals to a mob (v1: fists, no sword bonus). */
export const PLAYER_ATTACK_DAMAGE = 4;
```

  Add immediately after it (half-heart scale, consistent with the existing 4 = fists; vanilla MC sword damage in half-hearts: wood/gold 6, stone 8, iron 10, diamond 14):

```ts
import type { ItemDef } from "../rules/items";
import type { ToolTier } from "../rules/items";

/** Sword damage per tier, in half-hearts (fists = PLAYER_ATTACK_DAMAGE = 4). */
const SWORD_DAMAGE: Record<ToolTier, number> = {
  wood: 6,
  stone: 8,
  iron: 10,
  diamond: 14,
  gold: 6,
};

/**
 * Half-hearts a melee hit deals given the held item. A sword deals its tier
 * value; anything else (fists, non-sword tools, blocks) deals
 * {@link PLAYER_ATTACK_DAMAGE}.
 */
export function attackDamageFor(heldDef: ItemDef | null): number {
  if (
    heldDef !== null &&
    heldDef.kind === "tool" &&
    heldDef.toolType === "sword" &&
    heldDef.toolTier !== undefined
  ) {
    return SWORD_DAMAGE[heldDef.toolTier];
  }
  return PLAYER_ATTACK_DAMAGE;
}
```

  (Place the two `import type` lines with the other imports at the top of `mob-driver.ts`, not in the middle of the file; shown here adjacent only for context.)

- [ ] Make `attackMob` accept an optional damage amount defaulted to `PLAYER_ATTACK_DAMAGE` so the existing 2-arg test stays green. Current code (lines 478–484):

```ts
/**
 * Deal one player melee hit to `mob` at `currentTick`. v1 uses a flat
 * {@link PLAYER_ATTACK_DAMAGE} (fists); a per-tool sword bonus is deferred.
 */
export function attackMob(mob: Mob, currentTick: number): void {
  mob.takeDamage(PLAYER_ATTACK_DAMAGE, currentTick);
}
```

  Replace with:

```ts
/**
 * Deal one player melee hit to `mob` at `currentTick`. `amount` defaults to
 * {@link PLAYER_ATTACK_DAMAGE} (fists) so existing 2-arg callers/tests are
 * unaffected; the caller passes attackDamageFor(heldDef) for sword bonuses.
 */
export function attackMob(
  mob: Mob,
  currentTick: number,
  amount: number = PLAYER_ATTACK_DAMAGE,
): void {
  mob.takeDamage(amount, currentTick);
}
```

- [ ] Add `attackDamageFor` tests AFTER the existing `attackMob` describe block (after line 211 in `mob-driver.test.ts`). Do NOT modify the existing test. Add code:

```ts
describe("attackDamageFor", () => {
  it("fists / null held → PLAYER_ATTACK_DAMAGE", () => {
    expect(attackDamageFor(null)).toBe(PLAYER_ATTACK_DAMAGE);
  });

  it("non-sword tool (pickaxe) → PLAYER_ATTACK_DAMAGE", () => {
    expect(attackDamageFor(getItemDef(Items.IRON_PICKAXE))).toBe(
      PLAYER_ATTACK_DAMAGE,
    );
  });

  it("iron sword deals more than fists", () => {
    const iron = attackDamageFor(getItemDef(Items.IRON_SWORD));
    expect(iron).toBeGreaterThan(PLAYER_ATTACK_DAMAGE);
    expect(iron).toBe(10);
  });

  it("diamond sword > iron sword > wooden sword", () => {
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
```

  Add the imports this test needs at the top of `mob-driver.test.ts` (alongside the existing `attackMob` / `PLAYER_ATTACK_DAMAGE` import): `attackDamageFor` from `./mob-driver`, and `getItemDef`, `Items` from `../rules/items` (if not already imported).

- [ ] Wire the held def + durability into the melee call site in `main.ts`. Current code (lines 656–671):

```ts
  if (button === 0) {
    const mob = pickMob(eye, dir, REACH, mobDriver.manager.all());
    if (mob !== null) {
      const mobDist = Math.hypot(
        mob.feet.x - eye.x,
        mob.feet.y - eye.y,
        mob.feet.z - eye.z,
      );
      const blockDist = hit === null ? Infinity : blockHitDistance(eye, hit);
      if (mobDist <= blockDist) {
        attackMob(mob, clock.totalTicks);
        // Play hurt sound at mob position.
        gameAudio?.onMobHurt(mob.feet);
        return; // this click hit a mob; skip the block break
      }
    }
  }
```

  Replace the `attackMob(mob, clock.totalTicks);` line and add durability after the hurt sound. New inner block:

```ts
      if (mobDist <= blockDist) {
        const slot = player.hotbar.selected;
        const held = player.inventory.get(slot);
        const heldDef = held === null ? null : getItemDef(held.itemId);
        attackMob(mob, clock.totalTicks, attackDamageFor(heldDef));
        // Play hurt sound at mob position.
        gameAudio?.onMobHurt(mob.feet);
        // Swords/tools wear by one use on a successful hit (mirror break path).
        if (held !== null && isTool(held)) {
          player.inventory.set(slot, damageTool(held));
        }
        return; // this click hit a mob; skip the block break
      }
```

- [ ] Add `attackDamageFor` to the existing mob-driver import in `main.ts`. Current (line 51):

```ts
import { MobDriver, pickMob, attackMob } from "./game/mob-driver";
```

  Replace with:

```ts
import { MobDriver, pickMob, attackMob, attackDamageFor } from "./game/mob-driver";
```

  (`getItemDef`, `isTool`, `damageTool` are already imported — `getItemDef` from Task 2, `isTool`/`damageTool` from the existing stack import at line 39.)

- [ ] Verify: `corepack pnpm vitest run src/game/mob-driver.test.ts`
  Expected: the original `attackMob` test still passes (`full - PLAYER_ATTACK_DAMAGE`), plus the new `attackDamageFor` tests pass.
- [ ] Verify: `corepack pnpm typecheck`
  Expected: no errors.
- [ ] LIVE-QA (not unit-testable): holding an iron sword kills a zombie in fewer hits than fists; the sword loses durability per hit.
- [ ] Commit: `feat(combat): sword attackDamageFor + durability on hit (attackMob defaulted)`

---

### Task 7: Full-suite regression gate

**Files:** none (verification only).

Steps:

- [ ] Verify: `corepack pnpm test`
  Expected: all suites pass — notably the unchanged-by-contract tests: `edit.test.ts` (placeBlock/breakBlock), `items.test.ts` (registry invariants), `stats.test.ts` (eat + timers), `mob-driver.test.ts` (`attackMob` pins `PLAYER_ATTACK_DAMAGE = 4`), `inventory.test.ts`; plus the new `use-item.test.ts`, `mining.test.ts`, `default-inventory.test.ts`, and `attackDamageFor` tests.
- [ ] Verify: `corepack pnpm typecheck`
  Expected: no errors.
- [ ] Commit (if any test-only fixups were needed): `test: green Phase-2 interaction-core suite`

---

## Notes on testability

- **Unit-testable (no live QA):** `resolveUse` routing matrix (Task 1), `breakTicks` math (Task 4), starter-inventory contents (Task 3), `attackDamageFor` table + `attackMob` default (Task 6), and eat math (already covered in `stats.test.ts`).
- **Requires live QA (feel/glue only):** the *feel* of hold-to-mine and progress reset on look-away/release (Task 5), the right-click eat/place click experience (Task 2), the visible starter-tool sprites (Task 3), and sword-kills-faster + wears-down (Task 6). The underlying logic for all of these is exercised by the pure modules above; only the Babylon/event glue is QA-only.

## Out of scope (deferred to later phases, per spec §4.3/§4.4/§5)

Armor and the reduction math (`combat/armor.ts`), off-hand / equipment slots (`inventory/equipment.ts`), ranged/bow (`projectile/arrow.ts`, the charge-and-release that would need the new `mouseup` to grow a charge channel), potions / status effects (`effects/status.ts`), mob/player knockback and invulnerability frames (`combat/knockback.ts`), and axes-as-weapons.
