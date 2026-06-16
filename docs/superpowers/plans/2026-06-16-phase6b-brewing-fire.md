# Phase 6b — Brewing + Fire systems: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver three greenfield, pragmatic-v1 features on the merged Phase-1–5 + 6a base WITHOUT widening `SurvivalState` (its strict 7-field `toEqual` shape pin), WITHOUT renumbering any existing `Blocks`/`Items`/`EffectType`/`EFFECT_TYPE_IDS` id, WITHOUT changing `SMELTING.length` (8) or `ARROW.*`/`ARROW_CAP`, and WITHOUT inventing a mob status-effect system: (1) FIRE / LAVA DAMAGE-OVER-TIME — a `"fire"` `DamageSource` (skips armor like `"fall"`, fully NEGATED by `fire_resistance`) plus a transient `playerBurningTicks` channel in `main.ts` module scope (NOT a `SurvivalState`/`PhysicsState`/`Player` field) that ignites when the player's feet cell or the cell under their feet is `Blocks.LAVA` and applies fire damage on an interval. CRITICAL PREREQUISITE: `Blocks.LAVA` (id 24) is fully registered (block + registry `liquid()` def + atlas tile) but world-gen NEVER places it, so this phase ALSO adds DETERMINISTIC DEEP-CAVE LAVA GENERATION (`fillDeepLava` — pools LAVA into the floors of deep caves at `worldY <= 10`, run as the final column-pipeline stage after terrain→caves→ores) so the player actually encounters lava and the fire DOT has a real in-game trigger; the lava generator is unit-tested for determinism + surface integrity + deep-only placement, and the pure burning-tick reducer + the `fire_resistance` negation are unit-tested; (2) FUNCTIONAL BREWING — a new `Blocks.BREWING_STAND` interactive block (mirroring `CRAFTING_TABLE`), a `BrewingStand` tick-based state machine (mirroring `Furnace`: base-potion slot + ingredient slot + blaze-powder fuel measured in BREWS not ticks + `brewProgress` over `BREW.TICKS_PER_BREW`), a `BREWING` recipe table + `findBrewing(base, ingredient)` matcher, the new ingredient items (glass/water bottle, nether wart, blaze rod, blaze powder), and a DOM-guarded interactive `BrewingStandScreen` through which the player LOADS the base potion / ingredient / blaze-powder fuel and COLLECTS the brewed output using the same cursor-stack click-to-move model as `WorkbenchScreen` (left-click pick up / place whole stack, right-click place one). Brewing is PER-PLACED-STAND: a coords-keyed `BrewingStands` registry (a block-entity-style `Map<"x,y,z", BrewingStand>`) ticks every fixed tick, and its full contents PERSIST across save/reload as a world-level JSON blob added behind `SAVE_FORMAT`/`SAVE_VERSION` 6→7 + `MIGRATIONS[6]` (mirroring how the `mobs` blob was added). The recipe-match + brew-progress + the per-stand registry + the save round-trip are unit-tested; the block, the interactive screen, and the RMB/tick wiring are glue/LIVE-QA; (3) SPLASH potions + TIPPED arrows — a thrown `SplashPotion` entity/manager/physics cloned from the Arrow stack that BURSTS on block/mob hit and applies its effect in a radius (to the PLAYER if within `SPLASH.RADIUS`; plain DAMAGE to mobs since mobs have no effects channel), plus an optional `potionEffect` on `Arrow` for tipped arrows (instant effects damage mobs; non-instant effects apply to the player only). NON-INSTANT MOB STATUS EFFECTS and LINGERING potions are explicitly DEFERRED (see Out of scope).

**Architecture:** *Fire* lives entirely outside any strict-shape struct, and is made REACHABLE by a new world-gen stage. `Blocks.LAVA` already exists as a fully-registered liquid (id 24, registry `liquid()` def, `TILE.LAVA = 30`, palette tile, `liquid:true/solid:false`) but is NEVER generated (no `LAVA` refs in `terrain.ts`/`cave.ts`/`generate.ts`; absent from `ORE_TABLE`). So a NEW pure `fillDeepLava(column, seed)` in `src/world/lava.ts` runs as the FINAL stage of the column pipeline (terrain → caves → ores → lava in `generate.ts`): it converts cave-AIR cells at `worldY <= LAVA_LEVEL` (=10, deep near bedrock, far below sea level 64) that rest on a solid floor into `Blocks.LAVA`, gated by a seed-derived 3D-noise field so pools are sparse + seed-varying — modeling MC's deep lava lakes. It is PURE + seed-deterministic (no `Math.random`/`Date`), only ever turns AIR→LAVA (never stone/ore/water/surface), and only ever writes deep, so the `generate.ts` "voxel-identical for same coords+seed" determinism, the surface-integrity ("surface never broken / non-air at surface"), and the ore-presence invariants all stay green; `cave.ts`/`cave.test.ts` are untouched (that suite calls `carveCaves` directly, never the new stage). With lava now in the world, `DamageSource` gains `"fire"` in `src/combat/player-damage.ts`; `applyArmor = source !== "fall" && source !== "fire"` (fire skips armor + durability wear, exactly like fall), and a NEW early gate `if (source === "fire" && hasEffect(player.effects, "fire_resistance")) return;` fully negates fire damage when fire-resistance is active (separate from `resistanceFraction`, which only reads the `resistance` effect). A pure `nextBurningTicks(current, inLava, igniteTicks)` reducer in a NEW `src/combat/fire.ts` (plus `fireDamageDue(burningTicks, interval)`) encodes ignite/decay so the loop logic is testable without the engine; `main.ts` holds `let playerBurningTicks = 0` at module scope (mirroring how `knockbackX/Z` live OUTSIDE `PhysicsState`), samples `world.getBlock` at the feet cell and the cell below, and routes damage through `applyPlayerDamage(player, FIRE.DAMAGE, clock.totalTicks, "fire")` on the `FIRE.DAMAGE_INTERVAL` cadence; `playerBurningTicks` is TRANSIENT and NOT persisted (it is sub-second loop state, re-derived next time the player touches lava — persisting it would add risk for zero player-visible benefit), and is zeroed in `respawnPlayer()`. *Brewing* mirrors the furnace stack exactly but is FUNCTIONAL and PER-PLACED-STAND: `BREW = { TICKS_PER_BREW: 400, BREWS_PER_BLAZE_POWDER: 20 }` in `mc-1.20.ts`; a `BrewingStand` class in `src/crafting/brewing-stand.ts` with `base`/`ingredient`/`fuel`/`output` slots, `brewsRemaining` (decremented per COMPLETED brew, NOT per tick — unlike furnace burn ticks) and `brewProgress` (0..`TICKS_PER_BREW`), plus pure `toSave()`/`static fromSave()` round-trip helpers; a `BREWING` table + `findBrewing` in `src/crafting/brew-recipes.ts`; new ingredient item ids start at `NON_BLOCK_BASE + 69` (the next free offset after `POTION_FIRE_RESISTANCE = +68`); `Blocks.BREWING_STAND = 29` (next sequential after `BED = 28`) with `TILE.BREWING_STAND = 36`, `MAX_USED_TILE` 35→36, a palette entry at index 36, a `BLOCK_ITEM_NAMES` entry, and a `BLOCK_HARDNESS` entry. STATE OWNERSHIP is a coords-keyed block-entity registry — `BrewingStands` in `src/crafting/brewing-stands.ts` wraps a `Map<string, BrewingStand>` keyed by `"x,y,z"` (the furnace class is pure-but-unwired dead code in the live game, so there is no global-stand precedent to lean on; the per-coords registry is tractable because placed stands are SPARSE — a handful of blocks, not 65536 cells). It exposes `getOrCreate(x,y,z)`, `peek(x,y,z)`, `remove(x,y,z)`, `tickAll()`, `toSave()`, and `static fromSave()`. Each fixed tick `brewingStands.tickAll()` advances every stand. PERSISTENCE is ADDITIVE behind `SAVE_FORMAT`/`SAVE_VERSION` 6→7: a new optional `brewingStands?: BrewingStandSave[]` on `WorldSave` is written as a length-prefixed UTF-8 JSON blob trailing the `mobs` blob (container format ≥ 7), `MIGRATIONS[6]` seeds it `[]` for v6 saves, `buildWorldSave` snapshots `brewingStands.toSave()`, and `restoreFromSave` rehydrates via `BrewingStands.fromSave(save.brewingStands ?? [])` — EXACTLY mirroring how `mobs` was added in format 2. INTERACTION: a DOM-guarded interactive `BrewingStandScreen` (host-resolution + `hasDom()` + cursor-stack pattern from `WorkbenchScreen`) opened by an RMB-on-`BREWING_STAND` branch in `main.ts` (passing the target block coords so it binds that stand) and gated in `uiBlockingGameplay()`. The screen owns a `cursor` stack and uses the existing pure `applySlotClick`/`applyRightClick` helpers from `inventory-view.ts` to move stacks between the player inventory and the stand's four slots (left-click = pick up / place whole stack, right-click = place one; output is collect-only — left-click pulls the finished potion to the cursor, never deposits). The block persists via the existing terrain save; its IN-PROGRESS brew contents now persist via the new blob (only in-flight splash potions remain transient). *Splash/tipped* clones the Phase-5 Arrow stack into `src/potions/{entity,physics,manager}.ts` + `src/rendering/splash-renderer.ts`: a `SplashPotion` carries a `potionEffect`; `splashPotionStep` reuses the SAME gravity/drag/DDA shape but a block OR mob hit means BURST (set `burst=true`, despawn after applying AoE); on burst the main loop applies the effect to the player when within `SPLASH.RADIUS` and deals plain instant damage to mobs in range (mobs have NO `EffectState`). Tipped arrows add an OPTIONAL `potionEffect?` to `Arrow` (shape unchanged for existing tests) and a `tippedEffect` param to `ArrowManager.spawn`; the bow-fire scan accepts tipped-arrow ammo; on a mob hit, an instant effect adds bonus damage via `attackMob`, a non-instant effect is ignored for mobs (player-only, noted deferred). In-flight splash potions are TRANSIENT (not persisted); the brewing-stand block persists via the existing terrain save (its `Blocks.BREWING_STAND` id) AND its in-progress contents persist via the new `SAVE_VERSION` 7 `brewingStands` blob — brews survive save/reload (see Self-review).

**Tech Stack:** Babylon.js 8, TypeScript, Vite, Vitest

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `src/combat/player-damage.ts` | **Modify** (`DamageSource` L28; `applyArmor` L36; new negation gate before L43) | Add `"fire"` to the union; `applyArmor` excludes fire; full-negate when `fire_resistance` active. Import `hasEffect`. |
| `src/combat/player-damage.test.ts` | **Modify** (append; existing 6 cases untouched) | New: fire skips armor + durability; fire fully negated by `fire_resistance`; fire honours i-frames; melee still armored. |
| `src/combat/fire.ts` | **Create** | Pure `nextBurningTicks(current, inLava, igniteTicks)` + `fireDamageDue(burningTicks, interval)` reducers. |
| `src/combat/fire.test.ts` | **Create** | Unit tests for ignite/decay/damage cadence. |
| `src/world/lava.ts` | **Create** | Pure deterministic `fillDeepLava(column, seed)` — pools `Blocks.LAVA` into deep-cave floors (`worldY <= 10`, AIR-only, noise-gated). Makes the fire DOT reachable. |
| `src/world/lava.test.ts` | **Create** | Determinism (same coords+seed identical) + below-threshold + surface-integrity + AIR-only-replacement + sparsity + seed-variance tests. |
| `src/world/generate.ts` | **Modify** (`generateColumn` body; pipeline doc-comment) | Call `fillDeepLava` as the FINAL stage (terrain → caves → ores → lava); document the 4th stage. |
| `src/world/generate.test.ts` | **Modify** (append a `describe`) | New: deep lava is generated somewhere (`y <= 10`); lava NEVER appears at/above the surface (surface integrity holds with lava in the pipeline). |
| `src/rules/mc-1.20.ts` | **Modify** (`Blocks` L42; `BLOCK_HARDNESS` L239; new `FIRE`, `BREW` consts near `SMELT` L297) | Add `BREWING_STAND: 29`; hardness; `FIRE = {...}`; `BREW = {...}`. (`Blocks.LAVA` already exists — no change to the LAVA id/def.) |
| `src/rules/items.ts` | **Modify** (`Items` enum after L143; `BLOCK_ITEM_NAMES` after L261; `NON_BLOCK_DEFS` after L342) | Add `BREWING_STAND` name; add `GLASS_BOTTLE`/`WATER_BOTTLE`/`NETHER_WART`/`BLAZE_ROD`/`BLAZE_POWDER` ids + `material()` defs; add `SPLASH_*` + `TIPPED_ARROW` ids + defs. |
| `src/rules/block-registry.ts` | **Modify** (`TILE` L135; `DEFS` after L237; JSDoc table) | Add `TILE.BREWING_STAND = 36`; add `transparentSolid` DEF for `BREWING_STAND`. |
| `src/rendering/palette.ts` | **Modify** (`TILE_COLORS` L59) | Add `36: [0.34, 0.30, 0.26]` (stone-brown stand). |
| `src/rendering/atlas.ts` | **Modify** (`MAX_USED_TILE` L112) | 35 → 36. |
| `src/rendering/atlas.test.ts` | **Modify** (append) | Add a tile-36 reddish-brown-not-magenta regression. |
| `src/crafting/brewing-stand.ts` | **Create** | `BrewingStand` tick state machine (mirror `Furnace`) + `toSave()`/`static fromSave()` + `BrewingStandSave` shape. |
| `src/crafting/brewing-stand.test.ts` | **Create** | Brew-progress + fuel + output + save round-trip tests. |
| `src/crafting/brew-recipes.ts` | **Create** | `BrewRecipe`, `BREWING` table, `findBrewing(base, ingredient)`. |
| `src/crafting/brew-recipes.test.ts` | **Create** | `findBrewing` coverage. |
| `src/crafting/brewing-stands.ts` | **Create** | `BrewingStands` coords-keyed registry (`Map<"x,y,z", BrewingStand>`): `getOrCreate`/`peek`/`remove`/`tickAll`/`toSave`/`fromSave`. |
| `src/crafting/brewing-stands.test.ts` | **Create** | Registry get-or-create + key + tickAll + save/restore round-trip tests. |
| `src/ui/brewing-stand-screen.ts` | **Create** | Interactive DOM-guarded screen (mirror `WorkbenchScreen` cursor-stack model): load base/ingredient/fuel, collect output. |
| `src/save/serialize.ts` | **Modify** (`WorldSave` L71; `SAVE_FORMAT` L209; `serializeSave` mobs blob L573; `deserializeSave` mobs blob L610) | Add optional `brewingStands?: BrewingStandSave[]`; bump `SAVE_FORMAT` 6→7; write/read a length-prefixed JSON `brewingStands` blob trailing `mobs` (format ≥ 7). |
| `src/save/serialize.test.ts` | **Modify** (append; existing fixtures get `brewingStands` only where they assert it) | New: v7 round-trips a populated `brewingStands` blob; absent blob on a format-6 container decodes to `undefined`. |
| `src/save/migration.ts` | **Modify** (`SAVE_VERSION` L14; `MIGRATIONS` L35) | `SAVE_VERSION` 6→7; add `MIGRATIONS[6]` (v6→v7) seeding `brewingStands: []`. |
| `src/save/migration.test.ts` | **Modify** (`SAVE_VERSION` pin 6→7; chain length; `saveAt` fixture) | Update the `SAVE_VERSION === 7` pin + the full 1→7 migration-chain assertion + the `saveAt` fixture's expected fields. |
| `src/game/persistence.ts` | **Modify** (imports; `buildWorldSave` L93; `saveGame`/`restore` callers) | Snapshot `brewingStands.toSave()` into the save; thread the registry through `buildWorldSave`/`saveGame`. |
| `src/potions/entity.ts` | **Create** | `SplashPotion` entity + `launchSplashFrom` (clone Arrow). |
| `src/potions/physics.ts` | **Create** | `splashPotionStep` + `SplashHit` (clone arrowStep; hit ⇒ burst). |
| `src/potions/manager.ts` | **Create** | `SplashPotionManager` + `canThrowSplash` (clone ArrowManager). |
| `src/potions/entity.test.ts` | **Create** | Splash entity + launch tests. |
| `src/potions/physics.test.ts` | **Create** | `splashPotionStep` burst-on-hit + advance tests. |
| `src/potions/manager.test.ts` | **Create** | Manager pool + cap tests. |
| `src/potions/aoe.ts` | **Create** | Pure `withinRadius(center, point, radius)` + `splashTargets(...)` selection. |
| `src/potions/aoe.test.ts` | **Create** | Radius-selection tests. |
| `src/rendering/splash-renderer.ts` | **Create** | `SplashPotionRenderer` (colored sphere; clone ArrowRenderer). |
| `src/arrows/entity.ts` | **Modify** (`Arrow` fields after L30; constructor L32–40) | Add optional `potionEffect?` (shape stays back-compatible; `isDone` untouched). |
| `src/arrows/manager.ts` | **Modify** (`spawn` L24–29) | Add optional `tippedEffect?` param, stored on the new field. |
| `src/main.ts` | **Modify** (screens L470; `uiBlockingGameplay` L508; Escape chain L583; RMB L795; mousedown/mouseup throw; tick loop L1020/L1031/L1048; render sync L1114; `respawnPlayer` L935; `restoreFromSave` L430; `requestSave` L1169) | Wire `BrewingStands` registry + interactive screen + coords-bound RMB open; `brewingStands.tickAll()` each tick; rehydrate registry in `restoreFromSave`; thread registry into `saveGame`; fire DOT block; splash throw + step + AoE; splash renderer sync; zero `playerBurningTicks` on respawn. |

---

### Task 1: Fire `DamageSource` + `fire_resistance` negation (pure; tests FIRST)

Extend the damage chokepoint so a NEW `"fire"` source skips armor (like `"fall"`) and is FULLY NEGATED when `fire_resistance` is active. The default `"melee"` path stays byte-identical (the 6 pinned cases call with no 4th arg or `"fall"`). Pure logic; no engine.

**Files:**
- Modify: `src/combat/player-damage.ts`
- Modify: `src/combat/player-damage.test.ts` (append; the existing 6-case file stays byte-identical)

**Must-protect:**
- `player-damage.test.ts` 4 source-semantic pins (default melee uses armor; `fall` skips armor + durability; `fall` honours resistance; `fall` honours i-frames) + 2 knockback tests — `"fire"` must follow `fall`'s armor-skip WITHOUT touching the `fall` branch. The negation gate is keyed on `source === "fire"` only, so non-fire paths are unchanged.
- `mob-driver.test.ts` 5 melee pins + 2 resistance cases (via the re-export of `applyPlayerDamage`) — all call with no 4th arg → `"melee"` → byte-identical.
- `stats.test.ts` `damage(s,6)→14` — `damage()` is unchanged; fire routes THROUGH `applyPlayerDamage` → `damage()`, never writing health directly.
- `effects/status.ts` `tickEffects` — fire_resistance MUST remain inert per-tick (it is read at the `applyPlayerDamage` call site, not ticked). Do NOT add a per-tick action for it.
- The `source: DamageSource = "melee"` DEFAULT must be preserved so pre-existing call sites stay byte-identical.

Steps:

- [ ] **(CODE, UNIT)** Extend `DamageSource` + add the fire branches in `src/combat/player-damage.ts`. Before (L18–43):
  ```ts
  import type { Player } from "../player/controller";
  import { damage } from "../survival/stats";
  import { damageTool } from "../inventory/stack";
  import { armorReduction } from "./armor";
  import { isInvulnerable } from "./iframes";
  import { resistanceFraction } from "../effects/status";
  import { knockbackImpulse } from "./knockback";
  import { ARMOR_SLOTS } from "../inventory/equipment";

  /** Where a hit came from. Drives whether armor (and its wear) applies. */
  export type DamageSource = "melee" | "explosion" | "fall";

  export function applyPlayerDamage(
    player: Player,
    rawAmount: number,
    currentTick: number,
    source: DamageSource = "melee",
  ): void {
    const applyArmor = source !== "fall";
    const defense = player.equipment.totalDefense();
    const armored = applyArmor ? armorReduction(rawAmount, defense) : rawAmount;
    const fraction = resistanceFraction(player.effects);
    const effective =
      fraction > 0 ? Math.max(0, Math.round(armored * (1 - fraction))) : armored;
    if (effective <= 0) return; // fully absorbed — no health loss, no durability wear
    if (isInvulnerable(player.survival.lastDamageTick, currentTick)) return;
  ```
  After — add `hasEffect` to the status import, extend the union, exclude `"fire"` from armor, and full-negate fire under fire-resistance (BEFORE the i-frame check so the negation is unconditional):
  ```ts
  import type { Player } from "../player/controller";
  import { damage } from "../survival/stats";
  import { damageTool } from "../inventory/stack";
  import { armorReduction } from "./armor";
  import { isInvulnerable } from "./iframes";
  import { resistanceFraction, hasEffect } from "../effects/status";
  import { knockbackImpulse } from "./knockback";
  import { ARMOR_SLOTS } from "../inventory/equipment";

  /**
   * Where a hit came from. Drives whether armor (and its wear) applies.
   *  - "melee"/"explosion": armor reduces + wears.
   *  - "fall": skips armor + wear (MC-accurate), honours Resistance + i-frames.
   *  - "fire": skips armor + wear (like fall) AND is FULLY NEGATED when
   *    fire_resistance is active (separate from the `resistance` effect).
   */
  export type DamageSource = "melee" | "explosion" | "fall" | "fire";

  export function applyPlayerDamage(
    player: Player,
    rawAmount: number,
    currentTick: number,
    source: DamageSource = "melee",
  ): void {
    // Fire is fully negated (not merely reduced) when fire_resistance is active.
    // This is keyed on source === "fire" only, so all other sources are
    // unchanged. fire_resistance is a DIFFERENT effect than `resistance`
    // (resistanceFraction reads only the latter).
    if (source === "fire" && hasEffect(player.effects, "fire_resistance")) return;
    const applyArmor = source !== "fall" && source !== "fire";
    const defense = player.equipment.totalDefense();
    const armored = applyArmor ? armorReduction(rawAmount, defense) : rawAmount;
    const fraction = resistanceFraction(player.effects);
    const effective =
      fraction > 0 ? Math.max(0, Math.round(armored * (1 - fraction))) : armored;
    if (effective <= 0) return; // fully absorbed — no health loss, no durability wear
    if (isInvulnerable(player.survival.lastDamageTick, currentTick)) return;
  ```
  (The rest of the function — the `applyArmor` durability loop, `damage(...)`, `lastDamageTick` — is untouched. `hasEffect` is exported from `src/effects/status.ts` L99.)
- [ ] **(CODE, UNIT)** Append fire tests to `src/combat/player-damage.test.ts` (do NOT touch the existing 6 cases). Add a new `describe` at the end of the file:
  ```ts
  describe("applyPlayerDamage — fire source", () => {
    it("fire SKIPS armor: full damage reaches survival despite armor", () => {
      const player = new Player({ x: 0, y: 0, z: 0 });
      player.survival.health = 20;
      player.equipment.equip("chestplate", makeArmorStack(Items.IRON_CHESTPLATE));
      const startDur = player.equipment.get("chestplate")!.durability!;
      applyPlayerDamage(player, 2, 100, "fire");
      expect(player.survival.health).toBe(18); // no armor mitigation
      expect(player.equipment.get("chestplate")!.durability).toBe(startDur); // no wear
    });
    it("fire_resistance FULLY negates fire damage (not just reduces)", () => {
      const player = new Player({ x: 0, y: 0, z: 0 });
      player.survival.health = 20;
      applyEffect(player.effects, "fire_resistance", 0, 1000);
      applyPlayerDamage(player, 6, 100, "fire");
      expect(player.survival.health).toBe(20); // unchanged
    });
    it("fire_resistance does NOT negate melee damage", () => {
      const player = new Player({ x: 0, y: 0, z: 0 });
      player.survival.health = 20;
      applyEffect(player.effects, "fire_resistance", 0, 1000);
      applyPlayerDamage(player, 6, 100); // melee — armored to 6 (no armor) → 14
      expect(player.survival.health).toBe(14);
    });
    it("fire honours i-frames (a second hit in the window is ignored)", () => {
      const player = new Player({ x: 0, y: 0, z: 0 });
      player.survival.health = 20;
      applyPlayerDamage(player, 2, 100, "fire");
      expect(player.survival.health).toBe(18);
      applyPlayerDamage(player, 2, 101, "fire"); // within window → ignored
      expect(player.survival.health).toBe(18);
    });
  });
  ```
  (`Player`, `applyPlayerDamage`, `applyEffect`, `makeArmorStack`, `Items` are already imported at the top of the file from Task 4 of Phase 6a — `import { applyEffect } from "../effects/status"`, `import { makeArmorStack } from "../inventory/stack"`, `import { Items } from "../rules/items"`.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/combat/player-damage.test.ts src/game/mob-driver.test.ts src/survival/stats.test.ts src/effects/status.test.ts` → all green (the 6 existing cases + 4 fire cases; the 5 melee + 2 resistance mob-driver pins unchanged).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(combat): fire DamageSource negated by fire_resistance (skips armor)`

---

### Task 2: Pure burning-tick reducer (`src/combat/fire.ts`) (+ tests)

Encode the ignite/decay/damage cadence as two pure functions so the `main.ts` loop logic is unit-testable without the engine. NO `main.ts` change yet (that is Task 4, after deep-cave lava generation in Task 3 makes lava reachable).

**Files:**
- Create: `src/combat/fire.ts`, `src/combat/fire.test.ts`
- Modify: `src/rules/mc-1.20.ts` (add the `FIRE` constants near `SMELT`, L297)

**Must-protect:**
- mc-1.20 G4 guardrail: all fire numeric constants live in a `FIRE` const in `mc-1.20.ts`, never hardcoded in `fire.ts` or `main.ts`.
- `FIRE.DAMAGE_INTERVAL >= 10` so the per-interval fire hit is NOT eaten by the 10-tick i-frame window (recon gotcha): use 10 ticks (1 HP-pair every 10 ticks ≈ matches MC's ~2 HP/s lava rate at `DAMAGE = 1`).

Steps:

- [ ] **(CODE)** Add the `FIRE` constants to `src/rules/mc-1.20.ts`, immediately after the `SMELT` block (L295–297). Before:
  ```ts
  export const SMELT = {
    TICKS_PER_ITEM: 200,
  } as const;
  ```
  After:
  ```ts
  export const SMELT = {
    TICKS_PER_ITEM: 200,
  } as const;

  // ---------------------------------------------------------------------------
  // Fire / lava damage-over-time (Phase 6b)
  // ---------------------------------------------------------------------------

  /** Lava/fire burning damage-over-time tuning (20 TPS). */
  export const FIRE = {
    /** Ticks of burning set/refreshed each tick the player is in/on lava. */
    IGNITE_TICKS: 30,
    /** Half-hearts dealt per fire-damage interval. */
    DAMAGE: 1,
    /**
     * Ticks between fire-damage applications. MUST be >= the 10-tick i-frame
     * window (combat/iframes) or the periodic fire hit is swallowed by i-frames.
     * 10 → 1 dmg every 10 ticks ≈ 2 HP/s, matching MC lava.
     */
    DAMAGE_INTERVAL: 10,
  } as const;
  ```
- [ ] **(CODE, UNIT)** Create `src/combat/fire.ts`:
  ```ts
  /**
   * fire.ts — PURE burning-timer reducers for lava/fire damage-over-time
   * (Phase 6b).
   *
   * The burning timer is TRANSIENT loop state (it lives in main.ts module scope,
   * NOT on Player / SurvivalState / PhysicsState — mirroring how the knockback
   * channel sits outside PhysicsState). These reducers keep the ignite/decay and
   * the damage cadence testable without the engine. The fire_resistance NEGATION
   * is enforced at the applyPlayerDamage("fire") call site (Task 1), NOT here —
   * these functions describe the timer only.
   */

  /**
   * Advance the burning timer one tick.
   *  - If `inLava`, the timer is REFRESHED to at least `igniteTicks` (standing in
   *    lava keeps you alight; leaving lets it count down).
   *  - Otherwise it decays by one tick, floored at 0.
   *
   * Refresh-then-decay-net: when inLava we return `igniteTicks` (the max of the
   * refreshed value and the current value, so a longer existing burn is kept).
   */
  export function nextBurningTicks(
    current: number,
    inLava: boolean,
    igniteTicks: number,
  ): number {
    if (inLava) return Math.max(current, igniteTicks);
    return current > 0 ? current - 1 : 0;
  }

  /**
   * Whether a fire-damage application is due THIS tick, given the burning timer
   * value (BEFORE this tick's decrement) and the damage interval. Fires on every
   * `interval`-th tick of remaining burn. With IGNITE_TICKS=30, INTERVAL=10 a
   * single dip in lava yields hits at burningTicks 30, 20, 10 → 3 applications.
   */
  export function fireDamageDue(burningTicks: number, interval: number): boolean {
    if (burningTicks <= 0) return false;
    return burningTicks % interval === 0;
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/combat/fire.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { nextBurningTicks, fireDamageDue } from "./fire";
  import { FIRE } from "../rules/mc-1.20";

  describe("nextBurningTicks", () => {
    it("ignites to IGNITE_TICKS when in lava from cold", () => {
      expect(nextBurningTicks(0, true, FIRE.IGNITE_TICKS)).toBe(FIRE.IGNITE_TICKS);
    });
    it("refreshes (keeps the larger of current vs ignite) while in lava", () => {
      expect(nextBurningTicks(50, true, FIRE.IGNITE_TICKS)).toBe(50);
      expect(nextBurningTicks(5, true, FIRE.IGNITE_TICKS)).toBe(FIRE.IGNITE_TICKS);
    });
    it("decays by one per tick once out of lava, floored at 0", () => {
      expect(nextBurningTicks(2, false, FIRE.IGNITE_TICKS)).toBe(1);
      expect(nextBurningTicks(1, false, FIRE.IGNITE_TICKS)).toBe(0);
      expect(nextBurningTicks(0, false, FIRE.IGNITE_TICKS)).toBe(0);
    });
  });

  describe("fireDamageDue", () => {
    it("never due when not burning", () => {
      expect(fireDamageDue(0, FIRE.DAMAGE_INTERVAL)).toBe(false);
    });
    it("due exactly on interval boundaries", () => {
      expect(fireDamageDue(30, FIRE.DAMAGE_INTERVAL)).toBe(true);
      expect(fireDamageDue(20, FIRE.DAMAGE_INTERVAL)).toBe(true);
      expect(fireDamageDue(10, FIRE.DAMAGE_INTERVAL)).toBe(true);
    });
    it("not due off-boundary", () => {
      expect(fireDamageDue(25, FIRE.DAMAGE_INTERVAL)).toBe(false);
      expect(fireDamageDue(1, FIRE.DAMAGE_INTERVAL)).toBe(false);
    });
    it("interval >= i-frame window so hits are not swallowed", () => {
      expect(FIRE.DAMAGE_INTERVAL).toBeGreaterThanOrEqual(10);
    });
  });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/combat/fire.test.ts` → all green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(combat): pure burning-tick reducers + FIRE tuning constants`

---

### Task 3: Deep-cave lava generation (deterministic; tests FIRST)

`Blocks.LAVA` (id 24) is a fully-registered liquid (registry `liquid()` def, `TILE.LAVA = 30`, palette tile, classified `liquid:true/solid:false`) — but world generation NEVER places it (zero `LAVA` refs in `terrain.ts`/`cave.ts`/`generate.ts`; not in `ORE_TABLE`). So the fire DOT (Task 4) currently has NO in-game trigger. This task adds a NEW deterministic generation stage that pools LAVA into the floors of DEEP caves, so the player actually encounters lava and fire becomes reachable. It runs LAST in the column pipeline (terrain → caves → ores → **lava**), filling only existing cave-AIR cells at-or-below a deep y-threshold that sit on a solid floor — exactly like Minecraft's deep lava lakes. It never creates air, never touches the surface, and never replaces stone/ore/water, so the surface-integrity + ore-presence + determinism invariants stay green.

**Files:**
- Create: `src/world/lava.ts` — pure deterministic `fillDeepLava(column, seed)` (mirrors `cave.ts`/`ore.ts` structure).
- Create: `src/world/lava.test.ts` — determinism + below-threshold + surface-integrity + sparsity + seed-variance + air-only-replacement tests.
- Modify: `src/world/generate.ts` — call `fillDeepLava` as the final stage; update the pipeline doc-comment.
- Modify: `src/world/generate.test.ts` (append) — assert deep lava is generated somewhere AND never appears at/above the surface (surface integrity holds with lava in the pipeline).

**Must-protect:**
- `cave.test.ts` (determinism / surface-integrity / bedrock-safety / "carves some underground air but well under half") — UNTOUCHED: those call `carveCaves` directly, so the NEW lava stage (a separate function in `generate.ts`) never runs in that suite. Do NOT edit `cave.ts` or its test.
- `generate.test.ts` "voxel-identical for same coords+seed" — `fillDeepLava` is PURE + seed-deterministic (reads only the already-deterministic column + a seed-derived noise gate; no `Math.random`/`Date`), so two generations remain identical. This invariant is the determinism guarantee.
- `generate.test.ts` "surface … never broken (left as air) by caves" + the `surfaceHeight(...)` / "block at the surface is non-air" checks — lava only ever turns AIR→LAVA at `worldY <= LAVA_LEVEL` (deep, far below any surface), NEVER creates air and NEVER touches the surface column, so `surfaceHeight` is unchanged and the surface block stays solid.
- `generate.test.ts` ore-presence (`oreCount > 0`) — lava replaces ONLY `Blocks.AIR`; ore replaces ONLY `Blocks.STONE`. The two are disjoint, and lava runs AFTER ore, so no ore is ever overwritten and the ore count is preserved.
- `terrain.test.ts` WATER tests — `fillDeepLava` never touches `WATER` (it converts only AIR), and runs in `generate.ts` (not `generateTerrain`), so the terrain suite is untouched.
- NO existing determinism test pins an EXACT golden voxel snapshot (they compare two generations against each other), so adding deep lava requires NO intentional design-lock test update. (If a future golden-snapshot test existed it would need a deliberate update; none does here.)
- mc-1.20 G4 guardrail: the lava-depth constant lives in a named `const LAVA_LEVEL` (and `LAVA_FILL_THRESHOLD`) in `lava.ts`, documented; not a bare magic number scattered around.

Steps:

- [ ] **(CODE, UNIT)** Create `src/world/lava.ts`:
  ```ts
  /**
   * lava.ts — deterministic deep-cave lava pooler for world columns (Phase 6b).
   *
   * `fillDeepLava` runs LAST in the column pipeline (terrain -> caves -> ores ->
   * lava). It walks every voxel, and wherever a CAVE-AIR cell sits at-or-below a
   * deep y-threshold (LAVA_LEVEL, near bedrock) ON TOP OF a solid floor, it fills
   * that cell with LAVA — pooling lava into the floors of deep caves, exactly like
   * Minecraft's deep lava lakes. A seed-derived 3D-noise gate keeps the pools
   * SPARSE and seed-varying rather than flooding every deep cave.
   *
   * Why this keeps the generation invariants green:
   *  - It only ever turns AIR -> LAVA: it never creates air, never replaces stone
   *    / ore / water / surface. (Ore runs first and only replaces STONE; the two
   *    are disjoint, so no ore is overwritten.)
   *  - It only ever writes at worldY <= LAVA_LEVEL (deep, far below any surface),
   *    so the surface block + surfaceHeight are untouched (surface integrity).
   *  - It is a PURE function of (column, seed) with no Math.random / Date, so the
   *    "voxel-identical for same coords+seed" determinism invariant holds.
   *
   * Pure: no Babylon imports, no Math.random, no Date. Deterministic.
   */

  import { Blocks } from "../rules/mc-1.20";
  import type { ChunkColumn } from "../chunk/column";
  import { makeNoise3D, fbm3d } from "./noise";

  /** Horizontal column extent (blocks) along x and z. */
  const SIZE = 16;

  /**
   * Deepest layer is bedrock at y=0 (never carved, never lava). Lava pools only
   * in the band [1, LAVA_LEVEL] — well below sea level (64) and any surface, so
   * the player must dig/explore deep caves to reach it (and fire becomes real).
   */
  const LAVA_LEVEL = 10;

  /**
   * Seed-derived noise gate. A deep cave-air-on-floor cell is filled only where
   * the absolute fBm value exceeds this, so only a FRACTION of deep cave floors
   * pool lava (sparse pools, not a flooded layer). Higher = rarer.
   */
  const LAVA_FILL_THRESHOLD = 0.35;

  /** Horizontal sampling frequency (cells per block) of the lava-gate noise. */
  const FREQ = 1 / 20;
  /** fBm octaves for the lava gate (a smooth, low-detail field is enough). */
  const OCTAVES = 2;

  /** Offset the lava-gate seed away from the cave-carver seed field. */
  const LAVA_SEED_OFFSET = 0x9e3779b1;

  /**
   * Pool LAVA into the floors of deep caves in `column`, in place.
   *
   * For each voxel at (lx, worldY, lz) with 1 <= worldY <= LAVA_LEVEL that is
   * currently AIR and rests on a NON-AIR floor (the cell directly below is not
   * air), the absolute fBm gate is sampled at the absolute world coordinate; when
   * it exceeds {@link LAVA_FILL_THRESHOLD} the cell becomes LAVA. Run AFTER caves
   * and ores so it fills the FINAL cave-air without disturbing either.
   */
  export function fillDeepLava(column: ChunkColumn, seed: number): void {
    const noise = makeNoise3D((seed ^ LAVA_SEED_OFFSET) >>> 0);
    const baseX = column.columnX * SIZE;
    const baseZ = column.columnZ * SIZE;

    for (let lz = 0; lz < SIZE; lz++) {
      for (let lx = 0; lx < SIZE; lx++) {
        const worldX = baseX + lx;
        const worldZ = baseZ + lz;

        // Only the deep band [1, LAVA_LEVEL]; y=0 is bedrock (never touched).
        for (let worldY = 1; worldY <= LAVA_LEVEL; worldY++) {
          // Convert ONLY cave-air cells (never stone/ore/water/surface).
          if (column.getBlock(lx, worldY, lz) !== Blocks.AIR) continue;
          // Must rest on a solid floor: no floating lava, only pools.
          if (column.getBlock(lx, worldY - 1, lz) === Blocks.AIR) continue;

          const n = fbm3d(
            noise,
            worldX * FREQ,
            worldY * FREQ,
            worldZ * FREQ,
            OCTAVES,
          );
          if (Math.abs(n) > LAVA_FILL_THRESHOLD) {
            column.setBlock(lx, worldY, lz, Blocks.LAVA);
          }
        }
      }
    }
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/world/lava.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { Blocks } from "../rules/mc-1.20";
  import { ChunkColumn } from "../chunk/column";
  import { fillDeepLava } from "./lava";

  const SEED = 4242;
  const WORLD_HEIGHT = 256;
  const SIZE = 16;
  /** Mirror of lava.ts LAVA_LEVEL (the deep-fill ceiling). */
  const LAVA_LEVEL = 10;

  /**
   * A deep-cave-like column: solid STONE [0, surfaceY], then a hollow AIR pocket
   * carved into the deep band so fillDeepLava has cave-air-on-floor to pool into.
   * y=0 stays bedrock-like stone (never AIR), and the floor below the pocket is
   * solid so the floor check passes.
   */
  function makeDeepCaveColumn(columnX: number, columnZ: number): ChunkColumn {
    const col = new ChunkColumn(columnX, columnZ);
    const surfaceY = 120;
    for (let lz = 0; lz < SIZE; lz++) {
      for (let lx = 0; lx < SIZE; lx++) {
        for (let y = 0; y <= surfaceY; y++) col.setBlock(lx, y, lz, Blocks.STONE);
        // Carve a 1-block-tall AIR pocket at y=5 on a solid floor (y=4 stays stone).
        col.setBlock(lx, 5, lz, Blocks.AIR);
        // Grass surface marker so we can assert it is never altered.
        col.setBlock(lx, surfaceY, lz, Blocks.GRASS);
      }
    }
    return col;
  }

  function snapshot(col: ChunkColumn): number[] {
    const out: number[] = [];
    for (let lz = 0; lz < SIZE; lz++) {
      for (let lx = 0; lx < SIZE; lx++) {
        for (let y = 0; y < WORLD_HEIGHT; y++) out.push(col.getBlock(lx, y, lz));
      }
    }
    return out;
  }

  describe("fillDeepLava determinism", () => {
    it("produces identical voxels for identical input and seed", () => {
      const a = makeDeepCaveColumn(0, 0);
      const b = makeDeepCaveColumn(0, 0);
      fillDeepLava(a, SEED);
      fillDeepLava(b, SEED);
      expect(snapshot(a)).toEqual(snapshot(b));
    });

    it("differs across seeds (lava placement is seed-dependent)", () => {
      const snapAll = (seed: number): number[] => {
        const out: number[] = [];
        for (let c = 0; c < 16; c++) {
          const col = makeDeepCaveColumn(c * 4 - 20, c * 7 - 30);
          fillDeepLava(col, seed);
          out.push(...snapshot(col));
        }
        return out;
      };
      expect(snapAll(SEED)).not.toEqual(snapAll(SEED + 1));
    });
  });

  describe("fillDeepLava depth + surface integrity", () => {
    it("never places LAVA above LAVA_LEVEL", () => {
      const col = makeDeepCaveColumn(3, -2);
      fillDeepLava(col, SEED);
      for (let lz = 0; lz < SIZE; lz++) {
        for (let lx = 0; lx < SIZE; lx++) {
          for (let y = LAVA_LEVEL + 1; y < WORLD_HEIGHT; y++) {
            expect(col.getBlock(lx, y, lz)).not.toBe(Blocks.LAVA);
          }
        }
      }
    });

    it("never alters the surface block or introduces air", () => {
      const surfaceY = 120;
      const col = makeDeepCaveColumn(3, -2);
      const before = snapshot(col);
      fillDeepLava(col, SEED);
      for (let lz = 0; lz < SIZE; lz++) {
        for (let lx = 0; lx < SIZE; lx++) {
          expect(col.surfaceHeight(lx, lz)).toBe(surfaceY);
          expect(col.getBlock(lx, surfaceY, lz)).toBe(Blocks.GRASS);
          // No cell at/above the surface changed.
          for (let y = surfaceY; y < WORLD_HEIGHT; y++) {
            const idx = (lx + lz * SIZE) * WORLD_HEIGHT + y;
            expect(col.getBlock(lx, y, lz)).toBe(before[idx]);
          }
        }
      }
    });

    it("never replaces non-air blocks (only AIR -> LAVA)", () => {
      const col = makeDeepCaveColumn(7, 7);
      const before = snapshot(col);
      fillDeepLava(col, SEED);
      let lavaCount = 0;
      for (let lz = 0; lz < SIZE; lz++) {
        for (let lx = 0; lx < SIZE; lx++) {
          for (let y = 0; y < WORLD_HEIGHT; y++) {
            const idx = (lx + lz * SIZE) * WORLD_HEIGHT + y;
            const after = col.getBlock(lx, y, lz);
            if (after === Blocks.LAVA && before[idx] !== Blocks.LAVA) {
              // Every newly-placed lava cell was AIR before.
              expect(before[idx]).toBe(Blocks.AIR);
              lavaCount++;
            } else {
              // Every non-newly-lava cell is byte-identical.
              expect(after).toBe(before[idx]);
            }
          }
        }
      }
      // y=0 bedrock-like stone is never AIR, so it is never lava.
      for (let lz = 0; lz < SIZE; lz++) {
        for (let lx = 0; lx < SIZE; lx++) {
          expect(col.getBlock(lx, 0, lz)).not.toBe(Blocks.LAVA);
        }
      }
      expect(lavaCount).toBeGreaterThanOrEqual(0); // may be 0 for an unlucky column
    });
  });

  describe("fillDeepLava actually pools lava", () => {
    it("places SOME lava across many deep-cave columns", () => {
      let lava = 0;
      for (let c = 0; c < 30; c++) {
        const col = makeDeepCaveColumn(c * 5 - 35, c * 3 - 20);
        fillDeepLava(col, SEED);
        for (let lz = 0; lz < SIZE; lz++) {
          for (let lx = 0; lx < SIZE; lx++) {
            for (let y = 1; y <= LAVA_LEVEL; y++) {
              if (col.getBlock(lx, y, lz) === Blocks.LAVA) lava++;
            }
          }
        }
      }
      expect(lava).toBeGreaterThan(0);
    });
  });
  ```
- [ ] **(CODE)** Wire `fillDeepLava` as the FINAL stage in `src/world/generate.ts`. Before:
  ```ts
  import { ChunkColumn } from "../chunk/column";
  import { generateTerrain } from "./terrain";
  import { carveCaves } from "./cave";
  import { generateOres } from "./ore";
  import { computeColumnSkylight, type LightMap } from "./lighting";
  ```
  After (add the lava import):
  ```ts
  import { ChunkColumn } from "../chunk/column";
  import { generateTerrain } from "./terrain";
  import { carveCaves } from "./cave";
  import { generateOres } from "./ore";
  import { fillDeepLava } from "./lava";
  import { computeColumnSkylight, type LightMap } from "./lighting";
  ```
  Before:
  ```ts
  export function generateColumn(columnX: number, columnZ: number, seed: number): ChunkColumn {
    const column = new ChunkColumn(columnX, columnZ);
    generateTerrain(column, seed);
    carveCaves(column, seed);
    generateOres(column, seed);
    return column;
  }
  ```
  After (lava is the final stage — fills the cave-air left by carving without disturbing ore, which only replaces stone):
  ```ts
  export function generateColumn(columnX: number, columnZ: number, seed: number): ChunkColumn {
    const column = new ChunkColumn(columnX, columnZ);
    generateTerrain(column, seed);
    carveCaves(column, seed);
    generateOres(column, seed);
    fillDeepLava(column, seed);
    return column;
  }
  ```
  Also update the file-header pipeline doc-comment to add the 4th stage. Before:
  ```ts
   *   3. generateOres    — scatter ore veins into the REMAINING stone. Runs last
   *      so veins fill stone that survived carving (and never float in cave air).
   *
   * Output depends only on (columnX, columnZ, seed): identical inputs => identical
   * voxels. Pure: no Babylon imports, no Math.random, no Date.
   ```
  After:
  ```ts
   *   3. generateOres    — scatter ore veins into the REMAINING stone. Runs before
   *      lava so veins fill stone that survived carving (and never float in cave
   *      air); ore replaces only STONE, lava only AIR, so the two never collide.
   *   4. fillDeepLava    — pool LAVA into the floors of DEEP caves (worldY near
   *      bedrock). Runs last so it fills the FINAL cave-air; it only converts AIR
   *      and only deep, so surface integrity + ore presence are preserved. This
   *      is what makes lava (and the fire DOT) reachable in-game.
   *
   * Output depends only on (columnX, columnZ, seed): identical inputs => identical
   * voxels. Pure: no Babylon imports, no Math.random, no Date.
   ```
- [ ] **(CODE, UNIT)** Append two assertions to `src/world/generate.test.ts` (new `describe` at the end) proving lava is generated AND surface integrity still holds with lava in the pipeline:
  ```ts
  describe("generateColumn deep lava", () => {
    it("generates SOME lava (below y=11) across ~30 columns", () => {
      let lava = 0;
      let n = 0;
      for (let cx = 0; cx < 6 && n < 30; cx++) {
        for (let cz = 0; cz < 5 && n < 30; cz++) {
          const col = generateColumn(cx * 7 - 13, cz * 9 + 4, SEED);
          n++;
          for (let lx = 0; lx < SIZE; lx++) {
            for (let lz = 0; lz < SIZE; lz++) {
              for (let y = 1; y <= 10; y++) {
                if (col.getBlock(lx, y, lz) === Blocks.LAVA) lava++;
              }
            }
          }
        }
      }
      expect(n).toBe(30);
      expect(lava).toBeGreaterThan(0);
    });

    it("never places lava at or above the surface (surface integrity)", () => {
      for (const [cx, cz] of [
        [2, 2],
        [7, 11],
        [-5, 3],
      ] as const) {
        const col = generateColumn(cx, cz, SEED);
        for (let lx = 0; lx < SIZE; lx++) {
          for (let lz = 0; lz < SIZE; lz++) {
            const h = col.surfaceHeight(lx, lz);
            expect(col.getBlock(lx, h, lz)).not.toBe(Blocks.LAVA);
            for (let y = h; y < HEIGHT; y++) {
              expect(col.getBlock(lx, y, lz)).not.toBe(Blocks.LAVA);
            }
            // Lava only ever appears deep (y <= 10).
            for (let y = 11; y < HEIGHT; y++) {
              expect(col.getBlock(lx, y, lz)).not.toBe(Blocks.LAVA);
            }
          }
        }
      }
    });
  });
  ```
  (`SEED`, `SIZE`, `HEIGHT`, `Blocks`, `generateColumn` are already imported at the top of `generate.test.ts`.)
  (TUNING NOTE: the "generates SOME lava across ~30 columns" assertion depends on real carved caves reaching `y <= 10` with `abs(noise) > LAVA_FILL_THRESHOLD`. Caves are SPARSE (carve `THRESHOLD = 0.62`), so if this assertion comes up empty for the chosen `SEED`/columns, FIRST widen the column sweep (more/varied coords — the off-origin Perlin lattice varies more than the origin) and only THEN lower `LAVA_FILL_THRESHOLD` in `lava.ts` — keeping it ABOVE 0 so lava stays a sparse pool, not a flooded layer. The `lava.test.ts` "places SOME lava" test is robust regardless: it uses a hand-carved `makeDeepCaveColumn` with guaranteed deep AIR-on-floor pockets, so it does not depend on real cave geometry.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/world/lava.test.ts src/world/generate.test.ts src/world/cave.test.ts src/world/terrain.test.ts` → all green (new lava determinism/depth/surface/sparsity tests + the existing cave/generate/terrain determinism + surface-integrity + ore-presence invariants).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(world): deterministic deep-cave lava pools (makes fire reachable)`

---

### Task 4: Wire fire DOT into the fixed-tick loop (LIVE-QA glue)

Add the transient `playerBurningTicks` channel at `main.ts` module scope, sample `Blocks.LAVA` (now GENERATED in deep caves by Task 3) at the feet cell and the cell below each tick, advance the timer with `nextBurningTicks`, and apply `applyPlayerDamage(player, FIRE.DAMAGE, clock.totalTicks, "fire")` when `fireDamageDue`. Insert AFTER `tickEffects` and BEFORE the `isDead` gate so fire can be lethal on the same tick. Zero the channel on respawn.

**Files:**
- Modify: `src/main.ts` (module-scope decl near other loop state; the tick block after `tickEffects` ~L1031; `respawnPlayer` ~L935; imports)

**Must-protect:**
- NO new field on `SurvivalState` / `PhysicsState` / `Player` — `playerBurningTicks` is a `main.ts` module-level `let` (mirrors how the knockback channel sits outside `PhysicsState`). `stats.test.ts`'s strict `makeSurvivalState` `toEqual` must stay green.
- The lava-detection samples `Blocks.LAVA` (id 24), which is now GENERATED by Task 3's `fillDeepLava` (deep-cave pools at `worldY <= 10`). Before Task 3 this id existed but was never placed, so the DOT was dead; Task 3 must land FIRST (it does — pipeline order is enforced by the task numbering) or this glue has no in-game trigger. Do NOT re-classify lava or hardcode its id — read it from `Blocks.LAVA`.
- Lava is NON-SOLID (`liquid:true, solid:false`): the player passes through it, so sample BOTH the feet cell (`Math.floor(player.feet.y)` — swimming in lava) AND the cell below (`Math.floor(player.feet.y) - 1` — standing on the lava surface), exactly like the footstep underfoot sample at L1087–1090.
- Fire damage routes through `applyPlayerDamage("fire")` — never a direct `survival.health` write — so the fire_resistance negation (Task 1) and i-frames stay in one place.
- The insertion is AFTER `tickEffects(...)` (L1031) and BEFORE the `isDead` check (L1053); `clock.totalTicks` here is the post-`advance` `currentTick` already in scope at L1023.
- No existing test imports `main.ts`; this is LIVE-QA (the timer + negation logic was unit-proven in Tasks 1–2).

Steps:

- [ ] **(CODE, LIVE-QA)** Add the imports to `src/main.ts`. Next to the existing `applyPlayerDamage` import (added in Phase 6a) add the fire reducer + constants. Find the existing `import { applyPlayerDamage } from "./combat/player-damage";` (or the combat import block) and add:
  ```ts
  import { nextBurningTicks, fireDamageDue } from "./combat/fire";
  import { FIRE } from "./rules/mc-1.20";
  ```
  (If `applyPlayerDamage` is NOT already imported into main.ts, also add `import { applyPlayerDamage } from "./combat/player-damage";`. Grep first: `applyPlayerDamage` — Phase 6a routed it through the controller, so main.ts may not import it directly; the fire DOT needs it. `FIRE` may need to merge into an existing `./rules/mc-1.20` import — keep one import line per module.)
- [ ] **(CODE, LIVE-QA)** Declare the transient channel at module scope, near the other loop-state `let`s (e.g. near `let bowChargeStartMs` ~L217 or `let accumulator` ~L930):
  ```ts
  /**
   * Transient burning timer (ticks of remaining lava/fire burn). Module scope —
   * NOT on Player/SurvivalState/PhysicsState (mirrors the knockback channel
   * living outside PhysicsState). Not persisted: it is sub-second loop state,
   * re-derived the next time the player touches lava.
   */
  let playerBurningTicks = 0;
  ```
- [ ] **(CODE, LIVE-QA)** Insert the fire-DOT block after `tickEffects(...)` and before the arrow loop / `isDead` gate. Before (L1031–1033):
  ```ts
      tickEffects(player.effects, player.survival, currentTick);

      // Step in-flight arrows: sweep vs blocks + mobs, apply damage, recycle.
      const liveMobs = mobDriver.manager.all();
  ```
  After:
  ```ts
      tickEffects(player.effects, player.survival, currentTick);

      // Fire / lava damage-over-time. Lava is non-solid, so sample BOTH the
      // feet cell (swimming IN lava) and the cell below (standing ON the lava
      // surface) — same underfoot pattern as footsteps. Route through the "fire"
      // damage source so fire_resistance fully negates it and i-frames apply.
      {
        const fx = Math.floor(player.feet.x);
        const fy = Math.floor(player.feet.y);
        const fz = Math.floor(player.feet.z);
        const inLava =
          world.getBlock(fx, fy, fz) === Blocks.LAVA ||
          world.getBlock(fx, fy - 1, fz) === Blocks.LAVA;
        playerBurningTicks = nextBurningTicks(
          playerBurningTicks,
          inLava,
          FIRE.IGNITE_TICKS,
        );
        if (fireDamageDue(playerBurningTicks, FIRE.DAMAGE_INTERVAL)) {
          applyPlayerDamage(player, FIRE.DAMAGE, currentTick, "fire");
        }
      }

      // Step in-flight arrows: sweep vs blocks + mobs, apply damage, recycle.
      const liveMobs = mobDriver.manager.all();
  ```
  (`Blocks` and `world` are already in scope in main.ts; `currentTick` is the post-advance value at L1023.)
- [ ] **(CODE, LIVE-QA)** Zero the channel in `respawnPlayer()` in `src/main.ts`. Before (L934–941):
  ```ts
  function respawnPlayer(): void {
    player.respawn(spawnPoint);
    deathState.hide();
    hideDeath();
    // Drop any accumulated frame time so play resumes cleanly (no tick storm).
    accumulator = 0;
    lastTime = performance.now();
  }
  ```
  After:
  ```ts
  function respawnPlayer(): void {
    player.respawn(spawnPoint);
    playerBurningTicks = 0; // clear any in-progress burn on death/respawn
    deathState.hide();
    hideDeath();
    // Drop any accumulated frame time so play resumes cleanly (no tick storm).
    accumulator = 0;
    lastTime = performance.now();
  }
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/survival src/combat` → green (SurvivalState shape unchanged; fire reducers + damage pins pass).
- [ ] **(LIVE-QA)** Run the app: dig/explore down into a deep cave near bedrock (y ≤ 10) until you find a GENERATED lava pool (Task 3), then step into it → health drops ~2 HP/s and keeps ticking for ~1.5 s after stepping out, then stops. Drink Potion of Fire Resistance, step into lava → NO damage. Die in lava → respawn with no residual burn. (For faster QA, fly/teleport to y ≤ 10 to reach lava quickly.) Manual.
- [ ] **Commit:** `feat(player): lava/fire damage-over-time honouring fire_resistance`

---

### Task 5: `BREWING_STAND` block + new ingredient items (pure registry; tests via existing suites)

Add the `BREWING_STAND` block id, registry def, tile, palette, hardness, item name, and the five new ingredient material items. This is the registry foundation for brewing; no UI/logic yet.

**Files:**
- Modify: `src/rules/mc-1.20.ts` (`Blocks` L42; `BLOCK_HARDNESS` L239)
- Modify: `src/rules/block-registry.ts` (`TILE` L135; `DEFS` after L237; JSDoc table)
- Modify: `src/rendering/palette.ts` (`TILE_COLORS` L59)
- Modify: `src/rendering/atlas.ts` (`MAX_USED_TILE` L112)
- Modify: `src/rendering/atlas.test.ts` (append a tile-36 regression)
- Modify: `src/rules/items.ts` (`Items` enum L143; `BLOCK_ITEM_NAMES` L261; `NON_BLOCK_DEFS` L342)

**Must-protect:**
- `block-registry.test.ts` "entry for every id in Blocks" / "no entries for unknown ids" / "opaque⊕transparent" / "every block opaque or transparent" / "liquids non-solid+transparent" — the new `BREWING_STAND` DEF must be a `transparentSolid` (sets `opaque:false, transparent:true, solid:true, liquid:false`).
- `items.test.ts` "block-item def for every Blocks id" — `BLOCK_ITEM_NAMES` is `Readonly<Record<BlockId, string>>`; adding `BREWING_STAND` to `Blocks` REQUIRES the new key (TypeScript enforces it). `NON_DEFAULT_MAX_STACK` in the test maps only `BED:1`; brewing stand stacks to 64, so do NOT add a `BLOCK_MAX_STACK_OVERRIDES` entry (else the test's expected 64 fails).
- `items.test.ts` "all non-block item ids are >= 256" / "ids unique" — new ingredient ids start contiguously at `NON_BLOCK_BASE + 69` with no gaps/collisions.
- `atlas.test.ts` BED tile-35 reddish-not-magenta — must stay green; `MAX_USED_TILE` must be `>= 35`. After bumping to 36, the BED test is unaffected (36 > 35).
- `edit.ts` `BLOCK_COUNT = Object.keys(Blocks).length` auto-scales 29→30; placing id 29 stays valid (it is `< BLOCK_COUNT`). No edit needed there.

Steps:

- [ ] **(CODE)** Add `BREWING_STAND: 29` to the `Blocks` const in `src/rules/mc-1.20.ts`. Before (L40–42):
  ```ts
    BIRCH_PLANKS: 27,
    BED: 28,
  } as const;
  ```
  After:
  ```ts
    BIRCH_PLANKS: 27,
    BED: 28,
    BREWING_STAND: 29,
  } as const;
  ```
- [ ] **(CODE)** Add the hardness entry to `BLOCK_HARDNESS` in `src/rules/mc-1.20.ts`. Before (L237–239):
  ```ts
    [Blocks.BEDROCK]: Infinity,
    [Blocks.OAK_LEAVES]: 0.2,
  };
  ```
  After:
  ```ts
    [Blocks.BEDROCK]: Infinity,
    [Blocks.OAK_LEAVES]: 0.2,
    [Blocks.BREWING_STAND]: 0.5,
  };
  ```
- [ ] **(CODE)** Add `TILE.BREWING_STAND = 36` in `src/rules/block-registry.ts`. Before (L133–135):
  ```ts
    BIRCH_PLANKS: 34,
    BED: 35,
  } as const;
  ```
  After:
  ```ts
    BIRCH_PLANKS: 34,
    BED: 35,
    BREWING_STAND: 36,
  } as const;
  ```
  (Also append `36  brewing_stand  BREWING_STAND (all)` to the JSDoc atlas-mapping table comment at the top of the file, mirroring the existing `35  bed  BED (all)` line.)
- [ ] **(CODE)** Add the `BREWING_STAND` DEF to the `DEFS` array in `src/rules/block-registry.ts`. Before (L236–242):
  ```ts
    // Bed — transparent solid (alpha pass, no occlusion); single-block simplification.
    transparentSolid(Blocks.BED, "Bed", uniform(TILE.BED)),

    // Liquids -----------------------------------------------------------------
    liquid(Blocks.WATER, "Water", TILE.WATER),
    liquid(Blocks.LAVA, "Lava", TILE.LAVA),
  ];
  ```
  After:
  ```ts
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
  ```
- [ ] **(CODE)** Add the palette color for tile 36 in `src/rendering/palette.ts`. Before (L58–60):
  ```ts
    34: [0.82, 0.74, 0.48], // birch_planks — richer warm pale wood
    35: [0.82, 0.14, 0.16], // bed — vivid warm red
  };
  ```
  After:
  ```ts
    34: [0.82, 0.74, 0.48], // birch_planks — richer warm pale wood
    35: [0.82, 0.14, 0.16], // bed — vivid warm red
    36: [0.34, 0.30, 0.26], // brewing_stand — dark stone-brown (blaze-rod stand)
  };
  ```
- [ ] **(CODE)** Bump `MAX_USED_TILE` in `src/rendering/atlas.ts`. Before (L111–112):
  ```ts
  /** Number of distinct tile indices used by the block registry. */
  const MAX_USED_TILE = 35;
  ```
  After:
  ```ts
  /** Number of distinct tile indices used by the block registry. */
  const MAX_USED_TILE = 36;
  ```
- [ ] **(CODE, UNIT)** Append a tile-36 regression to `src/rendering/atlas.test.ts`, modeled on the BED tile-35 test. Add inside the same `describe` as the BED test:
  ```ts
    it("brewing-stand tile (index 36) center texel reads brownish, not magenta", () => {
      const [r, g, b, a] = centerPixel(36); // brewing_stand — [0.34, 0.30, 0.26]
      expect(a).toBe(255);
      // Magenta fallback is [0.8, 0.2, 0.8] → R high, B high. The stand is dark
      // brown: R modest, G ~ R, B below R. Assert it is NOT the magenta debug.
      expect(r).toBeLessThan(150); // 0.34 * 255 ≈ 87 (well below magenta R ≈ 204)
      expect(Math.abs(r - g)).toBeLessThan(40); // brown: R≈G (magenta has G≈51)
    });
  ```
  (`centerPixel` is the existing helper used by the BED test at L102.)
- [ ] **(CODE)** Add the five new ingredient item ids to `Items` in `src/rules/items.ts`. Before (L142–144):
  ```ts
    POTION_SWIFTNESS: NON_BLOCK_BASE + 67,
    POTION_FIRE_RESISTANCE: NON_BLOCK_BASE + 68,
  } as const;
  ```
  After:
  ```ts
    POTION_SWIFTNESS: NON_BLOCK_BASE + 67,
    POTION_FIRE_RESISTANCE: NON_BLOCK_BASE + 68,

    // Brewing ingredients (Phase 6b).
    GLASS_BOTTLE: NON_BLOCK_BASE + 69,
    WATER_BOTTLE: NON_BLOCK_BASE + 70,
    NETHER_WART: NON_BLOCK_BASE + 71,
    BLAZE_ROD: NON_BLOCK_BASE + 72,
    BLAZE_POWDER: NON_BLOCK_BASE + 73,
  } as const;
  ```
- [ ] **(CODE)** Add the `BREWING_STAND` block-item name to `BLOCK_ITEM_NAMES` in `src/rules/items.ts`. Before (L260–262):
  ```ts
    [Blocks.BIRCH_PLANKS]: "Birch Planks",
    [Blocks.BED]: "Bed",
  };
  ```
  After:
  ```ts
    [Blocks.BIRCH_PLANKS]: "Birch Planks",
    [Blocks.BED]: "Bed",
    [Blocks.BREWING_STAND]: "Brewing Stand",
  };
  ```
- [ ] **(CODE)** Add the five `material()` defs to `NON_BLOCK_DEFS` in `src/rules/items.ts`. Before (the potions tail, L341–343):
  ```ts
    potion(Items.POTION_SWIFTNESS, "Potion of Swiftness", "swiftness", 0, EFFECT_TUNING.DEFAULT_DURATION),
    potion(Items.POTION_FIRE_RESISTANCE, "Potion of Fire Resistance", "fire_resistance", 0, EFFECT_TUNING.DEFAULT_DURATION),
  ];
  ```
  After (insert the ingredients BEFORE the closing `];`; the splash/tipped defs come in Task 11):
  ```ts
    potion(Items.POTION_SWIFTNESS, "Potion of Swiftness", "swiftness", 0, EFFECT_TUNING.DEFAULT_DURATION),
    potion(Items.POTION_FIRE_RESISTANCE, "Potion of Fire Resistance", "fire_resistance", 0, EFFECT_TUNING.DEFAULT_DURATION),

    // Brewing ingredients (Phase 6b). WATER_BOTTLE is the brew base; the others
    // are reagents. GLASS_BOTTLE crafts into WATER_BOTTLE (out of scope: recipe).
    material(Items.GLASS_BOTTLE, "Glass Bottle"),
    material(Items.WATER_BOTTLE, "Water Bottle"),
    material(Items.NETHER_WART, "Nether Wart"),
    material(Items.BLAZE_ROD, "Blaze Rod"),
    material(Items.BLAZE_POWDER, "Blaze Powder"),
  ];
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/rules/block-registry.test.ts src/rules/items.test.ts src/rendering/atlas.test.ts` → all green (every-id completeness; opaque⊕transparent; tile-35 + tile-36 not magenta; ingredient ids unique + >= 256).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors (the `Readonly<Record<BlockId, string>>` enforcement catches a missing `BLOCK_ITEM_NAMES` key).
- [ ] **Commit:** `feat(blocks): BREWING_STAND block + brewing ingredient items`

---

### Task 6: Brew recipes + matcher (`brew-recipes.ts`) (pure; tests FIRST)

Add the `BrewRecipe` shape, a flat `BREWING` table, and `findBrewing(base, ingredient)` — the brewing analog of `SMELTING` + `findSmelting`, kept in a SEPARATE file (mirroring how furnace smelting sits apart from `recipes.ts`). This avoids touching `RECIPES`/`SMELTING` (whose counts are pinned).

**Files:**
- Create: `src/crafting/brew-recipes.ts`, `src/crafting/brew-recipes.test.ts`

**Must-protect:**
- `recipes.test.ts` `SMELTING.length === 8` and `RECIPES.length >= 15` — do NOT add to `SMELTING`/`RECIPES`; `BREWING` is a new export in a new file.
- `matcher.ts` `findRecipe`/`findSmelting`/`fuelBurnTicks` — unchanged; `findBrewing` lives in `brew-recipes.ts`, not `matcher.ts` (keeps the matcher suite untouched).
- Brew results reuse the EXISTING potion item ids (`POTION_*`); no new `EffectType` is introduced, so `EFFECT_TYPE_IDS` (a stable persistence map) is untouched.

Steps:

- [ ] **(CODE, UNIT)** Create `src/crafting/brew-recipes.ts`:
  ```ts
  /**
   * brew-recipes.ts — brewing-stand recipe data + lookup (Phase 6b).
   *
   * A brew takes a BASE potion (water bottle or an intermediate) + one INGREDIENT
   * reagent → a RESULT potion. Modeled as a flat base→ingredient→result table,
   * mirroring the furnace's separate SMELTING table (kept OUT of recipes.ts so
   * the pinned RECIPES/SMELTING counts are untouched). Results reuse the existing
   * POTION_* item ids — no new EffectType is introduced.
   *
   * v1 tree (flattened, water-bottle-rooted):
   *   water_bottle + nether_wart  → POTION_REGENERATION (the "awkward" base; we
   *                                  collapse the awkward step for a shippable v1)
   *   water_bottle + blaze_powder → POTION_STRENGTH
   *   water_bottle + blaze_rod    → POTION_FIRE_RESISTANCE
   * Extending the tree later is additive (append rows).
   */

  import { Items, type ItemId } from "../rules/items";

  /** A single brewing recipe: base potion + ingredient → result potion. */
  export interface BrewRecipe {
    id: string;
    base: ItemId;
    ingredient: ItemId;
    result: ItemId;
  }

  /** The brewing table. First match in {@link findBrewing} wins. */
  export const BREWING: readonly BrewRecipe[] = [
    {
      id: "regeneration",
      base: Items.WATER_BOTTLE,
      ingredient: Items.NETHER_WART,
      result: Items.POTION_REGENERATION,
    },
    {
      id: "strength",
      base: Items.WATER_BOTTLE,
      ingredient: Items.BLAZE_POWDER,
      result: Items.POTION_STRENGTH,
    },
    {
      id: "fire_resistance",
      base: Items.WATER_BOTTLE,
      ingredient: Items.BLAZE_ROD,
      result: Items.POTION_FIRE_RESISTANCE,
    },
  ];

  /** The result of brewing `base` with `ingredient`, or null if no recipe matches. */
  export function findBrewing(base: ItemId, ingredient: ItemId): ItemId | null {
    for (const r of BREWING) {
      if (r.base === base && r.ingredient === ingredient) return r.result;
    }
    return null;
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/crafting/brew-recipes.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { BREWING, findBrewing } from "./brew-recipes";
  import { Items } from "../rules/items";

  describe("BREWING table", () => {
    it("recipe ids are unique", () => {
      const ids = BREWING.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
    it("every result is an existing potion item id", () => {
      const potions = new Set<number>([
        Items.POTION_REGENERATION, Items.POTION_HEALING, Items.POTION_HARMING,
        Items.POTION_POISON, Items.POTION_RESISTANCE, Items.POTION_STRENGTH,
        Items.POTION_SWIFTNESS, Items.POTION_FIRE_RESISTANCE,
      ]);
      for (const r of BREWING) expect(potions.has(r.result)).toBe(true);
    });
  });

  describe("findBrewing", () => {
    it("water bottle + nether wart → regeneration", () => {
      expect(findBrewing(Items.WATER_BOTTLE, Items.NETHER_WART)).toBe(
        Items.POTION_REGENERATION,
      );
    });
    it("water bottle + blaze rod → fire resistance", () => {
      expect(findBrewing(Items.WATER_BOTTLE, Items.BLAZE_ROD)).toBe(
        Items.POTION_FIRE_RESISTANCE,
      );
    });
    it("non-recipe pairs → null", () => {
      expect(findBrewing(Items.WATER_BOTTLE, Items.STICK)).toBeNull();
      expect(findBrewing(Items.GLASS_BOTTLE, Items.NETHER_WART)).toBeNull();
    });
  });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/crafting/brew-recipes.test.ts src/crafting/recipes.test.ts` → all green (`SMELTING.length===8` / `RECIPES.length>=15` untouched).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(crafting): brewing recipe table + findBrewing matcher`

---

### Task 7: `BrewingStand` tick state machine + save round-trip (pure; tests FIRST)

A `BrewingStand` class mirroring `Furnace`: a base-potion slot, an ingredient slot, a blaze-powder fuel slot, and an output slot, with `brewsRemaining` (a BREWS counter, not burn ticks) and `brewProgress` (0..`TICKS_PER_BREW`). One completed brew converts `base + ingredient` → `result`, consumes one ingredient + one base, and decrements `brewsRemaining`. The class also owns a flat `BrewingStandSave` shape + pure `toSave()` / `static fromSave()` so the per-stand registry (Task 7) can persist contents across reload — mirroring how `MobSave` + `toMobSave`/`fromMobSave` flatten a `Mob` for the save system.

**Files:**
- Create: `src/crafting/brewing-stand.ts`, `src/crafting/brewing-stand.test.ts`
- Modify: `src/rules/mc-1.20.ts` (add `BREW` near `FIRE`, after `SMELT`)

**Must-protect:**
- `furnace.test.ts` + `Furnace`/`SMELT` — the `BrewingStand` class must NOT touch `furnace.ts` or `SMELT`. It is a parallel class with its own `BREW` constants.
- mc-1.20 G4: `BREW.TICKS_PER_BREW` / `BREW.BREWS_PER_BLAZE_POWDER` live in `mc-1.20.ts`, not inline.
- Fuel is measured in BREWS, not burn ticks (recon gotcha): igniting one blaze powder grants `BREWS_PER_BLAZE_POWDER` brews; `brewsRemaining` decrements by 1 per COMPLETED brew (not per tick). Do NOT copy `fuelBurnTicks` semantics.
- `toSave()`/`fromSave()` are EXACT inverses: a stand round-trips its four slots (including a durability-carrying slot, even though brewing slots are normally potions/reagents) + `brewsRemaining` + `brewProgress` with no loss. `ItemStackSave` shape MUST match `src/save/serialize.ts` (`itemId`/`count`/`maxStack` + optional `durability`/`maxDurability`) so the registry blob and the player-inventory blob share the same slot encoding.

Steps:

- [ ] **(CODE)** Add the `BREW` constants to `src/rules/mc-1.20.ts`, immediately after the `FIRE` block added in Task 2. Insert:
  ```ts
  // ---------------------------------------------------------------------------
  // Brewing (Phase 6b)
  // ---------------------------------------------------------------------------

  /** Brewing-stand tuning (20 TPS). */
  export const BREW = {
    /** Ticks to complete one brew (20 s — slower than smelting, MC-flavored). */
    TICKS_PER_BREW: 400,
    /** Brews one unit of blaze powder fuels (MC: 20). */
    BREWS_PER_BLAZE_POWDER: 20,
  } as const;
  ```
- [ ] **(CODE, UNIT)** Create `src/crafting/brewing-stand.ts`:
  ```ts
  /**
   * brewing-stand.ts — a single brewing stand's state machine (Phase 6b).
   *
   * Mirrors Furnace but with brewing semantics:
   *  - `base`        the base potion (water bottle / intermediate) being brewed.
   *  - `ingredient`  the reagent consumed to transform the base.
   *  - `fuel`        blaze powder; igniting one grants BREWS_PER_BLAZE_POWDER brews.
   *  - `output`      where the result potion is placed.
   *  - `brewsRemaining`  fuel measured in BREWS (NOT ticks — unlike the furnace).
   *  - `brewProgress`    ticks of the current brew (0..TICKS_PER_BREW).
   *
   * Each tick: if base+ingredient form a recipe AND output has room, ensure fuel
   * (ignite one blaze powder if brewsRemaining is 0), then advance brewProgress.
   * On reaching TICKS_PER_BREW: consume one base + one ingredient, place the
   * result, decrement brewsRemaining, reset progress. Otherwise progress decays.
   *
   * Potions stack to 1, so a single brew either fills an empty output or stalls
   * if the output already holds a potion (no count stacking).
   */

  import { BREW } from "../rules/mc-1.20";
  import { type ItemStack, makeStack } from "../inventory/stack";
  import { maxStackOf } from "../rules/items";
  import { findBrewing } from "./brew-recipes";
  import type { ItemStackSave } from "../save/serialize";

  /**
   * Flat, plain-data snapshot of a BrewingStand for the save system. Mirrors
   * MobSave: slots flatten to ItemStackSave|null and the two counters are kept
   * as ints. The owning coords are NOT stored here — the registry keys by coords
   * (mirroring how the columns map keys by "cx,cz").
   */
  export interface BrewingStandSave {
    base: ItemStackSave | null;
    ingredient: ItemStackSave | null;
    fuel: ItemStackSave | null;
    output: ItemStackSave | null;
    brewsRemaining: number;
    brewProgress: number;
  }

  /** Convert a live slot into its serializable shape (durability optional). */
  function slotToSave(stack: ItemStack | null): ItemStackSave | null {
    if (stack === null) return null;
    const save: ItemStackSave = {
      itemId: stack.itemId,
      count: stack.count,
      maxStack: stack.maxStack,
    };
    if (stack.durability !== undefined && stack.maxDurability !== undefined) {
      save.durability = stack.durability;
      save.maxDurability = stack.maxDurability;
    }
    return save;
  }

  /** Rebuild a live slot from its serializable shape. */
  function slotFromSave(save: ItemStackSave | null): ItemStack | null {
    if (save === null) return null;
    const stack: ItemStack = {
      itemId: save.itemId,
      count: save.count,
      maxStack: save.maxStack,
    };
    if (save.durability !== undefined && save.maxDurability !== undefined) {
      stack.durability = save.durability;
      stack.maxDurability = save.maxDurability;
    }
    return stack;
  }

  export class BrewingStand {
    base: ItemStack | null = null;
    ingredient: ItemStack | null = null;
    fuel: ItemStack | null = null;
    output: ItemStack | null = null;
    /** Brews remaining from the currently-burned blaze powder (0 = unfueled). */
    brewsRemaining = 0;
    /** Progress (in ticks) of the current brew (0..BREW.TICKS_PER_BREW). */
    brewProgress = 0;

    /** True iff fuel is currently available for at least one brew. */
    private get fueled(): boolean {
      return this.brewsRemaining > 0;
    }

    /**
     * The result id if base+ingredient form a recipe AND the output can accept
     * it (empty; potions never stack), else null.
     */
    private brewableResult(): number | null {
      if (this.base === null || this.base.count <= 0) return null;
      if (this.ingredient === null || this.ingredient.count <= 0) return null;
      const result = findBrewing(this.base.itemId, this.ingredient.itemId);
      if (result === null) return null;
      if (this.output !== null) return null; // potions are maxStack 1 — no room
      return result;
    }

    /** Consume one blaze-powder unit → BREWS_PER_BLAZE_POWDER brews. */
    private igniteFuel(): boolean {
      if (this.fuel === null || this.fuel.count <= 0) return false;
      this.brewsRemaining += BREW.BREWS_PER_BLAZE_POWDER;
      const remaining = this.fuel.count - 1;
      this.fuel = remaining <= 0 ? null : { ...this.fuel, count: remaining };
      return true;
    }

    /** Place the brewed result into the (empty) output. */
    private produce(result: number): void {
      this.output = makeStack(result, 1, maxStackOf(result));
    }

    /** Advance the brewing stand by one game tick. */
    tick(): void {
      const result = this.brewableResult();

      // Nothing brewable: no fuel spent, progress decays toward 0.
      if (result === null) {
        if (this.brewProgress > 0) this.brewProgress -= 1;
        return;
      }

      // Need fuel: ignite a unit of blaze powder if none remains.
      if (!this.fueled) this.igniteFuel();

      // Still no fuel → cannot brew; progress decays.
      if (!this.fueled) {
        if (this.brewProgress > 0) this.brewProgress -= 1;
        return;
      }

      // Fueled AND brewable: advance progress. On completion, consume one base +
      // one ingredient, produce the result, spend one brew of fuel.
      this.brewProgress += 1;
      if (this.brewProgress >= BREW.TICKS_PER_BREW) {
        this.brewProgress = 0;
        this.brewsRemaining -= 1;
        if (this.base !== null) {
          const left = this.base.count - 1;
          this.base = left <= 0 ? null : { ...this.base, count: left };
        }
        if (this.ingredient !== null) {
          const left = this.ingredient.count - 1;
          this.ingredient = left <= 0 ? null : { ...this.ingredient, count: left };
        }
        this.produce(result);
      }
    }

    /** Flatten this stand's contents into a plain {@link BrewingStandSave}. */
    toSave(): BrewingStandSave {
      return {
        base: slotToSave(this.base),
        ingredient: slotToSave(this.ingredient),
        fuel: slotToSave(this.fuel),
        output: slotToSave(this.output),
        brewsRemaining: this.brewsRemaining,
        brewProgress: this.brewProgress,
      };
    }

    /** Rebuild a live stand from a saved snapshot (exact inverse of toSave). */
    static fromSave(s: BrewingStandSave): BrewingStand {
      const stand = new BrewingStand();
      stand.base = slotFromSave(s.base);
      stand.ingredient = slotFromSave(s.ingredient);
      stand.fuel = slotFromSave(s.fuel);
      stand.output = slotFromSave(s.output);
      stand.brewsRemaining = s.brewsRemaining;
      stand.brewProgress = s.brewProgress;
      return stand;
    }
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/crafting/brewing-stand.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { BrewingStand } from "./brewing-stand";
  import { BREW } from "../rules/mc-1.20";
  import { makeStack } from "../inventory/stack";
  import { Items } from "../rules/items";

  function fueledStand(): BrewingStand {
    const s = new BrewingStand();
    s.base = makeStack(Items.WATER_BOTTLE, 1, 1);
    s.ingredient = makeStack(Items.NETHER_WART, 1);
    s.fuel = makeStack(Items.BLAZE_POWDER, 1);
    return s;
  }

  describe("BrewingStand", () => {
    it("does nothing with no recipe (progress stays 0)", () => {
      const s = new BrewingStand();
      s.base = makeStack(Items.WATER_BOTTLE, 1, 1);
      s.ingredient = makeStack(Items.STICK, 1); // not a reagent
      s.fuel = makeStack(Items.BLAZE_POWDER, 1);
      for (let i = 0; i < 10; i++) s.tick();
      expect(s.brewProgress).toBe(0);
      expect(s.output).toBeNull();
      expect(s.brewsRemaining).toBe(0); // never ignited (nothing brewable)
    });

    it("ignites one blaze powder into BREWS_PER_BLAZE_POWDER brews on first tick", () => {
      const s = fueledStand();
      s.tick();
      expect(s.brewsRemaining).toBe(BREW.BREWS_PER_BLAZE_POWDER);
      expect(s.fuel).toBeNull(); // consumed the single powder unit
      expect(s.brewProgress).toBe(1);
    });

    it("completes a brew after TICKS_PER_BREW: produces result, consumes inputs", () => {
      const s = fueledStand();
      for (let i = 0; i < BREW.TICKS_PER_BREW; i++) s.tick();
      expect(s.output).not.toBeNull();
      expect(s.output!.itemId).toBe(Items.POTION_REGENERATION);
      expect(s.base).toBeNull();        // 1 → 0
      expect(s.ingredient).toBeNull();  // 1 → 0
      expect(s.brewProgress).toBe(0);
      // One blaze powder fuels many brews; one was spent.
      expect(s.brewsRemaining).toBe(BREW.BREWS_PER_BLAZE_POWDER - 1);
    });

    it("stalls when output is occupied (potions do not stack)", () => {
      const s = fueledStand();
      s.output = makeStack(Items.POTION_HEALING, 1, 1);
      for (let i = 0; i < BREW.TICKS_PER_BREW; i++) s.tick();
      expect(s.brewProgress).toBe(0);
      expect(s.output!.itemId).toBe(Items.POTION_HEALING); // unchanged
    });

    it("without fuel, brewable inputs make no progress", () => {
      const s = new BrewingStand();
      s.base = makeStack(Items.WATER_BOTTLE, 1, 1);
      s.ingredient = makeStack(Items.NETHER_WART, 1);
      for (let i = 0; i < 50; i++) s.tick();
      expect(s.brewProgress).toBe(0);
      expect(s.output).toBeNull();
    });
  });

  describe("BrewingStand save round-trip", () => {
    it("toSave/fromSave is an exact inverse for a mid-brew stand", () => {
      const s = fueledStand();
      for (let i = 0; i < 5; i++) s.tick(); // ignite + accrue some progress
      const restored = BrewingStand.fromSave(s.toSave());
      expect(restored.base).toEqual(s.base);
      expect(restored.ingredient).toEqual(s.ingredient);
      expect(restored.fuel).toEqual(s.fuel);
      expect(restored.output).toEqual(s.output);
      expect(restored.brewsRemaining).toBe(s.brewsRemaining);
      expect(restored.brewProgress).toBe(s.brewProgress);
      expect(restored.brewProgress).toBeGreaterThan(0); // proves progress survived
    });
    it("survives JSON serialization (the registry blob is JSON)", () => {
      const s = fueledStand();
      for (let i = 0; i < 5; i++) s.tick();
      const json = JSON.stringify(s.toSave());
      const restored = BrewingStand.fromSave(JSON.parse(json) as ReturnType<BrewingStand["toSave"]>);
      expect(restored.brewProgress).toBe(s.brewProgress);
      expect(restored.brewsRemaining).toBe(s.brewsRemaining);
    });
    it("a continued brew completes identically after a round-trip", () => {
      const s = fueledStand();
      s.tick(); // ignite + 1 tick of progress
      const restored = BrewingStand.fromSave(s.toSave());
      // Finish the brew from the restored stand.
      for (let i = 1; i < BREW.TICKS_PER_BREW; i++) restored.tick();
      expect(restored.output).not.toBeNull();
      expect(restored.output!.itemId).toBe(Items.POTION_REGENERATION);
    });
  });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/crafting/brewing-stand.test.ts src/crafting/furnace.test.ts` → all green (Furnace untouched; brewing fuel-in-brews + completion + stall + save round-trip paths pass).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(crafting): BrewingStand tick state machine + save round-trip (blaze-powder fuel in brews)`

---

### Task 8: `BrewingStands` coords-keyed registry + SAVE_VERSION 6→7 persistence (pure; tests FIRST)

Add the per-placed-stand registry (a block-entity-style `Map<"x,y,z", BrewingStand>`) and persist its full contents across save/reload, ADDITIVELY behind `SAVE_FORMAT`/`SAVE_VERSION` 6→7 — mirroring EXACTLY how the world-level `mobs` JSON blob was added in container format 2. This is the state-ownership + persistence backbone the interactive screen (Task 9) drives.

**State ownership decision (justified):** the user requires per-placed-stand state that survives reload. The recon shows the `Furnace` class is PURE-but-UNWIRED in the live game (no global instance, no screen, no save) — so there is NO global-stand precedent to inherit. A coords-keyed block-entity registry is tractable here because placed brewing stands are SPARSE (a handful of blocks, never the 65536-cell voxel volume), so a `Record<"x,y,z", BrewingStandSave>` JSON blob is tiny and reuses the proven `mobs`-blob path verbatim.

**Files:**
- Create: `src/crafting/brewing-stands.ts`, `src/crafting/brewing-stands.test.ts`
- Modify: `src/save/serialize.ts` (`WorldSave`; `SAVE_FORMAT` 6→7; `serializeSave`/`deserializeSave` blob)
- Modify: `src/save/serialize.test.ts` (append v7 round-trip cases)
- Modify: `src/save/migration.ts` (`SAVE_VERSION` 6→7; `MIGRATIONS[6]`)
- Modify: `src/save/migration.test.ts` (`SAVE_VERSION` pin; chain; fixture)

**Must-protect:**
- `serialize.test.ts` round-trip cases — every existing `WorldSave` literal that omits `brewingStands` MUST still decode (the field is OPTIONAL; absent → `undefined`, exactly like an absent `mobs` on a v1 container). The blob is written ONLY for container format ≥ 7 and read ONLY when `format >= 7`, so format-6 fixtures (and the `samplePlayer`/`samplePlayerMin` ones at L93/L243) are byte-identical.
- `migration.test.ts` `SAVE_VERSION === 6` pin → becomes `=== 7`; the "exposes SAVE_VERSION" test (L118–121) and any full-chain `migrate(saveAt(1)) → version 7` assertion MUST be updated; the `saveAt` fixture (L20–28) must add `brewingStands: []` IF a test does a `toEqual` on the whole migrated player/world (note: `MIGRATIONS[6]` adds `brewingStands` at the WORLD level, not the player record — so the fixture's player shape is unchanged; only world-level `brewingStands` is added).
- `MIGRATIONS[6]` (v6→v7) seeds `brewingStands: []` (v6 saves predate brewing persistence) — mirroring `MIGRATIONS[1]` seeding `mobs: []`. It MUST bump `version` to 7.
- `SAVE_FORMAT_MIN` stays 1 (all older containers still decode). `SAVE_FORMAT` becomes 7. The new blob trails the `mobs` blob so older readers never reach it and newer readers append cleanly.
- `BrewingStands.fromSave` skips malformed/empty snapshots defensively (never throws on a stand that decodes oddly) — persistence must NEVER crash the running game (the `loadGame` catch-all is the last line of defense, but the registry should be robust on its own).

Steps:

- [ ] **(CODE, UNIT)** Create `src/crafting/brewing-stands.ts` — the coords-keyed registry:
  ```ts
  /**
   * brewing-stands.ts — the live registry of placed brewing stands (Phase 6b).
   *
   * Block-entity-style: a Map keyed by "x,y,z" (mirroring how the world columns
   * Map keys by "cx,cz") whose values are per-placed-stand BrewingStand logic
   * objects. Placed stands are sparse, so the whole registry serializes to a
   * small JSON blob — added to the save behind SAVE_VERSION 6→7, exactly like the
   * mobs blob was added in container format 2.
   */

  import { BrewingStand, type BrewingStandSave } from "./brewing-stand";

  /** A persisted stand: its block coords + its flattened contents. */
  export interface BrewingStandEntrySave {
    x: number;
    y: number;
    z: number;
    stand: BrewingStandSave;
  }

  /** The "x,y,z" key for a stand at integer block coords. */
  function keyOf(x: number, y: number, z: number): string {
    return `${String(x)},${String(y)},${String(z)}`;
  }

  export class BrewingStands {
    private readonly stands = new Map<string, BrewingStand>();

    /** The live stand at these coords, creating + registering one if absent. */
    getOrCreate(x: number, y: number, z: number): BrewingStand {
      const key = keyOf(x, y, z);
      let stand = this.stands.get(key);
      if (stand === undefined) {
        stand = new BrewingStand();
        this.stands.set(key, stand);
      }
      return stand;
    }

    /** The live stand at these coords, or null if none is registered. */
    peek(x: number, y: number, z: number): BrewingStand | null {
      return this.stands.get(keyOf(x, y, z)) ?? null;
    }

    /** Remove the stand at these coords (e.g. when the block is broken). */
    remove(x: number, y: number, z: number): boolean {
      return this.stands.delete(keyOf(x, y, z));
    }

    /** Advance every registered stand by one game tick. */
    tickAll(): void {
      for (const stand of this.stands.values()) stand.tick();
    }

    /** Number of registered stands (for tests / diagnostics). */
    count(): number {
      return this.stands.size;
    }

    /** Flatten the whole registry into plain-data save entries. */
    toSave(): BrewingStandEntrySave[] {
      const out: BrewingStandEntrySave[] = [];
      for (const [key, stand] of this.stands) {
        const [x, y, z] = key.split(",").map(Number) as [number, number, number];
        out.push({ x, y, z, stand: stand.toSave() });
      }
      return out;
    }

    /** Rebuild a registry from saved entries (defensive: skips bad rows). */
    static fromSave(entries: readonly BrewingStandEntrySave[]): BrewingStands {
      const reg = new BrewingStands();
      for (const e of entries) {
        if (
          typeof e.x !== "number" ||
          typeof e.y !== "number" ||
          typeof e.z !== "number" ||
          e.stand === undefined
        ) {
          continue; // skip malformed row — never throw
        }
        reg.stands.set(keyOf(e.x, e.y, e.z), BrewingStand.fromSave(e.stand));
      }
      return reg;
    }
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/crafting/brewing-stands.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { BrewingStands } from "./brewing-stands";
  import { BREW } from "../rules/mc-1.20";
  import { makeStack } from "../inventory/stack";
  import { Items } from "../rules/items";

  describe("BrewingStands registry", () => {
    it("getOrCreate returns the SAME stand for the same coords", () => {
      const reg = new BrewingStands();
      const a = reg.getOrCreate(3, 64, -7);
      const b = reg.getOrCreate(3, 64, -7);
      expect(a).toBe(b);
      expect(reg.count()).toBe(1);
    });
    it("distinct coords get distinct stands", () => {
      const reg = new BrewingStands();
      reg.getOrCreate(0, 0, 0);
      reg.getOrCreate(0, 0, 1);
      expect(reg.count()).toBe(2);
    });
    it("peek is null before creation, the stand after, null after remove", () => {
      const reg = new BrewingStands();
      expect(reg.peek(1, 1, 1)).toBeNull();
      const s = reg.getOrCreate(1, 1, 1);
      expect(reg.peek(1, 1, 1)).toBe(s);
      expect(reg.remove(1, 1, 1)).toBe(true);
      expect(reg.peek(1, 1, 1)).toBeNull();
    });
    it("tickAll advances every registered stand", () => {
      const reg = new BrewingStands();
      const s = reg.getOrCreate(2, 2, 2);
      s.base = makeStack(Items.WATER_BOTTLE, 1, 1);
      s.ingredient = makeStack(Items.NETHER_WART, 1);
      s.fuel = makeStack(Items.BLAZE_POWDER, 1);
      reg.tickAll();
      expect(s.brewProgress).toBe(1);
      expect(s.brewsRemaining).toBe(BREW.BREWS_PER_BLAZE_POWDER);
    });
  });

  describe("BrewingStands save round-trip", () => {
    it("toSave/fromSave preserves coords + per-stand contents", () => {
      const reg = new BrewingStands();
      const s = reg.getOrCreate(5, 64, -3);
      s.base = makeStack(Items.WATER_BOTTLE, 1, 1);
      s.ingredient = makeStack(Items.NETHER_WART, 1);
      s.fuel = makeStack(Items.BLAZE_POWDER, 1);
      reg.tickAll(); // ignite + 1 tick
      const json = JSON.stringify(reg.toSave());
      const restored = BrewingStands.fromSave(JSON.parse(json));
      expect(restored.count()).toBe(1);
      const rs = restored.peek(5, 64, -3);
      expect(rs).not.toBeNull();
      expect(rs!.brewProgress).toBe(s.brewProgress);
      expect(rs!.brewsRemaining).toBe(s.brewsRemaining);
      expect(rs!.base).toEqual(s.base);
    });
    it("fromSave skips malformed rows without throwing", () => {
      const bad = [{ x: 1, y: 1 } as unknown] as never;
      expect(() => BrewingStands.fromSave(bad)).not.toThrow();
      expect(BrewingStands.fromSave(bad).count()).toBe(0);
    });
  });
  ```
- [ ] **(CODE, UNIT)** Add the optional `brewingStands` field to `WorldSave` in `src/save/serialize.ts`. Before (L70–78):
  ```ts
  export interface WorldSave {
    version: number;
    seed: number;
    totalTicks: number;
    player: PlayerSave;
    columns: Record<string, Uint8Array>;
    mobs?: MobSave[];
  }
  ```
  After (import the entry type at the top; add the optional field — optional so format ≤ 6 decodes to `undefined`, mirroring `mobs`):
  ```ts
  export interface WorldSave {
    version: number;
    seed: number;
    totalTicks: number;
    player: PlayerSave;
    columns: Record<string, Uint8Array>;
    mobs?: MobSave[];
    /**
     * Placed brewing stands + their in-progress contents. Added in save v7 /
     * container format 7; optional so older saves (which had no brewing
     * persistence) decode cleanly to `undefined` (treated as []).
     */
    brewingStands?: BrewingStandEntrySave[];
  }
  ```
  (Add `import { type BrewingStandEntrySave } from "../crafting/brewing-stands";` next to the `MobSave` import at L18.)
- [ ] **(CODE, UNIT)** Bump `SAVE_FORMAT` 6→7 and extend the format doc-comment in `src/save/serialize.ts`. Before (L207–209):
  ```ts
   * the off-hand defaults to null on containers older than format 6).
   */
  const SAVE_FORMAT = 6;
  ```
  After:
  ```ts
   * the off-hand defaults to null on containers older than format 6;
   * brewing stands default to [] on containers older than format 7).
   */
  const SAVE_FORMAT = 7;
  ```
  (Also add a `*  - 7: …plus a trailing length-prefixed JSON BrewingStandEntrySave[] blob.` bullet to the numbered format list at L196–204.)
- [ ] **(CODE, UNIT)** Write the `brewingStands` blob in `serializeSave`, trailing the `mobs` blob, in `src/save/serialize.ts`. Before (L572–575):
  ```ts
    // Mobs (container format 2+): a length-prefixed UTF-8 JSON array of MobSave.
    w.str(JSON.stringify(save.mobs ?? []));

    return w.finish();
  ```
  After:
  ```ts
    // Mobs (container format 2+): a length-prefixed UTF-8 JSON array of MobSave.
    w.str(JSON.stringify(save.mobs ?? []));

    // Brewing stands (container format 7+): a length-prefixed UTF-8 JSON array of
    // BrewingStandEntrySave. Trails the mobs blob so older readers never reach it.
    w.str(JSON.stringify(save.brewingStands ?? []));

    return w.finish();
  ```
- [ ] **(CODE, UNIT)** Read the `brewingStands` blob in `deserializeSave`, in `src/save/serialize.ts`. Before (L607–618):
  ```ts
    // Mobs trail the columns from container format 2 onward; a v1 container has
    // none, so it decodes to an empty list.
    let mobs: MobSave[] = [];
    if (format >= 2) {
      const parsed: unknown = JSON.parse(r.str());
      if (!Array.isArray(parsed)) {
        throw new Error("deserializeSave: mobs blob is not a JSON array");
      }
      mobs = parsed as MobSave[];
    }

    return { version, seed, totalTicks, player, columns, mobs };
  ```
  After:
  ```ts
    // Mobs trail the columns from container format 2 onward; a v1 container has
    // none, so it decodes to an empty list.
    let mobs: MobSave[] = [];
    if (format >= 2) {
      const parsed: unknown = JSON.parse(r.str());
      if (!Array.isArray(parsed)) {
        throw new Error("deserializeSave: mobs blob is not a JSON array");
      }
      mobs = parsed as MobSave[];
    }

    // Brewing stands trail the mobs blob from container format 7 onward; older
    // containers have none, so the field stays undefined (treated as []).
    let brewingStands: BrewingStandEntrySave[] | undefined;
    if (format >= 7) {
      const parsed: unknown = JSON.parse(r.str());
      if (!Array.isArray(parsed)) {
        throw new Error("deserializeSave: brewingStands blob is not a JSON array");
      }
      brewingStands = parsed as BrewingStandEntrySave[];
    }

    return { version, seed, totalTicks, player, columns, mobs, brewingStands };
  ```
- [ ] **(CODE, UNIT)** Bump `SAVE_VERSION` 6→7 and add `MIGRATIONS[6]` in `src/save/migration.ts`. Before (L13–14):
  ```ts
  /** The current on-disk save version this build writes and reads natively. */
  export const SAVE_VERSION = 6;
  ```
  After:
  ```ts
  /** The current on-disk save version this build writes and reads natively. */
  export const SAVE_VERSION = 7;
  ```
  Then extend the JSDoc list (after the `MIGRATIONS[5]` bullet) and the registry. Before (L33–35 + L63–71):
  ```ts
   * - `MIGRATIONS[5]` (v5 -> v6): adds the off-hand slot to the player record (defaults to null).
   */
  export const MIGRATIONS: Record<number, Migration> = {
  ```
  ```ts
    5: (data) => ({
      ...data,
      version: 6,
      player: {
        ...data.player,
        offhand: null,
      },
    }),
  };
  ```
  After (add the doc bullet + the new step seeding a WORLD-level empty `brewingStands`):
  ```ts
   * - `MIGRATIONS[5]` (v5 -> v6): adds the off-hand slot to the player record (defaults to null).
   * - `MIGRATIONS[6]` (v6 -> v7): adds the world-level brewingStands registry blob.
   *   v6 saves predate brewing persistence, so the upgrade seeds an empty list
   *   (mirrors MIGRATIONS[1] seeding an empty mobs list).
   */
  export const MIGRATIONS: Record<number, Migration> = {
  ```
  ```ts
    5: (data) => ({
      ...data,
      version: 6,
      player: {
        ...data.player,
        offhand: null,
      },
    }),
    6: (data) => ({ ...data, version: 7, brewingStands: [] }),
  };
  ```
- [ ] **(CODE, UNIT)** Update `src/save/migration.test.ts`: change the `SAVE_VERSION === 6` pin to `=== 7`; update the full migration-chain assertion (a v1 save migrates to `version === 7`); the `saveAt` fixture needs no player-shape change (brewing is world-level) but any whole-`WorldSave` `toEqual` must account for `brewingStands: []` after migrating to v7. Concretely, change:
  ```ts
    it("exposes SAVE_VERSION = 6 and a MIGRATIONS registry", () => {
      expect(SAVE_VERSION).toBe(6);
      expect(typeof MIGRATIONS).toBe("object");
    });
  ```
  to:
  ```ts
    it("exposes SAVE_VERSION = 7 and a MIGRATIONS registry", () => {
      expect(SAVE_VERSION).toBe(7);
      expect(typeof MIGRATIONS).toBe("object");
    });
    it("MIGRATIONS[6] seeds an empty brewingStands list (v6 -> v7)", () => {
      const v6 = saveAt(6, 99);
      const v7 = MIGRATIONS[6]!(v6);
      expect(v7.version).toBe(7);
      expect(v7.brewingStands).toEqual([]);
    });
  ```
  (Search the file for any other literal `6` tied to the version — e.g. a chain test that walks `saveAt(1)` to the latest and asserts `.version` — and bump its expected end-state to `7`. Run the suite to surface the exact line; do NOT blindly replace every `6`.)
- [ ] **(CODE, UNIT)** Append v7 round-trip cases to `src/save/serialize.test.ts` (new `it`s inside the existing top-level `describe`):
  ```ts
  it("round-trips a populated brewingStands blob (save v7)", () => {
    const save: WorldSave = {
      version: 7,
      seed: 11,
      totalTicks: 3,
      player: samplePlayerMin(),
      columns: {},
      mobs: [],
      brewingStands: [
        {
          x: 5,
          y: 64,
          z: -3,
          stand: {
            base: { itemId: Items.WATER_BOTTLE, count: 1, maxStack: 1 },
            ingredient: { itemId: Items.NETHER_WART, count: 1, maxStack: 64 },
            fuel: { itemId: Items.BLAZE_POWDER, count: 2, maxStack: 64 },
            output: null,
            brewsRemaining: 20,
            brewProgress: 137,
          },
        },
      ],
    };
    const round = deserializeSave(serializeSave(save));
    expect(round.brewingStands).toEqual(save.brewingStands);
  });

  it("a save written without brewingStands decodes the field as []", () => {
    // serializeSave always writes the v7 blob; absent input → [] (not undefined).
    const save: WorldSave = {
      version: 7,
      seed: 0,
      totalTicks: 0,
      player: samplePlayerMin(),
      columns: {},
      mobs: [],
    };
    const round = deserializeSave(serializeSave(save));
    expect(round.brewingStands).toEqual([]);
  });
  ```
  (`Items` is already imported at the top of `serialize.test.ts`; `samplePlayerMin`, `WorldSave`, `serializeSave`, `deserializeSave` are in scope.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/crafting/brewing-stands.test.ts src/save/serialize.test.ts src/save/migration.test.ts` → all green (registry + save v7 round-trip + migration chain to v7).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(save): per-stand BrewingStands registry persisted at SAVE_VERSION 7`

---

### Task 9: Interactive `BrewingStandScreen` + RMB open + tick + save/restore wiring (LIVE-QA glue)

Add a DOM-guarded INTERACTIVE `BrewingStandScreen` (mirroring `WorkbenchScreen`'s host-resolution + `hasDom()` + cursor-stack model) through which the player LOADS the base potion / ingredient / blaze-powder fuel and COLLECTS the output. Instantiate the screen + the `BrewingStands` registry in `main.ts`, gate the screen in `uiBlockingGameplay()`, add the Escape close + the coords-bound RMB-on-`BREWING_STAND` open, tick the whole registry each fixed tick, rehydrate the registry in `restoreFromSave`, and thread it into `saveGame`.

**Files:**
- Create: `src/ui/brewing-stand-screen.ts`
- Modify: `src/main.ts` (screens L470; `uiBlockingGameplay` L508; Escape chain L583; RMB L795; registry tick after `advance` L1020; render sync after L1105; `restoreFromSave` L430; `requestSave` L1169)
- Modify: `src/game/persistence.ts` (`buildWorldSave` + `saveGame` thread the registry)

**Must-protect:**
- `screen-state.test.ts` (Inventory/Pause/Death open-close) — adding `brewingStandScreen.isOpen()` to `uiBlockingGameplay()` is additive and must not perturb these.
- `uiBlockingGameplay()` must remain a pure boolean OR-chain (no side effects).
- The Escape close chain order (help → settings → workbench → inventory → pause) — insert the brewing-stand check adjacent to workbench WITHOUT skipping any existing handler. On close the screen MUST return any cursor-held stack to the player inventory (no item loss), mirroring `WorkbenchScreen.close()`.
- The `BrewingStandScreen` MUST use `hasDom()` guards (like `WorkbenchScreen`) so importing it in any future unit test is safe in the Node env. `build()` resolves host `inventory-root → hud → body` and uses a unique `root.id = "brewing-stand-screen"`.
- Slot moves reuse the EXISTING pure helpers `applySlotClick`/`applyRightClick` from `inventory-view.ts` — do NOT reinvent stack-merge logic. The OUTPUT slot is collect-only: a left-click pulls the finished potion to the cursor (or merges into it) and NEVER deposits the cursor into the output.
- `buildWorldSave`/`saveGame` gain a NEW trailing optional `brewingStands?` param so existing callers/tests that omit it still compile (mirroring how `mobs?` is the trailing optional today). `restoreFromSave` rehydrates via `BrewingStands.fromSave(save.brewingStands ?? [])`.
- The registry is the SOURCE OF TRUTH ticked in the loop; the screen binds the SAME `BrewingStand` instance returned by `brewingStands.getOrCreate(coords)` so loads/collects mutate the persisted stand directly.

Steps:

- [ ] **(CODE, LIVE-QA)** Create `src/ui/brewing-stand-screen.ts` — an interactive overlay with four clickable stand slots (base / ingredient / fuel / output) + a progress readout + the 9×4 player inventory grid, using the cursor-stack model from `WorkbenchScreen`. Left-click picks up / places a whole stack via `applySlotClick`; right-click places one via `applyRightClick`; the output slot is collect-only. Model the DOM/host/cursor/Escape scaffolding on `workbench-screen.ts` (slot styling via `styleSlot`, icons via `getAtlasIconStyle`/`fillSlot`, the floating `cursorEl`, the inventory grid build loop, `returnCursorToInventory` on close). The brewing-specific differences are: four named stand-slot cells (not a 3×3 craft grid), a progress line, and the collect-only output rule. Sketch of the brewing-specific core (reuse the rest verbatim from `workbench-screen.ts`):
  ```ts
  /**
   * brewing-stand-screen.ts — the INTERACTIVE Brewing Stand overlay (DOM, fully
   * guarded). Mirrors workbench-screen.ts: a thin DOM layer over the pure
   * inventory-view cursor-stack helpers. The player clicks to move stacks
   * between their inventory and the bound BrewingStand's four slots (base /
   * ingredient / fuel / output); the output slot is collect-only. The bound
   * stand is the SAME instance the registry ticks, so loads/collects persist.
   */

  import { Inventory, type Hotbar } from "../inventory/inventory";
  import type { ItemStack } from "../inventory/stack";
  import type { BrewingStand } from "../crafting/brewing-stand";
  import { BREW } from "../rules/mc-1.20";
  import {
    slotView,
    applySlotClick,
    applyRightClick,
  } from "./inventory-view";
  import { getAtlasIconStyle } from "./item-icon";

  /** Whether the DOM is available (false under node / unit tests). */
  function hasDom(): boolean {
    return typeof document !== "undefined";
  }

  /** The four stand slots, in display order. */
  type StandSlot = "base" | "ingredient" | "fuel" | "output";

  export class BrewingStandScreen {
    private open_ = false;
    private root: HTMLElement | null = null;
    private inventory: Inventory | null = null;
    private hotbar: Hotbar | null = null;
    private stand: BrewingStand | null = null;
    private cursor: ItemStack | null = null;
    private readonly standCells: Partial<Record<StandSlot, HTMLElement>> = {};
    private readonly invSlots: HTMLElement[] = [];
    private progressEl: HTMLElement | null = null;
    private cursorEl: HTMLElement | null = null;

    constructor() {
      if (hasDom()) this.build();
    }

    isOpen(): boolean {
      return this.open_;
    }

    /** Open the screen, binding the given live stand + player inventory. */
    open(stand: BrewingStand, inventory: Inventory, hotbar: Hotbar): void {
      this.open_ = true;
      this.stand = stand;
      this.inventory = inventory;
      this.hotbar = hotbar;
      if (this.root !== null) {
        this.root.style.display = "flex";
        this.render();
      }
    }

    /** Close; return any cursor-held stack to the inventory (no item loss). */
    close(): void {
      this.open_ = false;
      this.returnCursorToInventory();
      if (this.root !== null) this.root.style.display = "none";
    }

    private returnCursorToInventory(): void {
      if (this.cursor === null || this.inventory === null) return;
      const leftover = this.inventory.add(this.cursor);
      this.cursor = leftover > 0 ? { ...this.cursor, count: leftover } : null;
    }

    /** Read the bound stand's slot. */
    private standGet(slot: StandSlot): ItemStack | null {
      if (this.stand === null) return null;
      return this.stand[slot];
    }

    /** Write the bound stand's slot. */
    private standSet(slot: StandSlot, stack: ItemStack | null): void {
      if (this.stand === null) return;
      this.stand[slot] = stack;
    }

    /** Left-click a stand input slot: cursor<->slot via applySlotClick. */
    private onStandSlotClick(slot: StandSlot): void {
      if (this.stand === null) return;
      if (slot === "output") {
        // Collect-only: pull the finished potion onto the cursor; NEVER deposit.
        const out = this.standGet("output");
        if (out === null) return;
        if (this.cursor === null) {
          // Empty hand → take the whole output stack.
          this.cursor = { ...out };
          this.standSet("output", null);
        } else if (this.cursor.itemId === out.itemId) {
          // Same item → merge output INTO the cursor (cursor is the destination).
          // applySlotClick(cursor=out, slot=cursor) tops up `slot` (our cursor)
          // and returns the remainder as `cursor` (stays in output).
          const merged = applySlotClick(out, this.cursor);
          this.cursor = merged.slot; // topped-up cursor
          this.standSet("output", merged.cursor); // remainder stays in output
        }
        // Different item in hand → do nothing (collect-only, no swap/deposit).
        this.rerender();
        return;
      }
      const r = applySlotClick(this.cursor, this.standGet(slot));
      this.cursor = r.cursor;
      this.standSet(slot, r.slot);
      this.rerender();
    }

    /** Right-click a stand input slot: place one via applyRightClick. */
    private onStandSlotRightClick(slot: StandSlot): void {
      if (this.stand === null || slot === "output") return;
      const r = applyRightClick(this.cursor, this.standGet(slot));
      this.cursor = r.cursor;
      this.standSet(slot, r.slot);
      this.rerender();
    }

    /** Left-click a player inventory slot: cursor<->slot via applySlotClick. */
    private onInventorySlotClick(index: number): void {
      if (this.inventory === null) return;
      const r = applySlotClick(this.cursor, this.inventory.get(index));
      this.cursor = r.cursor;
      this.inventory.set(index, r.slot);
      this.rerender();
    }

    private onInventorySlotRightClick(index: number): void {
      if (this.inventory === null) return;
      const r = applyRightClick(this.cursor, this.inventory.get(index));
      this.cursor = r.cursor;
      this.inventory.set(index, r.slot);
      this.rerender();
    }

    private rerender(): void {
      this.render();
    }

    /** Re-render slots + progress + cursor. Called each frame while open. */
    render(): void {
      if (!hasDom() || this.root === null) return;
      const fill = (el: HTMLElement | undefined, stack: ItemStack | null): void => {
        if (el === undefined) return;
        const v = slotView(stack);
        el.title = v.name;
        el.style.backgroundImage = "";
        if (v.empty) { el.textContent = ""; return; }
        const icon = getAtlasIconStyle(stack!.itemId);
        if (icon !== null) {
          el.textContent = "";
          el.style.backgroundImage = icon.backgroundImage;
          el.style.backgroundSize = icon.backgroundSize;
          el.style.backgroundPosition = icon.backgroundPosition;
          el.style.imageRendering = icon.imageRendering;
          const c = document.createElement("span");
          c.className = "slot-count";
          c.textContent = String(v.count);
          el.appendChild(c);
        } else {
          el.textContent = `${v.label} ${String(v.count)}`;
        }
      };
      fill(this.standCells.base, this.standGet("base"));
      fill(this.standCells.ingredient, this.standGet("ingredient"));
      fill(this.standCells.fuel, this.standGet("fuel"));
      fill(this.standCells.output, this.standGet("output"));
      if (this.inventory !== null) {
        for (let i = 0; i < Inventory.SLOTS; i++) {
          fill(this.invSlots[i], this.inventory.get(i));
        }
      }
      if (this.progressEl !== null && this.stand !== null) {
        const pct = Math.round((this.stand.brewProgress / BREW.TICKS_PER_BREW) * 100);
        this.progressEl.textContent = `Brewing: ${String(pct)}%`;
      }
      this.renderCursor();
    }

    private renderCursor(): void {
      if (this.cursorEl === null) return;
      if (this.cursor === null || this.cursor.count <= 0) {
        this.cursorEl.style.display = "none";
        return;
      }
      const v = slotView(this.cursor);
      this.cursorEl.textContent = `${v.label} ${String(v.count)}`;
      this.cursorEl.style.display = "block";
    }

    private build(): void {
      // Reuse the workbench scaffolding: host resolution (inventory-root → hud →
      // body), the fixed full-screen overlay container with id
      // "brewing-stand-screen", a panel with a "Brewing Stand" title, a row of
      // four labeled stand-slot cells wired to onStandSlotClick /
      // onStandSlotRightClick (contextmenu, preventDefault), the progress line,
      // the 9×4 inventory grid wired to onInventorySlotClick /
      // onInventorySlotRightClick, the floating cursorEl tracked on mousemove,
      // and a document keydown handler that returns the cursor to the inventory
      // on Escape. (Copy workbench-screen.ts build() and swap the 3×3 craft grid
      // for the four named stand cells; styling via styleSlot.)
    }
  }
  ```
  (NOTE for the implementer: the `build()` body above is described, not pasted, to avoid duplicating ~120 lines of identical scaffolding — copy `workbench-screen.ts` `build()` verbatim and make the three swaps named in the comment. The slot-click semantics ARE fully specified in `onStandSlotClick`/`onStandSlotRightClick`/`onInventorySlot*`. Keep `styleSlot`/`fillSlot` local copies or import-share them; either is fine as long as `hasDom()` guards hold.)
- [ ] **(CODE, LIVE-QA)** Instantiate the screen + the registry in `src/main.ts`. Before (L470–471):
  ```ts
  const workbenchScreen = new WorkbenchScreen();
  const helpOverlay = new HelpOverlay();
  ```
  After:
  ```ts
  const workbenchScreen = new WorkbenchScreen();
  const brewingStandScreen = new BrewingStandScreen();
  /** Live registry of placed brewing stands (per-coords; persisted at v7). */
  let brewingStands = new BrewingStands();
  const helpOverlay = new HelpOverlay();
  ```
  (Add `import { BrewingStandScreen } from "./ui/brewing-stand-screen";` and `import { BrewingStands } from "./crafting/brewing-stands";` to the import block. `brewingStands` is a `let` — `restoreFromSave` REPLACES it with the rehydrated registry, mirroring how mobs are loaded into the manager.)
- [ ] **(CODE, LIVE-QA)** Gate the screen in `uiBlockingGameplay()`. Before (L502–511):
  ```ts
  function uiBlockingGameplay(): boolean {
    return (
      inventoryScreen.isOpen() ||
      pauseMenu.isOpen() ||
      deathState.isShown() ||
      settingsScreen.isOpen() ||
      workbenchScreen.isOpen() ||
      helpOverlay.isOpen()
    );
  }
  ```
  After:
  ```ts
  function uiBlockingGameplay(): boolean {
    return (
      inventoryScreen.isOpen() ||
      pauseMenu.isOpen() ||
      deathState.isShown() ||
      settingsScreen.isOpen() ||
      workbenchScreen.isOpen() ||
      brewingStandScreen.isOpen() ||
      helpOverlay.isOpen()
    );
  }
  ```
- [ ] **(CODE, LIVE-QA)** Add the Escape close branch after the workbench branch in the Escape chain. Before (L583–586):
  ```ts
      } else if (workbenchScreen.isOpen()) {
        workbenchScreen.close();
      } else if (inventoryScreen.isOpen()) {
        inventoryScreen.close();
  ```
  After:
  ```ts
      } else if (workbenchScreen.isOpen()) {
        workbenchScreen.close();
      } else if (brewingStandScreen.isOpen()) {
        brewingStandScreen.close();
      } else if (inventoryScreen.isOpen()) {
        inventoryScreen.close();
  ```
- [ ] **(CODE, LIVE-QA)** Add the RMB-on-`BREWING_STAND` branch after the BED branch in `handleClick`. Before (L794–796):
  ```ts
        return;
      }
      // Route the right-click by held-item kind BEFORE falling through to place.
  ```
  After (bind the SPECIFIC stand at the targeted block coords via the registry, so the screen edits the persisted per-coords stand):
  ```ts
        return;
      }
      // RMB on a brewing stand → open the brewing UI for THAT placed stand (do
      // NOT place a block). The target block coords come from the same raycast
      // hit used elsewhere in handleClick — bind the registry's stand at those
      // integer coords (getOrCreate registers a fresh one on first open).
      if (targetBlock === Blocks.BREWING_STAND) {
        const stand = brewingStands.getOrCreate(
          targetCell.x,
          targetCell.y,
          targetCell.z,
        );
        brewingStandScreen.open(stand, player.inventory, player.hotbar);
        releasePointer();
        return;
      }
      // Route the right-click by held-item kind BEFORE falling through to place.
  ```
  (VERIFY the exact name of the targeted-block integer coords in `handleClick` — the existing BED/crafting-table branches already read the hit cell; reuse that SAME variable, named `targetCell`/`hit.block`/etc. here, rather than re-raycasting. Grep the BED branch first.)
- [ ] **(CODE, LIVE-QA)** Tick the whole registry each fixed tick and rerender the screen. Add the tick alongside `advance(clock, 1)` (stands tick always, like real placed blocks; the loop is frozen while a modal is open anyway). After `advance(clock, 1);` (L1020):
  ```ts
      advance(clock, 1);
      brewingStands.tickAll();
  ```
  Then add the rerender next to the workbench rerender. Before (L1103–1105):
  ```ts
    if (workbenchScreen.isOpen()) {
      workbenchScreen.render(player.inventory, player.hotbar);
    }
  ```
  After:
  ```ts
    if (workbenchScreen.isOpen()) {
      workbenchScreen.render(player.inventory, player.hotbar);
    }
    if (brewingStandScreen.isOpen()) {
      brewingStandScreen.render();
    }
  ```
- [ ] **(CODE, LIVE-QA)** Rehydrate the registry from the save in `restoreFromSave()`. Add next to the mob-load line (L429–430) in `src/main.ts`. Before:
  ```ts
    // Live mobs (save v2+; absent on older saves → empty list).
    mobDriver.manager.load(deserializeMobs(save.mobs ?? []));
  ```
  After:
  ```ts
    // Live mobs (save v2+; absent on older saves → empty list).
    mobDriver.manager.load(deserializeMobs(save.mobs ?? []));

    // Placed brewing stands (save v7+; absent on older saves → empty registry).
    brewingStands = BrewingStands.fromSave(save.brewingStands ?? []);
  ```
- [ ] **(CODE, LIVE-QA)** Thread the registry into the save. In `src/game/persistence.ts`, add a trailing optional `brewingStands?` param to `buildWorldSave` + `saveGame` (mirroring the trailing `mobs?` param) and snapshot it. Before (`buildWorldSave` signature + return, L93–134):
  ```ts
  export function buildWorldSave(
    world: World,
    player: Player,
    clock: Clock,
    view: ViewAngles,
    mobs?: MobManager,
  ): WorldSave {
  ```
  After:
  ```ts
  export function buildWorldSave(
    world: World,
    player: Player,
    clock: Clock,
    view: ViewAngles,
    mobs?: MobManager,
    brewingStands?: BrewingStands,
  ): WorldSave {
  ```
  And in the returned object literal (after `mobs: ...`):
  ```ts
    return {
      version: SAVE_VERSION,
      seed: world.seed,
      totalTicks: clock.totalTicks,
      player: playerSave,
      columns,
      mobs: mobs === undefined ? [] : serializeMobs(mobs.all()),
      brewingStands: brewingStands === undefined ? [] : brewingStands.toSave(),
    };
  ```
  Mirror the same trailing optional `brewingStands?: BrewingStands` param on `saveGame` and forward it to `buildWorldSave`. (Add `import { BrewingStands } from "../crafting/brewing-stands";` to `persistence.ts`.)
- [ ] **(CODE, LIVE-QA)** Pass the registry at the `saveGame` call site in `requestSave()` (`src/main.ts`, L1169). Before:
  ```ts
    const ok = await saveGame(
      store,
      world,
      player,
      clock,
      currentView(),
      mobDriver.manager,
    );
  ```
  After:
  ```ts
    const ok = await saveGame(
      store,
      world,
      player,
      clock,
      currentView(),
      mobDriver.manager,
      brewingStands,
    );
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/ui/screen-state.test.ts src/save` → green (additive gate; serialize/migration v7 round-trips pass).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(VERIFY)** `corepack pnpm build` → production build succeeds (catches the new screen's Babylon/DOM wiring).
- [ ] **(LIVE-QA)** Place a brewing stand, RMB → the interactive overlay opens (gameplay freezes). Click a Water Bottle from your inventory onto the Base slot, a Nether Wart onto Ingredient, Blaze Powder onto Fuel; the progress readout advances; after ~20 s a Potion of Regeneration appears in Output; left-click it to collect onto the cursor, then click an inventory slot to store it. Escape closes (cursor returns to inventory, no item loss). SAVE (F5), reload the page → the stand reopens with the SAME in-progress contents / progress (brews survived reload). Manual.
- [ ] **Commit:** `feat(brewing): interactive load/collect screen + per-stand tick + save/restore`

---

### Task 10: Splash-potion AoE selection + entity/physics/manager (pure; tests FIRST)

Clone the Arrow stack into `src/potions/` for thrown splash potions, plus a pure AoE radius selector. A `SplashPotion` carries a `potionEffect`; `splashPotionStep` reuses the Arrow physics shape but a block OR mob hit means BURST. The AoE selector is pure (testable without the engine).

**Files:**
- Create: `src/potions/entity.ts`, `src/potions/physics.ts`, `src/potions/manager.ts`, `src/potions/aoe.ts`
- Create: `src/potions/entity.test.ts`, `src/potions/physics.test.ts`, `src/potions/manager.test.ts`, `src/potions/aoe.test.ts`
- Modify: `src/rules/mc-1.20.ts` (add `SPLASH` + `SPLASH_POTION_CAP` near `ARROW`)

**Must-protect:**
- `arrows/*.test.ts` — `Arrow`/`arrowStep`/`ArrowManager`/`ARROW.*`/`ARROW_CAP` are UNCHANGED; the splash stack is a parallel CLONE (new files), never an edit to the arrow modules. `splashPotionStep` is a NEW function, not a modified `arrowStep`.
- `raycast.ts` `raycastVoxel` + `mob-driver.ts` `pickMob` — reused unchanged (imported by `splashPotionStep`).
- mc-1.20 G4: `SPLASH.*` + `SPLASH_POTION_CAP` are new consts; do NOT reuse `ARROW_CAP`.
- Mobs have NO `EffectState` — the AoE selector returns target POSITIONS + a player-in-range flag; effect application (player) vs damage (mobs) is decided by the caller in Task 12. The selector itself never mutates a mob.

Steps:

- [ ] **(CODE)** Add splash constants to `src/rules/mc-1.20.ts`, after the `ARROW` block (L370). Insert:
  ```ts
  /** Max simultaneous in-flight splash potions (pooled/capped; separate from arrows). */
  export const SPLASH_POTION_CAP = 8 as const;

  /** Splash-potion ballistics + burst (blocks/tick at 20 TPS). */
  export const SPLASH = {
    /** Throw speed (blocks/tick). Slower + heavier-arced than an arrow. */
    SPEED: 1.2,
    /** Per-tick gravity on vy. */
    GRAVITY: 0.05,
    /** Per-tick air drag multiplier. */
    DRAG: 0.99,
    /** Spawn offset past the eye so it clears the body. */
    SPAWN_OFFSET: 0.5,
    /** AoE radius (blocks) of the burst effect/damage. */
    RADIUS: 4,
    /** Instant-damage half-hearts dealt to mobs in range on burst (splash harm). */
    MOB_DAMAGE: 4,
    /** Ticks a splash potion may fly before auto-despawn. */
    MAX_AGE: 200,
  } as const;
  ```
- [ ] **(CODE, UNIT)** Create `src/potions/aoe.ts`:
  ```ts
  /**
   * aoe.ts — PURE radius selection for splash-potion bursts (Phase 6b).
   *
   * Mobs have NO EffectState, so the burst applies the potion EFFECT to the
   * player (when in range) and plain instant DAMAGE to mobs in range. This module
   * only SELECTS targets by distance; the caller (main.ts) decides effect vs
   * damage. No mutation here.
   */

  import type { Vec3, Mob } from "../mobs/entity";

  /** Euclidean distance from `a` to `b`. */
  function dist(a: Vec3, b: Vec3): number {
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }

  /** True iff `point` is within `radius` blocks of `center`. */
  export function withinRadius(center: Vec3, point: Vec3, radius: number): boolean {
    return dist(center, point) <= radius;
  }

  /**
   * Select burst targets. Returns the mobs whose body-center (feet.y + 0.5) is
   * within `radius` of the burst center, and whether the player (by feet) is in
   * range. Pure: never mutates the mobs.
   */
  export function splashTargets(
    center: Vec3,
    playerFeet: Vec3,
    mobs: readonly Mob[],
    radius: number,
  ): { mobs: Mob[]; playerInRange: boolean } {
    const hitMobs: Mob[] = [];
    for (const m of mobs) {
      const body: Vec3 = { x: m.feet.x, y: m.feet.y + 0.5, z: m.feet.z };
      if (withinRadius(center, body, radius)) hitMobs.push(m);
    }
    return { mobs: hitMobs, playerInRange: withinRadius(center, playerFeet, radius) };
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/potions/aoe.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { withinRadius, splashTargets } from "./aoe";
  import { Mob } from "../mobs/entity";

  function mobAt(x: number, y: number, z: number): Mob {
    const m = new Mob(1, "zombie", { x, y, z });
    return m;
  }

  describe("withinRadius", () => {
    it("inclusive at the boundary", () => {
      expect(withinRadius({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, 4)).toBe(true);
      expect(withinRadius({ x: 0, y: 0, z: 0 }, { x: 4.1, y: 0, z: 0 }, 4)).toBe(false);
    });
  });

  describe("splashTargets", () => {
    it("selects only mobs within radius and flags player range", () => {
      const center = { x: 0, y: 0, z: 0 };
      const near = mobAt(1, 0, 0);
      const far = mobAt(20, 0, 0);
      const out = splashTargets(center, { x: 2, y: 0, z: 0 }, [near, far], 4);
      expect(out.mobs).toEqual([near]);
      expect(out.playerInRange).toBe(true);
    });
    it("player out of range → false", () => {
      const out = splashTargets({ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, [], 4);
      expect(out.playerInRange).toBe(false);
      expect(out.mobs).toEqual([]);
    });
  });
  ```
  (Construct `Mob` per its real constructor — verify the exact signature `new Mob(id, type, feet)` against `src/mobs/entity.ts` before finalizing; adjust the helper if the constructor differs.)
- [ ] **(CODE, UNIT)** Create `src/potions/entity.ts`:
  ```ts
  /**
   * entity.ts — the thrown SplashPotion entity (Phase 6b). Cloned from the
   * kinematic Arrow: position + velocity, swept per tick by splashPotionStep. It
   * carries the potion effect to apply in a radius on burst. No health/AI.
   */

  import type { Vec3 } from "../mobs/entity";
  import type { EffectType } from "../effects/status";
  import { SPLASH } from "../rules/mc-1.20";

  /** The effect a splash potion delivers on burst. */
  export interface SplashEffect {
    type: EffectType;
    amplifier: number;
    durationTicks: number;
  }

  /** A single in-flight (or just-burst) splash potion. */
  export class SplashPotion {
    readonly id: number;
    feet: Vec3;
    velocity: Vec3;
    /** True once it has hit a block or mob and applied its AoE (pending cleanup). */
    burst: boolean;
    age: number;
    readonly effect: SplashEffect;

    constructor(id: number, origin: Vec3, velocity: Vec3, effect: SplashEffect) {
      this.id = id;
      this.feet = { x: origin.x, y: origin.y, z: origin.z };
      this.velocity = { x: velocity.x, y: velocity.y, z: velocity.z };
      this.burst = false;
      this.age = 0;
      this.effect = effect;
    }

    isDone(maxAge: number): boolean {
      return this.burst || this.age >= maxAge;
    }
  }

  /** Compute the spawn origin + velocity from an eye + aim dir + speed. */
  export function launchSplashFrom(
    eye: Vec3,
    aimDir: Vec3,
    speed: number = SPLASH.SPEED,
  ): { origin: Vec3; velocity: Vec3 } {
    const len = Math.hypot(aimDir.x, aimDir.y, aimDir.z) || 1;
    const nx = aimDir.x / len;
    const ny = aimDir.y / len;
    const nz = aimDir.z / len;
    const origin: Vec3 = {
      x: eye.x + nx * SPLASH.SPAWN_OFFSET,
      y: eye.y + ny * SPLASH.SPAWN_OFFSET,
      z: eye.z + nz * SPLASH.SPAWN_OFFSET,
    };
    const velocity: Vec3 = { x: nx * speed, y: ny * speed, z: nz * speed };
    return { origin, velocity };
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/potions/physics.ts`:
  ```ts
  /**
   * physics.ts — PURE per-tick splash-potion step (Phase 6b). Cloned from
   * arrowStep's gravity/drag/DDA sweep, but a block OR mob hit means BURST (the
   * caller applies the AoE this tick, then despawns). Reuses raycastVoxel +
   * pickMob unchanged.
   */

  import type { Vec3, Mob } from "../mobs/entity";
  import { raycastVoxel, type BlockQuery } from "../interaction/raycast";
  import { pickMob } from "../game/mob-driver";
  import { SPLASH } from "../rules/mc-1.20";

  /** What the splash potion did this tick. */
  export type SplashHit = { kind: "none" } | { kind: "burst"; at: Vec3 };

  function dist(a: Vec3, b: Vec3): number {
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }

  /**
   * Advance `potion` one tick against blocks + mobs. On a block or mob hit, sets
   * potion.burst and returns { kind: "burst", at } with the burst center. With no
   * hit, advances the full segment.
   */
  export function splashPotionStep(
    potion: { feet: Vec3; velocity: Vec3; age: number; burst: boolean },
    getBlock: BlockQuery,
    mobs: Mob[],
  ): SplashHit {
    potion.age++;
    potion.velocity.x *= SPLASH.DRAG;
    potion.velocity.z *= SPLASH.DRAG;
    potion.velocity.y = potion.velocity.y * SPLASH.DRAG - SPLASH.GRAVITY;

    const from: Vec3 = { x: potion.feet.x, y: potion.feet.y, z: potion.feet.z };
    const seg: Vec3 = { x: potion.velocity.x, y: potion.velocity.y, z: potion.velocity.z };
    const segLen = Math.hypot(seg.x, seg.y, seg.z);
    if (segLen === 0) return { kind: "none" };
    const dir: Vec3 = { x: seg.x / segLen, y: seg.y / segLen, z: seg.z / segLen };

    const blockHit = raycastVoxel(from, dir, segLen, getBlock);
    const blockDist =
      blockHit === null
        ? Number.POSITIVE_INFINITY
        : dist(from, {
            x: blockHit.block.x + 0.5,
            y: blockHit.block.y + 0.5,
            z: blockHit.block.z + 0.5,
          });
    const mob = pickMob(from, dir, Math.min(segLen, blockDist), mobs);

    if (mob !== null) {
      const at: Vec3 = { x: mob.feet.x, y: mob.feet.y + 0.5, z: mob.feet.z };
      potion.feet = at;
      potion.burst = true;
      potion.velocity = { x: 0, y: 0, z: 0 };
      return { kind: "burst", at };
    }
    if (blockHit !== null) {
      const at: Vec3 = {
        x: blockHit.previous.x + 0.5,
        y: blockHit.previous.y + 0.5,
        z: blockHit.previous.z + 0.5,
      };
      potion.feet = at;
      potion.burst = true;
      potion.velocity = { x: 0, y: 0, z: 0 };
      return { kind: "burst", at };
    }

    potion.feet = { x: from.x + seg.x, y: from.y + seg.y, z: from.z + seg.z };
    return { kind: "none" };
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/potions/manager.ts`:
  ```ts
  /**
   * manager.ts — registry of live splash potions (Phase 6b). Mirrors ArrowManager
   * (Map<number, SplashPotion>, monotonic ids) with its OWN cap (SPLASH_POTION_CAP,
   * separate from ARROW_CAP).
   */

  import type { Vec3 } from "../mobs/entity";
  import { SplashPotion, type SplashEffect } from "./entity";
  import { SPLASH_POTION_CAP } from "../rules/mc-1.20";

  /** True iff another splash potion may be thrown given the current live count. */
  export function canThrowSplash(currentCount: number): boolean {
    return currentCount < SPLASH_POTION_CAP;
  }

  export class SplashPotionManager {
    readonly potions: Map<number, SplashPotion> = new Map();
    private nextId = 1;

    spawn(origin: Vec3, velocity: Vec3, effect: SplashEffect): SplashPotion {
      const id = this.nextId++;
      const p = new SplashPotion(id, origin, velocity, effect);
      this.potions.set(id, p);
      return p;
    }

    despawn(id: number): boolean {
      return this.potions.delete(id);
    }

    all(): SplashPotion[] {
      return [...this.potions.values()];
    }

    count(): number {
      return this.potions.size;
    }
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/potions/entity.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { SplashPotion, launchSplashFrom, type SplashEffect } from "./entity";
  import { SPLASH } from "../rules/mc-1.20";

  const FX: SplashEffect = { type: "poison", amplifier: 0, durationTicks: 200 };

  describe("SplashPotion", () => {
    it("carries its effect and is not burst at spawn", () => {
      const p = new SplashPotion(1, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, FX);
      expect(p.effect).toBe(FX);
      expect(p.burst).toBe(false);
      expect(p.isDone(SPLASH.MAX_AGE)).toBe(false);
    });
    it("isDone once burst", () => {
      const p = new SplashPotion(1, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, FX);
      p.burst = true;
      expect(p.isDone(SPLASH.MAX_AGE)).toBe(true);
    });
  });

  describe("launchSplashFrom", () => {
    it("normalizes aim and offsets the origin past the eye", () => {
      const { origin, velocity } = launchSplashFrom({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 });
      expect(origin.z).toBeCloseTo(SPLASH.SPAWN_OFFSET, 6);
      expect(velocity.z).toBeCloseTo(SPLASH.SPEED, 6);
      expect(velocity.x).toBeCloseTo(0, 6);
    });
  });
  ```
- [ ] **(CODE, UNIT)** Create `src/potions/physics.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { splashPotionStep } from "./physics";
  import { Blocks } from "../rules/mc-1.20";

  const AIR = () => Blocks.AIR;

  describe("splashPotionStep", () => {
    it("advances through air with no hit", () => {
      const p = { feet: { x: 0, y: 10, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, age: 0, burst: false };
      const hit = splashPotionStep(p, AIR, []);
      expect(hit.kind).toBe("none");
      expect(p.burst).toBe(false);
      expect(p.feet.x).toBeGreaterThan(0);
    });
    it("BURSTS on a block hit (does not pass through)", () => {
      // A solid wall at x>=2: getBlock returns STONE for x>=2.
      const getBlock = (bx: number) => (bx >= 2 ? Blocks.STONE : Blocks.AIR);
      const p = { feet: { x: 0, y: 10, z: 0 }, velocity: { x: 3, y: 0, z: 0 }, age: 0, burst: false };
      const hit = splashPotionStep(p, getBlock, []);
      expect(hit.kind).toBe("burst");
      expect(p.burst).toBe(true);
    });
  });
  ```
- [ ] **(CODE, UNIT)** Create `src/potions/manager.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { SplashPotionManager, canThrowSplash } from "./manager";
  import { SPLASH_POTION_CAP } from "../rules/mc-1.20";
  import type { SplashEffect } from "./entity";

  const FX: SplashEffect = { type: "poison", amplifier: 0, durationTicks: 200 };

  describe("SplashPotionManager", () => {
    it("spawns with monotonic ids and tracks count", () => {
      const m = new SplashPotionManager();
      const a = m.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, FX);
      const b = m.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, FX);
      expect(a.id).not.toBe(b.id);
      expect(m.count()).toBe(2);
      m.despawn(a.id);
      expect(m.count()).toBe(1);
    });
    it("canThrowSplash gates at the cap", () => {
      expect(canThrowSplash(0)).toBe(true);
      expect(canThrowSplash(SPLASH_POTION_CAP)).toBe(false);
    });
  });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/potions src/arrows` → all green (new splash stack passes; the arrow suite is untouched).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(potions): splash-potion entity/physics/manager + AoE selector`

---

### Task 11: Splash + tipped item ids + defs (pure registry; tests via existing suites)

Add the splash-potion item variants and the tipped-arrow item. To avoid baking a `splash`/`tipped` flag into many places, reuse `kind:"potion"` for splash variants (they still carry `potionEffect`) but add an `isSplash` discriminator on `ItemDef`; the tipped arrow reuses the arrow's `potionEffect` carrier on the entity, with the item providing the effect descriptor.

**Files:**
- Modify: `src/rules/items.ts` (`ItemDef` L59; `Items` enum after the ingredients from Task 5; `NON_BLOCK_DEFS` after the ingredients; a `splashPotion()` builder; `isSplashPotion`/`tippedArrowEffectOf` accessors)
- Modify: `src/arrows/entity.ts` (`Arrow` optional `potionEffect?`)
- Modify: `src/arrows/manager.ts` (`spawn` optional `tippedEffect?`)

**Must-protect:**
- `items.test.ts` "all 8 potions" + "each potion maps to its correct effect" — the existing 8 `POTION_*` ids/descriptors are UNCHANGED; splash variants are NEW ids at the tail.
- `items.test.ts` "ids unique" / ">= 256" / "registers every declared non-block item" — splash + tipped ids are contiguous from `NON_BLOCK_BASE + 74` (after the 5 ingredients ended at +73) with no gaps.
- `arrows/entity.test.ts` — `Arrow`'s existing fields (`id, feet, velocity, landed, hitMob, shooterId, age`) and `isDone` are UNCHANGED; `potionEffect?` is OPTIONAL with a default of `undefined`, so all existing `new Arrow(...)` calls and `toEqual` shapes still pass.
- `arrows/manager.test.ts` — `spawn(origin, velocity, shooterId?)` keeps its first three params; `tippedEffect?` is a NEW trailing optional, so existing calls compile unchanged.
- No new `EffectType` (splash/tipped reuse existing effects), so `EFFECT_TYPE_IDS` is untouched.

Steps:

- [ ] **(CODE)** Add the `isSplash` discriminator to `ItemDef` in `src/rules/items.ts`. Before (L58–60):
  ```ts
    /** Effect applied when drunk (potions only). `durationTicks` is ignored for instants. */
    potionEffect?: { type: EffectType; amplifier: number; durationTicks: number };
  }
  ```
  After:
  ```ts
    /** Effect applied when drunk (potions only). `durationTicks` is ignored for instants. */
    potionEffect?: { type: EffectType; amplifier: number; durationTicks: number };
    /** True for THROWN splash potions (kind stays "potion"; thrown, not drunk). */
    isSplash?: boolean;
    /** Effect a tipped arrow delivers on hit (tipped-arrow items only). */
    arrowEffect?: { type: EffectType; amplifier: number; durationTicks: number };
  }
  ```
- [ ] **(CODE)** Add the new item ids to `Items` in `src/rules/items.ts`, after the ingredients added in Task 5. Before:
  ```ts
    BLAZE_ROD: NON_BLOCK_BASE + 72,
    BLAZE_POWDER: NON_BLOCK_BASE + 73,
  } as const;
  ```
  After (three splash variants + one tipped arrow; v1 ships a focused splash set, others deferred):
  ```ts
    BLAZE_ROD: NON_BLOCK_BASE + 72,
    BLAZE_POWDER: NON_BLOCK_BASE + 73,

    // Splash potions (Phase 6b). Thrown; burst applies the effect in a radius.
    SPLASH_POTION_HARMING: NON_BLOCK_BASE + 74,
    SPLASH_POTION_POISON: NON_BLOCK_BASE + 75,
    SPLASH_POTION_HEALING: NON_BLOCK_BASE + 76,

    // Tipped arrow (Phase 6b). Carries an effect applied on hit (instant → mob
    // damage bonus; non-instant → player only, mob effects deferred to 6c).
    TIPPED_ARROW: NON_BLOCK_BASE + 77,
  } as const;
  ```
- [ ] **(CODE)** Add a `splashPotion()` builder near the `potion()` builder in `src/rules/items.ts` (after L202):
  ```ts
  function splashPotion(
    id: ItemId,
    name: string,
    type: EffectType,
    amplifier: number,
    durationTicks: number,
  ): ItemDef {
    return {
      id,
      name,
      maxStack: 1,
      kind: "potion",
      isSplash: true,
      potionEffect: { type, amplifier, durationTicks },
    };
  }
  ```
- [ ] **(CODE)** Add the splash + tipped defs to `NON_BLOCK_DEFS` in `src/rules/items.ts`, after the ingredient defs from Task 5. Before:
  ```ts
    material(Items.BLAZE_ROD, "Blaze Rod"),
    material(Items.BLAZE_POWDER, "Blaze Powder"),
  ];
  ```
  After:
  ```ts
    material(Items.BLAZE_ROD, "Blaze Rod"),
    material(Items.BLAZE_POWDER, "Blaze Powder"),

    // Splash potions (thrown). instant_damage / poison / instant_health.
    splashPotion(Items.SPLASH_POTION_HARMING, "Splash Potion of Harming", "instant_damage", 0, 0),
    splashPotion(Items.SPLASH_POTION_POISON, "Splash Potion of Poison", "poison", 0, EFFECT_TUNING.DEFAULT_DURATION),
    splashPotion(Items.SPLASH_POTION_HEALING, "Splash Potion of Healing", "instant_health", 0, 0),

    // Tipped arrow: poison on hit (player-only for non-instant; mob deferred).
    {
      id: Items.TIPPED_ARROW,
      name: "Tipped Arrow (Poison)",
      maxStack: 64,
      kind: "material",
      arrowEffect: { type: "poison", amplifier: 0, durationTicks: EFFECT_TUNING.DEFAULT_DURATION },
    },
  ];
  ```
- [ ] **(CODE)** Add accessors at the bottom of `src/rules/items.ts` (after `potionEffectOf`, L454):
  ```ts
  /** True iff this potion is a THROWN splash potion (vs a drinkable one). */
  export function isSplashPotion(id: ItemId): boolean {
    return getItemDef(id).isSplash === true;
  }

  /** The effect a tipped arrow delivers on hit, or null for plain arrows. */
  export function arrowEffectOf(
    id: ItemId,
  ): { type: EffectType; amplifier: number; durationTicks: number } | null {
    return getItemDef(id).arrowEffect ?? null;
  }
  ```
- [ ] **(CODE)** Add the OPTIONAL `potionEffect?` to `Arrow` in `src/arrows/entity.ts`. Before (L29–40):
  ```ts
    /** Age in ticks since spawn (drives the MAX_AGE despawn). */
    age: number;

    constructor(id: number, origin: Vec3, velocity: Vec3, shooterId = -1) {
      this.id = id;
      this.feet = { x: origin.x, y: origin.y, z: origin.z };
      this.velocity = { x: velocity.x, y: velocity.y, z: velocity.z };
      this.landed = false;
      this.hitMob = false;
      this.shooterId = shooterId;
      this.age = 0;
    }
  ```
  After — add the field + a 5th optional constructor param (existing `new Arrow(id, o, v)` / `new Arrow(id, o, v, shooterId)` calls are unaffected; `potionEffect` defaults to `undefined`):
  ```ts
    /** Age in ticks since spawn (drives the MAX_AGE despawn). */
    age: number;
    /**
     * Optional tipped-arrow effect applied on a mob hit (Phase 6b). undefined for
     * a plain arrow. Adding it OPTIONAL keeps the entity shape back-compatible.
     */
    readonly potionEffect?: { type: EffectType; amplifier: number; durationTicks: number };

    constructor(
      id: number,
      origin: Vec3,
      velocity: Vec3,
      shooterId = -1,
      potionEffect?: { type: EffectType; amplifier: number; durationTicks: number },
    ) {
      this.id = id;
      this.feet = { x: origin.x, y: origin.y, z: origin.z };
      this.velocity = { x: velocity.x, y: velocity.y, z: velocity.z };
      this.landed = false;
      this.hitMob = false;
      this.shooterId = shooterId;
      this.age = 0;
      this.potionEffect = potionEffect;
    }
  ```
  (Add `import type { EffectType } from "../effects/status";` to the entity imports.)
- [ ] **(CODE)** Thread the optional effect through `ArrowManager.spawn` in `src/arrows/manager.ts`. Before (L23–29):
  ```ts
    /** Spawn an arrow; returns it. Caller must gate on canFireArrow() first. */
    spawn(origin: Vec3, velocity: Vec3, shooterId = -1): Arrow {
      const id = this.nextId++;
      const arrow = new Arrow(id, origin, velocity, shooterId);
      this.arrows.set(id, arrow);
      return arrow;
    }
  ```
  After:
  ```ts
    /** Spawn an arrow; returns it. Caller must gate on canFireArrow() first. */
    spawn(
      origin: Vec3,
      velocity: Vec3,
      shooterId = -1,
      tippedEffect?: { type: import("../effects/status").EffectType; amplifier: number; durationTicks: number },
    ): Arrow {
      const id = this.nextId++;
      const arrow = new Arrow(id, origin, velocity, shooterId, tippedEffect);
      this.arrows.set(id, arrow);
      return arrow;
    }
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/rules/items.test.ts src/arrows/entity.test.ts src/arrows/manager.test.ts` → all green (8 potions + descriptors unchanged; new ids unique + >= 256; Arrow shape back-compatible; manager spawn unchanged for existing callers).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(items): splash-potion + tipped-arrow item ids and accessors`

---

### Task 12: Throw splash + tipped-arrow fire + burst AoE wiring (LIVE-QA glue)

Wire splash throwing and burst AoE into `main.ts`, and extend the bow-fire path so tipped arrows pass their effect. On burst: apply the potion effect to the player when in range and deal plain damage to mobs in range (mobs have no effects channel). On a tipped-arrow MOB hit: instant effects add bonus damage; non-instant effects are ignored for mobs.

**Files:**
- Modify: `src/main.ts` (mousedown throw-charge or RMB throw; mouseup throw; bow-fire scan for tipped ammo; splash step + AoE loop after the arrow loop; tipped-arrow hit handling in the arrow loop; splash renderer sync; respawn cleanup of in-flight splashes)
- Create: `src/rendering/splash-renderer.ts`

**Must-protect:**
- The existing `"drink"` path (L820–831) is UNCHANGED — drinkable potions still work. Splash potions are routed by `isSplashPotion` BEFORE the drink branch (RMB throws, does not drink).
- The bow-fire scan (L867–875) keeps accepting `Items.ARROW`; it ADDS acceptance of `Items.TIPPED_ARROW` and passes `arrowEffectOf(itemId)` into `arrowManager.spawn`.
- The arrow tick loop (L1035–1048) keeps `attackMob(hit.mob, currentTick, ARROW.DAMAGE, hit.fromXZ)` for plain arrows; tipped handling is ADDED (instant effect → bonus damage), never replacing the base damage.
- In-flight splash potions are TRANSIENT — no save changes. On respawn, despawn all live splash potions to avoid stale bursts after death.
- `SplashPotionRenderer` follows the `ArrowRenderer` DOM-free Babylon pattern; it is constructed alongside `arrowRenderer` and `sync`'d each frame.

Steps:

- [ ] **(CODE, LIVE-QA)** Create `src/rendering/splash-renderer.ts` mirroring `ArrowRenderer` (a per-id `TransformNode` + a shared translucent `StandardMaterial` sphere). Model it on `src/rendering/arrow-renderer.ts`: constructor `(scene, shadowSink?)`, `sync(potions, nowMs?)` that creates a `CreateSphere` on first sight, repositions live ids, disposes gone ids, and `dispose()`. (Exact Babylon calls mirror `arrow-renderer.ts`; substitute `CreateSphere({ diameter: 0.3 })` for the box and a translucent purple `diffuseColor` + `alpha = 0.6`.)
- [ ] **(CODE, LIVE-QA)** Construct the manager + renderer in `main.ts` next to the arrow ones. Find `const arrowManager = ...` and `const arrowRenderer = ...` and add adjacent:
  ```ts
  const splashManager = new SplashPotionManager();
  const splashRenderer = new SplashPotionRenderer(scene);
  ```
  (Add imports: `import { SplashPotionManager, canThrowSplash } from "./potions/manager";`, `import { launchSplashFrom } from "./potions/entity";`, `import { splashPotionStep } from "./potions/physics";`, `import { splashTargets } from "./potions/aoe";`, `import { SplashPotionRenderer } from "./rendering/splash-renderer";`, `import { SPLASH } from "./rules/mc-1.20";`, and from items: `isSplashPotion`, `arrowEffectOf`, `potionEffectOf`.)
- [ ] **(CODE, LIVE-QA)** Route a held splash potion to a THROW in `handleClick` (RMB), BEFORE the `resolveUse` drink branch. After the brewing-stand RMB branch added in Task 9 and before `const action = resolveUse(...)` (around L800–802):
  ```ts
      const slot = player.hotbar.selected;
      const held = player.inventory.get(slot);
      if (held === null || held.count <= 0) return;
      const def = getItemDef(held.itemId);
      // Splash potion: throw it (do NOT drink). Gated + capped separately.
      if (isSplashPotion(held.itemId)) {
        if (!pointerLocked() || uiBlockingGameplay()) return;
        if (!canThrowSplash(splashManager.count())) return;
        const fx = potionEffectOf(held.itemId);
        if (fx !== null) {
          const eye = player.eyePosition();
          const fwd = camera.getDirection(Vector3.Forward());
          const { origin, velocity } = launchSplashFrom(eye, { x: fwd.x, y: fwd.y, z: fwd.z });
          splashManager.spawn(origin, velocity, fx);
          player.inventory.removeFromSlot(slot, 1);
        }
        return;
      }
      const action = resolveUse(def, { hungry: player.survival.food < HUNGER.MAX_FOOD });
  ```
  (NOTE: this replaces the existing `const slot = ...; const held = ...; const def = ...; const action = resolveUse(...)` preamble at L798–802. Keep the existing lines and INSERT the splash block between `def` and `action`. Verify the exact surrounding lines before editing.)
- [ ] **(CODE, LIVE-QA)** Extend the bow-fire ammo scan to accept tipped arrows in the `mouseup` handler. Before (L866–882):
  ```ts
      // Find the first slot holding arrows (Inventory has no findSlot — scan).
      let arrowSlot = -1;
      for (let i = 0; i < Inventory.SLOTS; i++) {
        const st = player.inventory.get(i);
        if (st !== null && st.itemId === Items.ARROW && st.count > 0) {
          arrowSlot = i;
          break;
        }
      }
      if (arrowSlot < 0) return; // no arrows
      if (!canFireArrow(arrowManager.count())) return; // pooled/capped
      const eye = player.eyePosition();
      const fwd = camera.getDirection(Vector3.Forward());
      const speed = bowChargeToSpeed(chargeMs);
      const { origin, velocity } = launchFrom(eye, { x: fwd.x, y: fwd.y, z: fwd.z }, speed);
      arrowManager.spawn(origin, velocity);
      player.inventory.removeFromSlot(arrowSlot, 1);
  ```
  After — accept plain OR tipped arrows; pass the tipped effect into `spawn`:
  ```ts
      // Find the first slot holding plain OR tipped arrows (scan; first wins).
      let arrowSlot = -1;
      for (let i = 0; i < Inventory.SLOTS; i++) {
        const st = player.inventory.get(i);
        if (
          st !== null &&
          st.count > 0 &&
          (st.itemId === Items.ARROW || st.itemId === Items.TIPPED_ARROW)
        ) {
          arrowSlot = i;
          break;
        }
      }
      if (arrowSlot < 0) return; // no arrows
      if (!canFireArrow(arrowManager.count())) return; // pooled/capped
      const ammo = player.inventory.get(arrowSlot)!;
      const tipped = arrowEffectOf(ammo.itemId) ?? undefined;
      const eye = player.eyePosition();
      const fwd = camera.getDirection(Vector3.Forward());
      const speed = bowChargeToSpeed(chargeMs);
      const { origin, velocity } = launchFrom(eye, { x: fwd.x, y: fwd.y, z: fwd.z }, speed);
      arrowManager.spawn(origin, velocity, -1, tipped);
      player.inventory.removeFromSlot(arrowSlot, 1);
  ```
- [ ] **(CODE, LIVE-QA)** Handle the tipped-arrow effect on a mob hit in the arrow tick loop. Before (L1041–1044):
  ```ts
        if (hit.kind === "mob") {
          attackMob(hit.mob, currentTick, ARROW.DAMAGE, hit.fromXZ);
          gameAudio?.onMobHurt(hit.mob.feet);
        }
  ```
  After — add tipped instant-effect bonus damage (non-instant effects on mobs are deferred; mobs have no EffectState):
  ```ts
        if (hit.kind === "mob") {
          attackMob(hit.mob, currentTick, ARROW.DAMAGE, hit.fromXZ);
          // Tipped arrow: instant effects add bonus damage to the mob. Non-instant
          // effects require a mob EffectState (deferred to 6c) — ignored here.
          const fx = arrow.potionEffect;
          if (fx !== undefined && isInstant(fx.type) && fx.type === "instant_damage") {
            attackMob(hit.mob, currentTick, EFFECT_TUNING.INSTANT_DAMAGE_PER_LEVEL * (fx.amplifier + 1));
          }
          gameAudio?.onMobHurt(hit.mob.feet);
        }
  ```
  (`isInstant` is exported from `effects/status.ts`; `EFFECT_TUNING` from `rules/mc-1.20` — both are likely already imported in main.ts; add them if Grep shows they are not.)
- [ ] **(CODE, LIVE-QA)** Step splash potions + apply burst AoE in the tick loop, immediately AFTER the arrow loop (after L1048). Insert:
  ```ts
      // Step in-flight splash potions: burst on block/mob hit, apply AoE.
      for (const potion of splashManager.all()) {
        const sh = splashPotionStep(
          potion,
          (bx, by, bz) => world.getBlock(bx, by, bz),
          liveMobs,
        );
        if (sh.kind === "burst") {
          const { mobs: hitMobs, playerInRange } = splashTargets(
            sh.at,
            player.feet,
            liveMobs,
            SPLASH.RADIUS,
          );
          // Mobs have no effects channel → plain instant damage on harmful splashes.
          const fx = potion.effect;
          const harmful = fx.type === "instant_damage" || fx.type === "poison";
          if (harmful) {
            for (const m of hitMobs) attackMob(m, currentTick, SPLASH.MOB_DAMAGE);
          }
          // Player in range → apply the real effect (instant or timed).
          if (playerInRange) {
            if (isInstant(fx.type)) {
              applyInstant(player.survival, fx.type, fx.amplifier);
            } else {
              applyEffect(player.effects, fx.type, fx.amplifier, fx.durationTicks);
            }
          }
          gameEffects?.onExplosion?.(sh.at);
        }
        if (potion.isDone(SPLASH.MAX_AGE)) {
          splashManager.despawn(potion.id);
        }
      }
  ```
  (`attackMob`, `applyInstant`, `applyEffect`, `isInstant`, `gameEffects` are in scope in main.ts. If `gameEffects.onExplosion` does not exist, drop that line or use the nearest existing particle hook — verify the `GameEffects` API first; the optional-chaining `?.` makes a missing method safe at runtime but TypeScript needs the method to exist — confirm before finalizing.)
- [ ] **(CODE, LIVE-QA)** Sync the splash renderer each frame, next to the arrow renderer sync. Before (L1113–1114):
  ```ts
    // Reconcile arrow boxes with the live arrow set.
    arrowRenderer.sync(arrowManager.all(), performance.now());
  ```
  After:
  ```ts
    // Reconcile arrow boxes with the live arrow set.
    arrowRenderer.sync(arrowManager.all(), performance.now());
    // Reconcile splash-potion spheres with the live set.
    splashRenderer.sync(splashManager.all(), performance.now());
  ```
- [ ] **(CODE, LIVE-QA)** Despawn in-flight splashes on respawn. In `respawnPlayer()` (already edited in Task 4 for `playerBurningTicks`), add after the burning reset:
  ```ts
    playerBurningTicks = 0; // clear any in-progress burn on death/respawn
    for (const p of splashManager.all()) splashManager.despawn(p.id);
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/potions src/arrows src/rules/items.test.ts` → green (logic unchanged; this task is glue).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors (catches any missing import / wrong `gameEffects` method).
- [ ] **(VERIFY)** `corepack pnpm build` → production build succeeds (catches Babylon/DOM issues the unit suite cannot).
- [ ] **(LIVE-QA)** Run the app: with a Splash Potion of Poison held, RMB throws an arcing sphere that bursts on the ground/a mob; mobs in range take damage; if you throw it at your own feet, you get poisoned. Fire a Tipped Arrow (Poison) at a mob → it takes arrow damage (instant-harm bonus if harming-tipped). Manual.
- [ ] **Commit:** `feat(potions): throw splash potions + tipped arrows with burst AoE`

---

### Task 13: Full regression + live-QA gate

No new code. Run the entire suite + typecheck + build, then the integrated live-QA pass deferred from earlier tasks.

**Files:** none (verification only).

**Must-protect:** the FULL pinned set — `stats.test` strict `makeSurvivalState` shape (NO new field); the 6 `player-damage` cases + the new fire cases; the 5 melee + 2 resistance `mob-driver` pins; `stats.damage(s,6)→14`; the WORLD-GEN invariants — `cave.test` (determinism / surface-integrity / bedrock-safety / "carves some underground air but under half", UNTOUCHED), `terrain.test` (determinism + WATER fill), and `generate.test` "voxel-identical for same coords+seed" determinism + "surface never broken (non-air at surface)" + ore-presence (`oreCount > 0`) — all STILL green with the new `fillDeepLava` stage in the pipeline; the NEW `lava.test` (deterministic same coords+seed; lava ONLY below `LAVA_LEVEL`=10; never alters the surface / never creates air; AIR-only replacement; some lava generated; differs across seeds) + the NEW `generate.test` "deep lava is generated (`y <= 10`)" and "lava never at/above the surface" assertions; `block-registry` completeness + opaque⊕transparent invariants; `items` id-uniqueness + 8-potion descriptors; `recipes` `SMELTING.length===8` / `RECIPES.length>=15`; `furnace` tick model; `BrewingStand` tick + save round-trip; `BrewingStands` registry get-or-create + restore round-trip; `atlas` tile-35 + tile-36 not magenta; `arrows/*` (Arrow shape, `arrowStep`, manager, `ARROW.*`/`ARROW_CAP`); `screen-state`; serialize/migration/persistence round-trips at the NEW `SAVE_VERSION` 7 — the brewing-stands JSON blob round-trips, `MIGRATIONS[6]` seeds `brewingStands: []` for v6 saves, all OLDER-container fixtures (format ≤ 6, omitting `brewingStands`) still decode, and the `SAVE_VERSION === 7` pin in `migration.test.ts` is green.

Steps:

- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run` → the ENTIRE suite green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(VERIFY)** `corepack pnpm build` → production build succeeds.
- [ ] **(LIVE-QA)** Integrated pass (read DESIGN.md first; flag any deviation):
  - Fire: explore down to a deep cave (y ≤ 10) and find a GENERATED lava pool, step in → ~2 HP/s burning DOT that lingers ~1.5 s after leaving; Fire Resistance fully negates it; dying in lava respawns clean.
  - Brewing (FUNCTIONAL + PERSISTED): place a brewing stand, RMB → interactive overlay opens + gameplay freezes; click to LOAD a Water Bottle (base) + Nether Wart (ingredient) + Blaze Powder (fuel); the progress readout advances; a Potion of Regeneration appears in Output; left-click to COLLECT it. Escape closes with the cursor returned to inventory (no item loss). SAVE (F5) + reload → reopening the stand shows the SAME in-progress contents + progress (brews survived reload). Two distinct placed stands keep INDEPENDENT contents.
  - Splash: throw a Splash Potion of Poison → it bursts; nearby mobs take damage; self-splash poisons you.
  - Tipped arrow: fire a Tipped Arrow at a mob → arrow damage applies; harming-tipped adds instant-damage bonus.
- [ ] **Commit:** `test(phase6b): full regression green + live-QA gate passed`

---

## Self-review resolutions (planner)

- **Burning lives in `main.ts` module scope, NOT a struct field.** `SurvivalState` has a strict 7-field `toEqual` pin and `PhysicsState` is vertical-only by contract; adding a burning field to either (or to `Player`) risks the strict-shape tests for zero benefit. A module-level `let playerBurningTicks` exactly mirrors the precedent that the knockback channel sits OUTSIDE `PhysicsState`. The ignite/decay/damage cadence is extracted to PURE `src/combat/fire.ts` so the logic is unit-tested without the engine; only the lava-sampling + `applyPlayerDamage` call is glue.
- **`"fire"` is a full-negate source, distinct from `resistance`.** Fire damage skips armor like `"fall"` (`applyArmor = source !== "fall" && source !== "fire"`) but adds a NEW early `return` when `hasEffect(player.effects, "fire_resistance")` — a FULL negation, not a `resistanceFraction` reduction (those are different `EffectType`s). The gate is keyed on `source === "fire"` only, so the 6 existing `player-damage` pins and the mob-driver melee/resistance pins are byte-identical (they pass no 4th arg or `"fall"`).
- **Lava EXISTED as a block but was UNGENERATED — 6b makes fire REACHABLE.** Verified against the live code: `Blocks.LAVA` (id 24) is fully wired (registry `liquid()` def, `TILE.LAVA = 30`, palette tile, classified `liquid:true/solid:false`), yet world generation NEVER places it (zero `LAVA` refs in `terrain.ts`/`cave.ts`/`generate.ts`; absent from `ORE_TABLE`). So the fire DOT, as originally scoped, would have had NO in-game trigger — a dead feature. 6b adds a NEW deterministic stage `fillDeepLava(column, seed)` (`src/world/lava.ts`) that pools `Blocks.LAVA` into the floors of DEEP caves (`worldY <= LAVA_LEVEL = 10`, near bedrock, far below sea level 64), gated by a seed-derived 3D-noise field for sparse, MC-like lava lakes. It runs as the FINAL column-pipeline stage in `generate.ts` (terrain → caves → ores → lava): ores run first and replace only STONE while lava replaces only AIR, so the two are disjoint and ore is never overwritten. **Determinism is preserved**: `fillDeepLava` is a PURE function of `(column, seed)` with no `Math.random`/`Date`, so `generate.test`'s "voxel-identical for same coords+seed" stays green; a new `lava.test` pins same-seed identity + cross-seed variance. **Surface integrity is preserved**: it only ever turns AIR→LAVA and only at `y <= 10`, never creating air and never touching the surface column, so `generate.test`'s "surface never broken / non-air at surface" + `surfaceHeight` stay green (a new `generate.test` assertion explicitly checks no lava at/above the surface). **The cave sparsity invariant is untouched**: `cave.test` calls `carveCaves` directly, so the new stage never runs in that suite — and `cave.ts` itself is not edited. No existing test pins an exact golden voxel snapshot, so NO intentional design-lock test update is needed; the lava work is purely additive at depth.
- **Burning is TRANSIENT, not persisted (justified).** It is sub-second loop state re-derived the instant the player touches lava; persisting it would add risk for no player-visible benefit (a save/reload mid-burn is indistinguishable from re-igniting). So FIRE adds NO new persisted state of its own — it is zeroed on respawn and re-derived from world contact. (The `SAVE_FORMAT`/`SAVE_VERSION` 6→7 bump that 6b DOES make is driven ENTIRELY by the persisted brewing-stand registry in Task 8, NOT by fire.)
- **Brewing fuel is measured in BREWS, not burn ticks.** Unlike the furnace (`fuelBurnTicks` × tick), one blaze powder grants `BREW.BREWS_PER_BLAZE_POWDER` BREWS; `brewsRemaining` decrements by 1 per COMPLETED brew, not per tick (recon gotcha). `brewProgress` is the per-brew tick counter. The `BrewingStand` class mirrors `Furnace`'s structure (slots + ignite + produce + tick) but with this semantic, and never touches `furnace.ts`/`SMELT`.
- **Brewing recipes + matcher in a SEPARATE file.** `BREWING` + `findBrewing` live in `src/crafting/brew-recipes.ts`, mirroring how furnace smelting sits apart from `recipes.ts`. This keeps `recipes.test`'s pinned `SMELTING.length===8` / `RECIPES.length>=15` and the `matcher` suite untouched. Brew results reuse the EXISTING `POTION_*` ids — no new `EffectType`, so the stable `EFFECT_TYPE_IDS` persistence map is untouched.
- **Brewing is FUNCTIONAL, PER-PLACED-STAND, and PERSISTED (state-ownership decision).** The user upgraded the scope: the player must LOAD ingredients and COLLECT output via the UI, and brews must SURVIVE save/reload. State ownership is a coords-keyed block-entity registry (`BrewingStands` = `Map<"x,y,z", BrewingStand>`), NOT a single global stand. Justification: the recon shows `Furnace` is a PURE-but-UNWIRED class in the live game (no global instance, no screen, no save), so there is NO global-stand precedent to inherit — the "single global stand" idea from the v1 stub plan was grounded in a precedent that does not actually exist in the running game. The per-coords registry is tractable because placed stands are SPARSE (a handful of blocks), so the whole registry flattens to a tiny `BrewingStandEntrySave[]` JSON blob. That blob is added to the save ADDITIVELY behind `SAVE_FORMAT`/`SAVE_VERSION` 6→7 + `MIGRATIONS[6]` (seeding `[]`), trailing the `mobs` blob — EXACTLY mirroring how `mobs` was added in container format 2. `buildWorldSave` snapshots `brewingStands.toSave()` and `restoreFromSave` rehydrates via `BrewingStands.fromSave(...)`. So the brewing-stand BLOCK persists via the existing terrain save AND its in-progress contents persist via the new blob.
- **The brewing screen is INTERACTIVE, reusing the existing cursor-stack helpers.** `BrewingStandScreen` mirrors `WorkbenchScreen` exactly (host-resolution, `hasDom()` guards, floating cursor, Escape-returns-cursor) and moves stacks via the pure `applySlotClick`/`applyRightClick` from `inventory-view.ts` — left-click = pick up / place whole stack, right-click = place one. This is the SIMPLEST genuinely-usable model and is byte-consistent with the workbench. The output slot is collect-only (left-click pulls the finished potion to the cursor; never deposits), preventing the player from jamming junk into the result slot. The screen binds the SAME `BrewingStand` instance the registry ticks, so loads/collects mutate the persisted stand directly.
- **The SAVE_VERSION/SAVE_FORMAT bump is consistent.** Because 6b now persists brewing, BOTH bump 6→7: `SAVE_FORMAT` (container) gates the new blob's write/read, `SAVE_VERSION` (logical) is reached by `MIGRATIONS[6]`. The `migration.test.ts` `SAVE_VERSION === 6` pin becomes `=== 7`, a new test asserts `MIGRATIONS[6]` seeds `brewingStands: []`, and `serialize.test.ts` gains a populated-blob v7 round-trip plus a format-≤6-still-decodes case. The new `brewingStands?` field is OPTIONAL on `WorldSave`, so every existing fixture that omits it still compiles + decodes (absent → `[]`), exactly like an absent `mobs` on a v1 container.
- **Mobs have NO effects channel → splash/tipped scope is PLAYER effects + plain mob DAMAGE.** The recon confirms `Mob` has no `EffectState`. So: splash bursts apply the real effect to the PLAYER when within `SPLASH.RADIUS`, and deal plain instant DAMAGE (`SPLASH.MOB_DAMAGE`) to mobs in range for harmful splashes; tipped arrows add instant-damage bonus to mobs but apply non-instant effects to nobody (player-only on self-hit is the only non-instant path, and is not wired in v1). Inventing a mob status-effect system is explicitly OUT of 6b scope (deferred to 6c).
- **Splash stack is a CLONE of the Arrow stack, never an edit.** `src/potions/{entity,physics,manager}.ts` mirror `arrows/*` with their OWN `SPLASH.*` + `SPLASH_POTION_CAP` constants. `splashPotionStep` is a NEW function (block/mob hit ⇒ BURST), so `arrowStep`/`Arrow`/`ArrowManager`/`ARROW.*` tests stay green untouched. `raycastVoxel`/`pickMob` are reused unchanged.
- **Tipped arrows reuse the Arrow entity additively.** `Arrow` gains an OPTIONAL `potionEffect?` (default `undefined`, shape back-compatible) and `ArrowManager.spawn` gains a trailing optional `tippedEffect?` — both keep every existing `new Arrow(...)`/`spawn(...)` call and `toEqual` shape valid, so the arrow suite stays green.
- **Item-id allocation is contiguous from +69.** Ingredients `+69..+73`, splash variants `+74..+76`, tipped arrow `+77` — no gaps, no collisions, all `>= NON_BLOCK_BASE`, so the `items.test` uniqueness/range/registration tests pass. The 8 existing potions (`+61..+68`) are untouched.
- **New block id is the next sequential integer.** `BREWING_STAND = 29` (after `BED = 28`) keeps `edit.ts`'s `BLOCK_COUNT = Object.keys(Blocks).length` ceiling correct (29→30), gets a `transparentSolid` DEF (satisfies opaque⊕transparent), a `TILE.BREWING_STAND = 36` + palette entry + `MAX_USED_TILE` 35→36 (so it renders instead of gray), a `BLOCK_ITEM_NAMES` key (TS-enforced), and a `BLOCK_HARDNESS` entry. No `BLOCK_MAX_STACK_OVERRIDE` (it stacks to 64), so the `items.test` expected-64 assertion holds.
- **`uiBlockingGameplay()` + Escape chain extended additively.** Adding `brewingStandScreen.isOpen()` to the pure OR-chain and a brewing-stand Escape branch adjacent to the workbench keeps `screen-state.test` green and preserves the close-chain order.
- **Task ordering is pure-before-glue, tests-green-per-task.** Fire: source math (1) → pure reducer (2) → deep-cave lava generation (3) → loop glue (4). Brewing: block+items registry (5) → recipes (6) → tick machine + save round-trip (7) → coords-keyed registry + SAVE_VERSION 6→7 persistence (8) → interactive screen + RMB + tick + save/restore glue (9). Splash/tipped: physics+AoE+manager (10) → item registry (11) → loop glue (12). Full gate (13). The deterministic lava generation (3) lands BEFORE the fire-DOT glue (4), so lava is actually IN the world (and unit-proven deterministic + surface-safe) before the loop tries to detect it. The pure persistence layer (8) lands BEFORE the glue (9), so the save round-trip is unit-proven before any `main.ts` wiring. The highest-value, lowest-risk feature (FIRE) ships first.

## Out of scope (later sub-phases / 6b-deferred — do NOT build here)

- **6c — Mob expansion + perf:** new mob types, AI/pathfinding upgrades, spawn/perf tuning, chunk/mesh optimization. **A MOB `EffectState` channel** (non-instant splash/tipped effects on mobs, `tickEffects` for mobs) is a 6c prerequisite — 6b deliberately scopes non-instant effects to the PLAYER and plain DAMAGE to mobs.
- **6d — PBR:** physically-based materials, normal/roughness maps, lighting overhaul (the brewing-stand + splash-sphere visuals in 6b are flat procedural placeholders).
- **LINGERING potions** (`DRAGON_BREATH`, stationary timed clouds, `LingeringCloud`/cloud-manager/renderer): deferred within 6b — `DRAGON_BREATH` is an End mechanic (G2: no Nether/End) and lingering balloons the AoE surface. The splash AoE selector (`aoe.ts`) is shaped so a future lingering cloud reuses `withinRadius`/`splashTargets`.
- **Drag-to-drop slot interaction in the brewing screen:** 6b ships the full click-to-move model (left-click pick up / place whole stack, right-click place one) via the shared `applySlotClick`/`applyRightClick` helpers — this IS functional load/collect. The press-drag-release motion (`beginDrag`/`applyDragMove`) the workbench also offers is a cosmetic follow-up; click-to-move is genuinely usable on its own.
- **Recovering a placed stand's contents when the BLOCK is broken:** 6b persists per-coords stand contents and exposes `BrewingStands.remove(x,y,z)`, but does NOT yet wire block-break to dump the stand's slots back as drops (or auto-call `remove`). A broken stand's coords-keyed contents linger in the registry until overwritten; wiring break→drop is a small additive follow-up.
- **Multi-stack / 3-bottle brewing output:** real MC brews up to three bottles per cycle; 6b's `BrewingStand` brews a single base→output (potions stack to 1). Widening to three simultaneous base slots is additive (the recipe/matcher already generalizes).
- **Glass-bottle → water-bottle crafting/filling recipe + obtaining ingredients in-world** (nether wart farming, blaze rod drops): the items + brew recipes exist; how the player ACQUIRES them (mob drops, world gen) is out of 6b scope — seed via dev inventory for LIVE-QA.
- **Splash variants beyond harming/poison/healing + tipped variants beyond poison:** the builders + accessors generalize, but 6b ships a focused set; the remaining 5 effect variants are additive later.
- **Non-instant tipped-arrow effects on the player (self-hit):** the entity carries the effect but 6b does not wire a self-hit application path; deferred with mob effects to 6c.
