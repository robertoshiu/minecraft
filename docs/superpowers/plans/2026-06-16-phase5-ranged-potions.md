# Phase 5 — Ranged + Potions: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a status-effect engine + drinkable potions (regeneration, instant heal/harm, poison, resistance, strength, swiftness, fire-resistance) and a BALLISTIC kinematic bow/arrow (charge → launch velocity, per-tick swept DDA vs blocks + AABB vs mobs, pooled/capped) — without widening `SurvivalState`, breaking the 13 regen/starve tests, or touching the pinned combat/persistence behavior.
**Architecture:** Status effects live in a GREENFIELD `effects/status.ts` as an `EffectState` (a list of `{ type, amplifier, ticksRemaining }`) carried on a NEW `player.effects` field — SEPARATE from `SurvivalState` (whose strict `toEqual` shape test forbids new fields). A pure `tickEffects(effects, survival, currentTick)` ticks alongside `tickSurvival` (called from main.ts AFTER `player.update()`), applying regen/poison/instant-heal/harm with their OWN interval counters (regen and poison never reuse `regenTimer`/`starveTimer`; poison writes `health` directly, floored at 1). RESISTANCE folds into the existing `applyPlayerDamage` chokepoint (order: armor → resistance → clamp); STRENGTH is additive at the melee call-site; SWIFTNESS multiplies the walk/sprint speed via a new optional `Player.update(..., speedMultiplier)` arg. Potions are a new `kind:"potion"` ItemDef routed through a new `resolveUse` `"drink"` action; drinking applies the effect and consumes one. The bow/arrow is a kinematic `Arrow` entity (never a physics body) in an `ArrowManager` (pooled/capped via `ARROW_CAP`), stepped per-tick by a pure `arrowStep` (gravity + swept DDA vs voxels + nearest-hit precedence vs mob AABBs) and rendered by an `ArrowRenderer` mirroring `MobRenderer`. Bow charge uses the already-wired `mousedown`/`mouseup` handlers. Persistence adds an additive `effects: EffectSave[]` field behind `SAVE_FORMAT` 4→5 and `SAVE_VERSION` 4→5 (`MIGRATIONS[4]` seeds `[]`); in-flight arrows are NOT persisted. DEFERRED to Phase 6: the brewing stand (potions are SEEDED into the default inventory like the Phase-4 starter armor).
**Tech Stack:** Babylon.js 8, TypeScript, Vite, Vitest

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `src/effects/status.ts` | **Create** | Greenfield status-effect engine: `EffectType`, `ActiveEffect`, `EffectState`, `applyEffect` (replace/refresh), `tickEffects` (regen/poison/instant + reverse-iterate expiry). |
| `src/effects/status.test.ts` | **Create** | Unit tests: stack/replace/refresh, reverse-iterate expiry, regen/poison/instant interaction with `SurvivalState`, resistance/strength/swiftness accessor math. |
| `src/rules/mc-1.20.ts` | **Modify** (after `MOB_CAP` ~line 315) | Add `ARROW_CAP`, `ARROW_GRAVITY` reuse note, and `EFFECT_TUNING` (durations, intervals, instant amounts, per-amplifier deltas). |
| `src/rules/items.ts` | **Modify** (ItemDef union L43; `Items` enum tail L125; `potion()` builder ~L167; `NON_BLOCK_DEFS` tail L292; accessors tail L390) | Add `kind:"potion"` + `potionEffect` field; `BOW`/`ARROW`/8 potion ids; `potion()` builder; defs; `isPotion`/`potionEffectOf` accessors. |
| `src/rules/items.test.ts` | **Modify** (append) | New bow/arrow/potion invariant tests; existing id/≥256/registered invariants stay green. |
| `src/interaction/use-item.ts` | **Modify** (`UseAction` L16; `resolveUse` L37) | Add `"drink"` action; route `kind:"potion"` → drink BEFORE armor/place. |
| `src/interaction/use-item.test.ts` | **Modify** (append) | Test potion → `{kind:"drink"}`; bow stays `use-other`. |
| `src/player/controller.ts` | **Modify** (fields L63–81; `update` signature L99; speed line L126) | Add `readonly effects: EffectState` field; add optional `speedMultiplier` arg to `update`. |
| `src/game/mob-driver.ts` | **Modify** (`applyPlayerDamage` L519–538; melee site stays in main.ts) | Insert resistance stage between armor and the zero-check; read resistance level from the player's effects. |
| `src/game/mob-driver.test.ts` | **Modify** (append; existing `applyPlayerDamage`/`attackMob` suites untouched) | Resistance-reduces-damage + resistance-reduced-to-zero-skips-durability tests. |
| `src/save/serialize.ts` | **Modify** (`PlayerSave` L41; `EffectSave` near L51; `SAVE_FORMAT` L194; `writePlayer` L388; `readPlayer` L457/L473) | Add `effects` to `PlayerSave` + `EffectSave` interface; `SAVE_FORMAT` 4→5; write/read effects block. |
| `src/save/serialize.test.ts` | **Modify** (extend both `samplePlayer()` and `samplePlayerMin()`; round-trip) | Add `effects` to fixtures; assert round-trip. |
| `src/save/migration.ts` | **Modify** (`SAVE_VERSION` L14; `MIGRATIONS` L52) | `SAVE_VERSION` 4→5; add `MIGRATIONS[4]` seeding `effects:[]`. |
| `src/save/migration.test.ts` | **Modify** (`emptyPlayer()` L25; pin L116; add v4→v5 test) | Add `effects:[]` to `emptyPlayer`; update pin to 5; add `MIGRATIONS[4]` test. |
| `src/game/persistence.ts` | **Modify** (`snapshotEffects` near L59; `buildWorldSave` L99) | `snapshotEffects(player)` + `effects` in `playerSave`. |
| `src/inventory/default-inventory.ts` | **Modify** | Seed BOW (slot 13), ARROW×32 (14), 3 potions (15–17). |
| `src/inventory/default-inventory.test.ts` | **Modify** (extend; slots 0–12 pinned) | Assert the new bow/arrow/potion slots. |
| `src/arrows/entity.ts` | **Create** | `Arrow` kinematic entity: `id`, `feet`, `velocity`, `landed`, `hit`, `shooterId`, `age`; `ARROW_WIDTH`/`ARROW_HEIGHT`; `bowChargeToSpeed`. |
| `src/arrows/entity.test.ts` | **Create** | Unit tests: charge→speed clamp/scale; spawn offset. |
| `src/arrows/physics.ts` | **Create** | Pure `arrowStep(arrow, getBlock, mobs, currentTick)`: gravity + swept DDA vs voxels + nearest mob-AABB hit precedence; returns a hit descriptor. |
| `src/arrows/physics.test.ts` | **Create** | Unit tests: gravity arc, block hit (no tunneling), mob hit, nearest-of-both precedence, miss/expiry. |
| `src/arrows/manager.ts` | **Create** | `ArrowManager`: `Map<number,Arrow>`, monotonic `nextId`, `spawn`/`despawn`/`all`/`count`; `canFireArrow(count)` cap helper. |
| `src/arrows/manager.test.ts` | **Create** | Unit tests: monotonic-never-reused ids, cap gate, snapshot. |
| `src/rendering/arrow-renderer.ts` | **Create** | `ArrowRenderer` mirroring `MobRenderer`: one elongated box per arrow, oriented along velocity; immediate dispose on landing. |
| `src/rendering/arrow-renderer.test.ts` | **Create** | Unit tests: create/reposition/dispose lifecycle; single shared material. |
| `src/main.ts` | **Modify** (imports; restore L398; tick loop L923; render L986; mouse handlers L783–789; RMB use handler L744; player.update calls L916) | Wire `tickEffects` into the tick loop; drink branch; bow charge mousedown/mouseup; per-tick arrow stepping; arrow rendering; effects restore; swiftness multiplier into `player.update`. |

---

### Task 1: Greenfield status-effect engine (`effects/status.ts`)

Pure stack/replace/refresh + tick engine. Fully UNIT-testable; no Babylon. CRITICAL: effects live in a NEW `EffectState`, NOT in `SurvivalState` — the `makeSurvivalState()` strict `toEqual<SurvivalState>` test (stats.test.ts:17–25) forbids new survival fields, and the 13 regen/starve tests must stay byte-identical.

**Files:**
- Create: `src/effects/status.ts`, `src/effects/status.test.ts`
- Modify: `src/rules/mc-1.20.ts` (add `EFFECT_TUNING` after `MOB_CAP`)

**Must-protect:**
- `stats.test.ts` `makeSurvivalState` `toEqual<SurvivalState>({...})` (L17–25) — `SurvivalState` gains NO new field; the engine carries its own state object.
- The 13 regen/starve/eat/damage tests — `tickSurvival` is NOT edited in this task; the engine calls `heal()` / writes `health` only via its OWN counters.
- `damage(s, 6)` → 14 (stats.test.ts) — poison must NOT call `damage()` (it would add `EXHAUSTION.TAKE_DAMAGE`); poison writes `s.health` directly, floored at 1.

Steps:

- [ ] **(CODE, UNIT)** Add `EFFECT_TUNING` to `src/rules/mc-1.20.ts` immediately after the `MOB_CAP` block (ends ~line 315). Insert:
  ```ts
  // ---------------------------------------------------------------------------
  // Status effects (Phase 5). Durations/intervals in TICKS (20 TPS).
  // ---------------------------------------------------------------------------

  /** Per-effect tuning. Durations are total ticks; intervals gate periodic ticks. */
  export const EFFECT_TUNING = {
    /** Default potion duration for non-instant effects (ticks). 45 s. */
    DEFAULT_DURATION: 900,
    /** Regeneration heals 1 HP every this many ticks (Regen I). Higher amplifier is faster. */
    REGEN_INTERVAL: 50,
    /** Regen interval shrinks by this many ticks per amplifier level above 0 (min 10). */
    REGEN_INTERVAL_PER_AMP: 25,
    /** Poison deals 1 HP every this many ticks (Poison I). */
    POISON_INTERVAL: 25,
    /** Poison interval shrinks by this many ticks per amplifier level above 0 (min 5). */
    POISON_INTERVAL_PER_AMP: 12,
    /** Instant Health restores this many HP per (amplifier+1). */
    INSTANT_HEALTH_PER_LEVEL: 6,
    /** Instant Damage deals this many HP per (amplifier+1). */
    INSTANT_DAMAGE_PER_LEVEL: 6,
    /** Resistance reduces post-armor damage by this fraction per (amplifier+1). 4 levels → 80%. */
    RESISTANCE_PER_LEVEL: 0.2,
    /** Strength adds this many half-hearts to melee per (amplifier+1). */
    STRENGTH_PER_LEVEL: 3,
    /** Swiftness multiplies move speed by (1 + this × (amplifier+1)). */
    SWIFTNESS_PER_LEVEL: 0.2,
  } as const;
  ```
- [ ] **(CODE, UNIT)** Create `src/effects/status.ts`:
  ```ts
  /**
   * status.ts — PURE status-effect engine (Phase 5).
   *
   * Effects live in an EffectState (a list of ActiveEffect) carried on the Player
   * (player.effects) — deliberately SEPARATE from SurvivalState, whose strict
   * makeSurvivalState() toEqual shape test forbids new fields and whose 13
   * regen/starve tests must stay byte-identical.
   *
   * Stack rules (MC-style): applying an effect of the same type REPLACES the
   * stored one when the incoming amplifier is HIGHER, REFRESHES the duration when
   * the amplifier is EQUAL (keeps the longer remaining), and is IGNORED when the
   * incoming amplifier is LOWER. tickEffects runs the periodic regen/poison and
   * reverse-iterates to expire finished effects in place.
   *
   * Instant effects (instant_health / instant_damage) apply ONCE on drink (handled
   * by applyEffect's caller via applyInstant) and are never stored with a duration.
   *
   * No Babylon, no world. Imports the survival heal()/SurvivalState only to mutate
   * health for regen/poison/instant — it NEVER calls tickSurvival or damage().
   */

  import { EFFECT_TUNING } from "../rules/mc-1.20";
  import { heal, type SurvivalState } from "../survival/stats";

  /** The Phase-5 effect roster. Numeric values are STABLE — they persist to disk. */
  export type EffectType =
    | "regeneration"
    | "instant_health"
    | "instant_damage"
    | "poison"
    | "resistance"
    | "strength"
    | "swiftness"
    | "fire_resistance";

  /** Stable type→int map for persistence (do NOT renumber existing entries). */
  export const EFFECT_TYPE_IDS: Record<EffectType, number> = {
    regeneration: 0,
    instant_health: 1,
    instant_damage: 2,
    poison: 3,
    resistance: 4,
    strength: 5,
    swiftness: 6,
    fire_resistance: 7,
  };

  const ID_TO_EFFECT: readonly EffectType[] = [
    "regeneration",
    "instant_health",
    "instant_damage",
    "poison",
    "resistance",
    "strength",
    "swiftness",
    "fire_resistance",
  ];

  /** Map a persisted int back to its EffectType, or null if unknown. */
  export function effectTypeFromId(id: number): EffectType | null {
    return ID_TO_EFFECT[id] ?? null;
  }

  /** Instant effects apply once and are never stored with a duration. */
  export function isInstant(type: EffectType): boolean {
    return type === "instant_health" || type === "instant_damage";
  }

  /**
   * One active effect on the player.
   * - `amplifier` is 0-based (0 = level I, 1 = level II, …).
   * - `ticksRemaining` counts DOWN; an effect at 0 is expired and removed.
   * - `periodTimer` accumulates UP toward the next periodic tick (regen/poison);
   *   it is scratch state, not persisted (defaults to 0 on load).
   */
  export interface ActiveEffect {
    type: EffectType;
    amplifier: number;
    ticksRemaining: number;
    periodTimer: number;
  }

  /** The player's whole set of active effects. */
  export interface EffectState {
    list: ActiveEffect[];
  }

  /** A fresh, empty effect state. */
  export function makeEffectState(): EffectState {
    return { list: [] };
  }

  /** Find the active effect of `type`, or undefined. */
  export function getEffect(s: EffectState, type: EffectType): ActiveEffect | undefined {
    return s.list.find((e) => e.type === type);
  }

  /** True iff `type` is active. */
  export function hasEffect(s: EffectState, type: EffectType): boolean {
    return getEffect(s, type) !== undefined;
  }

  /** The amplifier of the active effect of `type`, or -1 if absent. */
  export function effectAmplifier(s: EffectState, type: EffectType): number {
    return getEffect(s, type)?.amplifier ?? -1;
  }

  /**
   * Apply a (non-instant) effect with MC stack rules:
   *  - higher amplifier REPLACES (new amplifier + new duration),
   *  - equal amplifier REFRESHES (keeps the LONGER remaining duration),
   *  - lower amplifier is IGNORED.
   * Instant effects must NOT be passed here — route them through applyInstant.
   */
  export function applyEffect(
    s: EffectState,
    type: EffectType,
    amplifier: number,
    ticks: number,
  ): void {
    if (isInstant(type)) return; // instants are not stored
    const existing = getEffect(s, type);
    if (existing === undefined) {
      s.list.push({ type, amplifier, ticksRemaining: ticks, periodTimer: 0 });
      return;
    }
    if (amplifier > existing.amplifier) {
      existing.amplifier = amplifier;
      existing.ticksRemaining = ticks;
      existing.periodTimer = 0;
    } else if (amplifier === existing.amplifier) {
      existing.ticksRemaining = Math.max(existing.ticksRemaining, ticks);
    }
    // amplifier < existing → ignored
  }

  /**
   * Apply an INSTANT effect to `survival` immediately (drink time). Instant Health
   * heals; Instant Damage writes health directly floored at 0 WITHOUT going through
   * damage() (no take-damage exhaustion, no i-frames — matches MC instant harm).
   * Non-instant types are a no-op here.
   */
  export function applyInstant(
    survival: SurvivalState,
    type: EffectType,
    amplifier: number,
  ): void {
    const level = amplifier + 1;
    if (type === "instant_health") {
      heal(survival, EFFECT_TUNING.INSTANT_HEALTH_PER_LEVEL * level);
    } else if (type === "instant_damage") {
      survival.health = Math.max(
        0,
        survival.health - EFFECT_TUNING.INSTANT_DAMAGE_PER_LEVEL * level,
      );
    }
  }

  /** Regen interval (ticks) for an amplifier, clamped to a floor of 10. */
  function regenInterval(amplifier: number): number {
    return Math.max(
      10,
      EFFECT_TUNING.REGEN_INTERVAL - amplifier * EFFECT_TUNING.REGEN_INTERVAL_PER_AMP,
    );
  }

  /** Poison interval (ticks) for an amplifier, clamped to a floor of 5. */
  function poisonInterval(amplifier: number): number {
    return Math.max(
      5,
      EFFECT_TUNING.POISON_INTERVAL - amplifier * EFFECT_TUNING.POISON_INTERVAL_PER_AMP,
    );
  }

  /**
   * Advance all active effects by one tick AGAINST the player's survival state.
   *
   *  - Regeneration: own periodTimer; every regenInterval(amp) ticks, heal(1).
   *    Does NOT charge exhaustion (MC potions don't drain food) and runs
   *    INDEPENDENTLY of natural regen in tickSurvival (both may fire same tick).
   *  - Poison: own periodTimer; every poisonInterval(amp) ticks, health =
   *    max(1, health - 1). Bypasses i-frames and armor; CANNOT kill (floor 1).
   *  - Other effects (resistance/strength/swiftness/fire_resistance) have no
   *    per-tick action here — they are read by accessors at the relevant sites.
   *  - After ticking, every effect's ticksRemaining is decremented; expired
   *    effects are removed by REVERSE-iterating the list (safe in-place splice).
   *
   * `currentTick` is accepted for symmetry/future use; periodic effects use their
   * own periodTimer so they are deterministic regardless of absolute tick.
   */
  export function tickEffects(
    s: EffectState,
    survival: SurvivalState,
    _currentTick: number,
  ): void {
    for (const e of s.list) {
      if (e.type === "regeneration") {
        e.periodTimer++;
        if (e.periodTimer >= regenInterval(e.amplifier)) {
          heal(survival, 1);
          e.periodTimer = 0;
        }
      } else if (e.type === "poison") {
        e.periodTimer++;
        if (e.periodTimer >= poisonInterval(e.amplifier)) {
          survival.health = Math.max(1, survival.health - 1);
          e.periodTimer = 0;
        }
      }
    }
    // Decrement durations and expire in place (reverse iterate so splice is safe).
    for (let i = s.list.length - 1; i >= 0; i--) {
      const e = s.list[i]!;
      e.ticksRemaining--;
      if (e.ticksRemaining <= 0) s.list.splice(i, 1);
    }
  }

  // --- Accessors used by the combat / movement glue --------------------------

  /** Resistance damage-reduction fraction (0..0.8), 0 when absent. */
  export function resistanceFraction(s: EffectState): number {
    const amp = effectAmplifier(s, "resistance");
    if (amp < 0) return 0;
    return Math.min(0.8, EFFECT_TUNING.RESISTANCE_PER_LEVEL * (amp + 1));
  }

  /** Strength flat melee bonus (half-hearts), 0 when absent. */
  export function strengthBonus(s: EffectState): number {
    const amp = effectAmplifier(s, "strength");
    if (amp < 0) return 0;
    return EFFECT_TUNING.STRENGTH_PER_LEVEL * (amp + 1);
  }

  /** Swiftness speed multiplier (1 when absent). */
  export function swiftnessMultiplier(s: EffectState): number {
    const amp = effectAmplifier(s, "swiftness");
    if (amp < 0) return 1;
    return 1 + EFFECT_TUNING.SWIFTNESS_PER_LEVEL * (amp + 1);
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/effects/status.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import {
    makeEffectState,
    applyEffect,
    applyInstant,
    tickEffects,
    hasEffect,
    effectAmplifier,
    resistanceFraction,
    strengthBonus,
    swiftnessMultiplier,
    isInstant,
    effectTypeFromId,
    EFFECT_TYPE_IDS,
  } from "./status";
  import { makeSurvivalState } from "../survival/stats";
  import { EFFECT_TUNING } from "../rules/mc-1.20";

  describe("applyEffect stacking", () => {
    it("adds a new effect", () => {
      const s = makeEffectState();
      applyEffect(s, "strength", 0, 100);
      expect(effectAmplifier(s, "strength")).toBe(0);
    });
    it("higher amplifier REPLACES (amp + duration)", () => {
      const s = makeEffectState();
      applyEffect(s, "strength", 0, 100);
      applyEffect(s, "strength", 1, 50);
      expect(effectAmplifier(s, "strength")).toBe(1);
      // duration reset to the new effect's 50, not the prior 100.
      const e = s.list.find((x) => x.type === "strength")!;
      expect(e.ticksRemaining).toBe(50);
    });
    it("equal amplifier REFRESHES to the longer remaining duration", () => {
      const s = makeEffectState();
      applyEffect(s, "strength", 0, 30);
      applyEffect(s, "strength", 0, 80);
      expect(s.list.find((x) => x.type === "strength")!.ticksRemaining).toBe(80);
      // A shorter refresh does not shorten it.
      applyEffect(s, "strength", 0, 10);
      expect(s.list.find((x) => x.type === "strength")!.ticksRemaining).toBe(80);
    });
    it("lower amplifier is IGNORED", () => {
      const s = makeEffectState();
      applyEffect(s, "strength", 2, 100);
      applyEffect(s, "strength", 0, 999);
      expect(effectAmplifier(s, "strength")).toBe(2);
      expect(s.list.find((x) => x.type === "strength")!.ticksRemaining).toBe(100);
    });
    it("never stores an instant effect", () => {
      const s = makeEffectState();
      applyEffect(s, "instant_health", 0, 100);
      expect(s.list).toHaveLength(0);
    });
  });

  describe("tickEffects expiry (reverse-iterate)", () => {
    it("decrements duration and removes expired effects", () => {
      const s = makeEffectState();
      const survival = makeSurvivalState();
      applyEffect(s, "strength", 0, 2);
      applyEffect(s, "swiftness", 0, 1);
      tickEffects(s, survival, 0); // swiftness 1→0 expires; strength 2→1
      expect(hasEffect(s, "swiftness")).toBe(false);
      expect(effectAmplifier(s, "strength")).toBe(0);
      tickEffects(s, survival, 1); // strength 1→0 expires
      expect(hasEffect(s, "strength")).toBe(false);
      expect(s.list).toHaveLength(0);
    });
  });

  describe("regeneration effect", () => {
    it("heals 1 HP every REGEN_INTERVAL ticks, independent of food", () => {
      const s = makeEffectState();
      const survival = makeSurvivalState();
      survival.health = 10;
      survival.food = 0; // natural regen would NOT fire; effect ignores food
      applyEffect(s, "regeneration", 0, 10_000);
      for (let i = 0; i < EFFECT_TUNING.REGEN_INTERVAL; i++) {
        tickEffects(s, survival, i);
      }
      expect(survival.health).toBe(11);
    });
    it("does not charge exhaustion (MC potions don't drain food)", () => {
      const s = makeEffectState();
      const survival = makeSurvivalState();
      survival.health = 10;
      const startExhaustion = survival.exhaustion;
      applyEffect(s, "regeneration", 0, 10_000);
      for (let i = 0; i < EFFECT_TUNING.REGEN_INTERVAL; i++) tickEffects(s, survival, i);
      expect(survival.exhaustion).toBe(startExhaustion);
    });
  });

  describe("poison effect", () => {
    it("deals 1 HP every POISON_INTERVAL ticks and cannot kill (floors at 1)", () => {
      const s = makeEffectState();
      const survival = makeSurvivalState();
      survival.health = 2;
      applyEffect(s, "poison", 0, 10_000);
      for (let i = 0; i < EFFECT_TUNING.POISON_INTERVAL; i++) tickEffects(s, survival, i);
      expect(survival.health).toBe(1);
      // Another full interval cannot push below 1.
      for (let i = 0; i < EFFECT_TUNING.POISON_INTERVAL; i++) tickEffects(s, survival, i);
      expect(survival.health).toBe(1);
    });
    it("does not add take-damage exhaustion (bypasses damage())", () => {
      const s = makeEffectState();
      const survival = makeSurvivalState();
      survival.health = 10;
      const startExhaustion = survival.exhaustion;
      applyEffect(s, "poison", 0, 10_000);
      for (let i = 0; i < EFFECT_TUNING.POISON_INTERVAL; i++) tickEffects(s, survival, i);
      expect(survival.exhaustion).toBe(startExhaustion);
    });
  });

  describe("instant effects", () => {
    it("instant_health heals INSTANT_HEALTH_PER_LEVEL × level", () => {
      const survival = makeSurvivalState();
      survival.health = 4;
      applyInstant(survival, "instant_health", 0); // level 1
      expect(survival.health).toBe(4 + EFFECT_TUNING.INSTANT_HEALTH_PER_LEVEL);
    });
    it("instant_damage subtracts directly, floored at 0, no exhaustion", () => {
      const survival = makeSurvivalState();
      survival.health = 5;
      const startExhaustion = survival.exhaustion;
      applyInstant(survival, "instant_damage", 0);
      expect(survival.health).toBe(0); // 5 - 6, floored
      expect(survival.exhaustion).toBe(startExhaustion);
    });
    it("isInstant flags only the two instant types", () => {
      expect(isInstant("instant_health")).toBe(true);
      expect(isInstant("instant_damage")).toBe(true);
      expect(isInstant("poison")).toBe(false);
    });
  });

  describe("accessor math", () => {
    it("resistanceFraction is 0.2 per level, capped at 0.8", () => {
      const s = makeEffectState();
      expect(resistanceFraction(s)).toBe(0);
      applyEffect(s, "resistance", 0, 100);
      expect(resistanceFraction(s)).toBeCloseTo(0.2, 6);
      applyEffect(s, "resistance", 9, 100);
      expect(resistanceFraction(s)).toBe(0.8);
    });
    it("strengthBonus adds per level", () => {
      const s = makeEffectState();
      expect(strengthBonus(s)).toBe(0);
      applyEffect(s, "strength", 1, 100); // level 2
      expect(strengthBonus(s)).toBe(EFFECT_TUNING.STRENGTH_PER_LEVEL * 2);
    });
    it("swiftnessMultiplier is 1 when absent, >1 when active", () => {
      const s = makeEffectState();
      expect(swiftnessMultiplier(s)).toBe(1);
      applyEffect(s, "swiftness", 0, 100);
      expect(swiftnessMultiplier(s)).toBeCloseTo(1.2, 6);
    });
  });

  describe("type-id mapping (persistence)", () => {
    it("round-trips every roster type through its stable int id", () => {
      for (const [type, id] of Object.entries(EFFECT_TYPE_IDS)) {
        expect(effectTypeFromId(id)).toBe(type);
      }
    });
  });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/effects/status.test.ts` → all green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/survival/stats.test.ts` → the 13 stats tests still green (this task does NOT touch stats.ts).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(effects): greenfield status-effect engine (stack/refresh/tick/expiry)`

---

### Task 2: Attach `EffectState` to `Player` + tick it in the loop

Carry effects on the Player and tick them alongside `tickSurvival` — in `main.ts` AFTER `player.update()` returns (so `controller.ts` tests stay self-contained and `tickSurvival` keeps being called exactly once per tick from inside `update`).

**Files:**
- Modify: `src/player/controller.ts` (Player fields L68–81; constructor)
- Modify: `src/main.ts` (tick loop after `aiTick`, before the `isDead` check)

**Must-protect:**
- `controller.test.ts` — `player.update()` still calls `tickSurvival` exactly once; `tickEffects` is NOT inserted inside `update()`.
- `stats.test.ts` — unchanged (no edits to stats.ts).
- The `isDead` death-check stays the loop's authority — poison floors at 1 and cannot trigger it, but instant_damage / future effects can, so `tickEffects` runs BEFORE the `isDead` block.

Steps:

- [ ] **(CODE)** Add the `effects` field to `Player` in `src/player/controller.ts`. Before (fields L68–71 + constructor L73–81):
  ```ts
    readonly inventory: Inventory;
    readonly hotbar: Hotbar;
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
  After:
  ```ts
    readonly inventory: Inventory;
    readonly hotbar: Hotbar;
    readonly equipment: Equipment;
    /** Active status effects (potions). SEPARATE from SurvivalState. */
    readonly effects: EffectState;
    private readonly spawn: Vec3;

    constructor(spawn: Vec3) {
      this.spawn = { x: spawn.x, y: spawn.y, z: spawn.z };
      this.feet = { x: spawn.x, y: spawn.y, z: spawn.z };
      this.physics = makePhysicsState();
      this.survival = makeSurvivalState();
      this.inventory = new Inventory();
      this.hotbar = new Hotbar();
      this.equipment = new Equipment();
      this.effects = makeEffectState();
    }
  ```
  (Add `import { makeEffectState, type EffectState } from "../effects/status";` near the existing `Equipment` import at L34.)
- [ ] **(CODE, LIVE-QA)** Wire `tickEffects` into the fixed-tick loop in `src/main.ts`. Before (L923–928):
  ```ts
      mobDriver.aiTick(player, clock, currentTick);

      // Death: the loop owns the death → screen → respawn cycle (the controller
      // no longer auto-respawns). On the rising edge, show the overlay; the
      // outer freeze (deathState.isShown()) then halts ticks until Respawn.
      if (isDead(player.survival)) {
  ```
  After — tick effects against the player's survival AFTER mobs/combat resolve and BEFORE the death check:
  ```ts
      mobDriver.aiTick(player, clock, currentTick);

      // Status effects (potions): regen/poison/instant tick on their own timers,
      // independent of tickSurvival (already called inside player.update). Runs
      // before the death check so instant_damage etc. can be lethal this tick.
      tickEffects(player.effects, player.survival, currentTick);

      // Death: the loop owns the death → screen → respawn cycle (the controller
      // no longer auto-respawns). On the rising edge, show the overlay; the
      // outer freeze (deathState.isShown()) then halts ticks until Respawn.
      if (isDead(player.survival)) {
  ```
  (Add `import { tickEffects } from "./effects/status";` to `main.ts`'s import block.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/player/controller.test.ts src/survival/stats.test.ts` → green (update still ticks survival once; stats unchanged).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(player): carry EffectState on Player + tick it in the loop`

---

### Task 3: Resistance in `applyPlayerDamage` + Strength + Swiftness hooks

Fold resistance into the existing chokepoint (order: armor → resistance → clamp), add the additive strength bonus at the melee call-site, and thread the swiftness multiplier into `Player.update`.

**Files:**
- Modify: `src/game/mob-driver.ts` (`applyPlayerDamage` L519–538)
- Modify: `src/game/mob-driver.test.ts` (append; existing `applyPlayerDamage`/`attackMob` suites untouched)
- Modify: `src/player/controller.ts` (`update` signature L99; speed line L126)
- Modify: `src/main.ts` (melee site L692; `player.update` calls L916 + the mining-loop eye/fwd recompute is unaffected)

**Must-protect:**
- `mob-driver.test.ts` `applyPlayerDamage` suite (no-armor 6→14; iron chestplate 6→15; durability decrement; fully-absorbed costs no health AND no durability; i-frame second-hit ignored) — resistance defaults to 0 with no effect, so all five stay green. The `effective <= 0` early-return MUST move to AFTER resistance so a resistance-reduced-to-zero hit also skips durability wear.
- `mob-driver.test.ts` `attackMob` suite — `attackMob(mob, 1234)` default deals exactly `PLAYER_ATTACK_DAMAGE = 4`; the constant stays 4. Strength is additive at the call-site, NOT by mutating the constant or `attackDamageFor`.
- `armor.test.ts` — `armorReduction` is NOT modified; resistance is a separate post-armor stage.
- `controller.test.ts` — `update` keeps working with NO extra arg (the new `speedMultiplier` is optional, default 1).

Steps:

- [ ] **(CODE)** Insert the resistance stage in `applyPlayerDamage` in `src/game/mob-driver.ts`. Before (L519–538):
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
  After — apply armor first, THEN resistance, THEN the zero-check (which now also skips durability on a resistance-zeroed hit):
  ```ts
  export function applyPlayerDamage(
    player: Player,
    rawAmount: number,
    currentTick: number,
  ): void {
    const defense = player.equipment.totalDefense();
    const armored = armorReduction(rawAmount, defense);
    // Resistance stage (Phase 5): armor → resistance → clamp. Rounds to the
    // integer half-heart economy. resistanceFraction is 0 when no Resistance
    // effect is active, so this is a no-op for the pinned no-effect tests.
    const fraction = resistanceFraction(player.effects);
    const effective = fraction > 0 ? Math.max(0, Math.round(armored * (1 - fraction))) : armored;
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
  (Add `import { resistanceFraction } from "../effects/status";` to `mob-driver.ts`.)
- [ ] **(CODE, UNIT)** Append resistance cases to `src/game/mob-driver.test.ts` (do NOT touch the existing `applyPlayerDamage`/`attackMob` suites). Add inside (or after) the `applyPlayerDamage` describe block:
  ```ts
  describe("applyPlayerDamage resistance (Phase 5)", () => {
    it("resistance reduces post-armor damage (armor → resistance → clamp)", () => {
      const player = new Player({ x: 0, y: 0, z: 0 });
      player.survival.health = 20;
      // No armor; Resistance I → 20% off → 6 × 0.8 = 4.8 → 5.
      applyEffect(player.effects, "resistance", 0, 1000);
      applyPlayerDamage(player, 6, 100);
      expect(player.survival.health).toBe(15);
    });
    it("a resistance-reduced-to-zero hit costs no health AND no durability", () => {
      const player = new Player({ x: 0, y: 0, z: 0 });
      player.survival.health = 20;
      player.equipment.equip("chestplate", makeArmorStack(Items.IRON_CHESTPLATE));
      const startDur = player.equipment.get("chestplate")!.durability!;
      // Resistance IV → 80% off. A 1-damage hit after armor → round(≤1 × 0.2)=0.
      applyEffect(player.effects, "resistance", 3, 1000);
      applyPlayerDamage(player, 1, 100);
      expect(player.survival.health).toBe(20);
      expect(player.equipment.get("chestplate")!.durability).toBe(startDur);
    });
  });
  ```
  (Import `applyEffect` from `../effects/status`, plus `makeArmorStack`, `Items` if not already imported in the test file.)
- [ ] **(CODE)** Thread the swiftness multiplier into `Player.update` in `src/player/controller.ts`. Before (`update` signature L99 + speed line L126):
  ```ts
    update(input: InputState, yaw: number, world: World): void {
  ```
  After:
  ```ts
    update(
      input: InputState,
      yaw: number,
      world: World,
      speedMultiplier: number = 1,
    ): void {
  ```
  Before (L126):
  ```ts
        const speed = sprinting ? PHYSICS.SPRINT_SPEED : PHYSICS.WALK_SPEED;
  ```
  After:
  ```ts
        const baseSpeed = sprinting ? PHYSICS.SPRINT_SPEED : PHYSICS.WALK_SPEED;
        const speed = baseSpeed * speedMultiplier;
  ```
- [ ] **(CODE, LIVE-QA)** Pass the swiftness multiplier at the `player.update` call-site in `src/main.ts`. Before (L916):
  ```ts
      player.update(input, camera.rotation.y, world);
  ```
  After:
  ```ts
      player.update(
        input,
        camera.rotation.y,
        world,
        swiftnessMultiplier(player.effects),
      );
  ```
  (Add `swiftnessMultiplier` to the `./effects/status` import in `main.ts`.)
- [ ] **(CODE, LIVE-QA)** Add the Strength bonus at the melee call-site in `src/main.ts`. Before (L692–695):
  ```ts
          attackMob(mob, clock.totalTicks, attackDamageFor(heldDef), {
            x: eye.x,
            z: eye.z,
          });
  ```
  After:
  ```ts
          attackMob(
            mob,
            clock.totalTicks,
            attackDamageFor(heldDef) + strengthBonus(player.effects),
            { x: eye.x, z: eye.z },
          );
  ```
  (Add `strengthBonus` to the `./effects/status` import in `main.ts`.)
- [ ] **(CODE, UNIT)** Append a `speedMultiplier` test to `src/player/controller.test.ts`. VERIFIED: the file builds a REAL `World` via its `flatFloor(floorY, half?)` helper (stone floor at `floorY`, walkable top at `floorY+1`) and an `emptyWorld()` helper — there is NO `makeOpenWorld`; use `flatFloor`. It also has a `noInput()` helper returning the correct `InputState` shape — derive the forward input from it (do NOT hand-write `InputState` fields, which may not match). Walk both players several ticks so they settle and move, then assert the multiplied run travels farther:
  ```ts
  it("update applies an optional speed multiplier (Swiftness hook)", () => {
    const world = flatFloor(63); // real World; floor top at y=64
    const input = { ...noInput(), forward: true }; // copy the file's InputState shape
    const base = new Player({ x: 0, y: 65, z: 0 });
    const fast = new Player({ x: 0, y: 65, z: 0 });
    for (let i = 0; i < 20; i++) {
      base.update(input, 0, world);
      fast.update(input, 0, world, 1.5);
    }
    const baseDist = Math.hypot(base.feet.x, base.feet.z);
    const fastDist = Math.hypot(fast.feet.x, fast.feet.z);
    expect(fastDist).toBeGreaterThan(baseDist);
  });
  ```
  (`flatFloor` + `noInput` are existing helpers in controller.test.ts — reuse them. If `noInput()`'s forward-movement field is named other than `forward`, use the real field name — read the helper first.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/game/mob-driver.test.ts src/player/controller.test.ts src/combat/armor.test.ts` → all green; the pinned no-effect `applyPlayerDamage` and `attackMob` cases unchanged.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(LIVE-QA)** Deferred until potions exist (Task 5): drinking resistance/strength/swiftness visibly mitigates damage / boosts melee / speeds movement. Manual.
- [ ] **Commit:** `feat(combat): resistance in chokepoint + strength + swiftness hooks`

---

### Task 4: Potion items in `items.ts` (+ bow & arrow ids)

Add a `kind:"potion"` ItemDef with a `potionEffect` descriptor, plus BOW and ARROW ids, WITHOUT shifting any existing id (so `items.test.ts` invariants stay green automatically). Next free offset after `DIAMOND_BOOTS` (+58) is +59.

**Files:**
- Modify: `src/rules/items.ts` (ItemDef union L43 + `potionEffect` field; `Items` enum tail L125; `potion()` builder ~L167; `NON_BLOCK_DEFS` tail L292; accessors tail L390)
- Modify: `src/rules/items.test.ts` (append; existing invariants untouched)

**Must-protect:**
- `items.test.ts` — id uniqueness; all non-block ids ≥256; every `Items.*` registered. New ids are `NON_BLOCK_BASE + 59..68` (contiguous, no gaps, no collisions).
- `use-item.test.ts` — adding `kind:"potion"` does NOT change the food/armor/place branches (routed in Task 5).
- No `switch (def.kind)` exists in `src/` (Phase-4 self-review confirmed only `=== "tool"/"food"/"armor"` comparisons), so adding `"potion"` causes NO exhaustiveness breakage. Re-confirm with the Grep below before committing.

Steps:

- [ ] **(CODE)** Import the effect type into `src/rules/items.ts`. Before (L16–25):
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
  After — add the EffectType + tuning import:
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
    EFFECT_TUNING,
  } from "./mc-1.20";
  import type { EffectType } from "../effects/status";
  ```
  (NOTE: `effects/status.ts` imports from `mc-1.20` and `survival/stats`, NOT from `items.ts`, so this edge is acyclic. If typecheck flags a cycle, change `import type { EffectType }` is type-only and already erased at runtime — it cannot create a runtime cycle.)
- [ ] **(CODE)** Extend `ItemDef` in `src/rules/items.ts`. Before (L39–56):
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
  After — add `"potion"` to the union and a `potionEffect` descriptor:
  ```ts
  export interface ItemDef {
    id: ItemId;
    name: string;
    maxStack: number;
    kind: "block" | "tool" | "food" | "material" | "armor" | "potion";
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
    /** Effect applied when drunk (potions only). `durationTicks` is ignored for instants. */
    potionEffect?: { type: EffectType; amplifier: number; durationTicks: number };
  }
  ```
- [ ] **(CODE)** Add bow/arrow/potion ids to the `Items` enum after `DIAMOND_BOOTS` (L125). Before (L122–126):
  ```ts
    DIAMOND_HELMET: NON_BLOCK_BASE + 55,
    DIAMOND_CHESTPLATE: NON_BLOCK_BASE + 56,
    DIAMOND_LEGGINGS: NON_BLOCK_BASE + 57,
    DIAMOND_BOOTS: NON_BLOCK_BASE + 58,
  } as const;
  ```
  After:
  ```ts
    DIAMOND_HELMET: NON_BLOCK_BASE + 55,
    DIAMOND_CHESTPLATE: NON_BLOCK_BASE + 56,
    DIAMOND_LEGGINGS: NON_BLOCK_BASE + 57,
    DIAMOND_BOOTS: NON_BLOCK_BASE + 58,

    // Ranged (Phase 5).
    BOW: NON_BLOCK_BASE + 59,
    ARROW: NON_BLOCK_BASE + 60,

    // Potions (Phase 5). Drinkable; consumed on use; apply a status effect.
    POTION_REGENERATION: NON_BLOCK_BASE + 61,
    POTION_HEALING: NON_BLOCK_BASE + 62,
    POTION_HARMING: NON_BLOCK_BASE + 63,
    POTION_POISON: NON_BLOCK_BASE + 64,
    POTION_RESISTANCE: NON_BLOCK_BASE + 65,
    POTION_STRENGTH: NON_BLOCK_BASE + 66,
    POTION_SWIFTNESS: NON_BLOCK_BASE + 67,
    POTION_FIRE_RESISTANCE: NON_BLOCK_BASE + 68,
  } as const;
  ```
- [ ] **(CODE)** Add a `potion()` builder after `armor()` in `src/rules/items.ts`. Before (L160–167):
  ```ts
  function armor(
    id: ItemId,
    name: string,
    armorTier: ArmorTier,
    armorSlot: ArmorSlot,
  ): ItemDef {
    return { id, name, maxStack: 1, kind: "armor", armorTier, armorSlot };
  }
  ```
  After — append below:
  ```ts
  function armor(
    id: ItemId,
    name: string,
    armorTier: ArmorTier,
    armorSlot: ArmorSlot,
  ): ItemDef {
    return { id, name, maxStack: 1, kind: "armor", armorTier, armorSlot };
  }

  function potion(
    id: ItemId,
    name: string,
    type: EffectType,
    amplifier: number,
    durationTicks: number,
  ): ItemDef {
    // Potions stack to 1 (MC), like a bottle.
    return {
      id,
      name,
      maxStack: 1,
      kind: "potion",
      potionEffect: { type, amplifier, durationTicks },
    };
  }
  ```
- [ ] **(CODE)** Append bow/arrow/potion entries to `NON_BLOCK_DEFS` after the last `armor(...)` (L292). Before (L289–293):
  ```ts
    armor(Items.DIAMOND_HELMET, "Diamond Helmet", "diamond", "helmet"),
    armor(Items.DIAMOND_CHESTPLATE, "Diamond Chestplate", "diamond", "chestplate"),
    armor(Items.DIAMOND_LEGGINGS, "Diamond Leggings", "diamond", "leggings"),
    armor(Items.DIAMOND_BOOTS, "Diamond Boots", "diamond", "boots"),
  ];
  ```
  After:
  ```ts
    armor(Items.DIAMOND_HELMET, "Diamond Helmet", "diamond", "helmet"),
    armor(Items.DIAMOND_CHESTPLATE, "Diamond Chestplate", "diamond", "chestplate"),
    armor(Items.DIAMOND_LEGGINGS, "Diamond Leggings", "diamond", "leggings"),
    armor(Items.DIAMOND_BOOTS, "Diamond Boots", "diamond", "boots"),

    // Ranged (Phase 5). Bow stacks to 1; arrows stack to 64.
    { id: Items.BOW, name: "Bow", maxStack: 1, kind: "material" },
    { id: Items.ARROW, name: "Arrow", maxStack: 64, kind: "material" },

    // Potions (Phase 5). DEFAULT_DURATION drives non-instant effects; instants
    // ignore duration. Amplifier 0 = level I.
    potion(Items.POTION_REGENERATION, "Potion of Regeneration", "regeneration", 0, EFFECT_TUNING.DEFAULT_DURATION),
    potion(Items.POTION_HEALING, "Potion of Healing", "instant_health", 0, 0),
    potion(Items.POTION_HARMING, "Potion of Harming", "instant_damage", 0, 0),
    potion(Items.POTION_POISON, "Potion of Poison", "poison", 0, EFFECT_TUNING.DEFAULT_DURATION),
    potion(Items.POTION_RESISTANCE, "Potion of Resistance", "resistance", 0, EFFECT_TUNING.DEFAULT_DURATION),
    potion(Items.POTION_STRENGTH, "Potion of Strength", "strength", 0, EFFECT_TUNING.DEFAULT_DURATION),
    potion(Items.POTION_SWIFTNESS, "Potion of Swiftness", "swiftness", 0, EFFECT_TUNING.DEFAULT_DURATION),
    potion(Items.POTION_FIRE_RESISTANCE, "Potion of Fire Resistance", "fire_resistance", 0, EFFECT_TUNING.DEFAULT_DURATION),
  ];
  ```
  (NOTE: BOW/ARROW use a literal `kind:"material"` def rather than `material()` only so the ARROW's `maxStack:64` and the BOW's `maxStack:1` are explicit; both are inert in `resolveUse` — bow routes to `use-other` until the input glue handles it in Task 8, arrows have no right-click action.)
- [ ] **(CODE)** Add potion accessors after `armorDurabilityOf` in `src/rules/items.ts` (tail, L390). Append:
  ```ts
  /** True iff this item is a drinkable potion. */
  export function isPotion(id: ItemId): boolean {
    return getItemDef(id).kind === "potion";
  }

  /** The effect a potion applies when drunk, or null for non-potions. */
  export function potionEffectOf(
    id: ItemId,
  ): { type: EffectType; amplifier: number; durationTicks: number } | null {
    const def = getItemDef(id);
    if (def.kind !== "potion" || def.potionEffect === undefined) return null;
    return def.potionEffect;
  }
  ```
- [ ] **(CODE, UNIT)** Append bow/arrow/potion invariants to `src/rules/items.test.ts` (do NOT touch existing invariant blocks):
  ```ts
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
  ```
  (Add `isPotion, potionEffectOf` to the existing `import { ... } from "./items"` line.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/rules/items.test.ts` → all green, INCLUDING the unchanged id-uniqueness / ≥256 / every-`Items.*`-registered invariants.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors. Then run the exhaustiveness scan: `grep -rn "def.kind" src/` — confirm there is no `switch (def.kind)` lacking a `"potion"` branch (expected: none, only `=== "..."` comparisons).
- [ ] **Commit:** `feat(items): potion items + bow/arrow ids`

---

### Task 5: Drink routing (`resolveUse` "drink") + apply + seed inventory

Add a `"drink"` action; route `kind:"potion"` to it in the pure router; handle it in `main.ts` (apply effect or instant, then consume one). Seed the bow, arrows, and a few potions into the default loadout.

**Files:**
- Modify: `src/interaction/use-item.ts` (`UseAction` L16; `resolveUse` L37)
- Modify: `src/interaction/use-item.test.ts` (append; existing cases untouched)
- Modify: `src/main.ts` (RMB use handler, after the `equip` branch L764, before `use-other` L765)
- Modify: `src/inventory/default-inventory.ts` (seed slots 13–17)
- Modify: `src/inventory/default-inventory.test.ts` (extend; slots 0–12 pinned)

**Must-protect:**
- `use-item.test.ts` — the six existing branches (food/eat, food/none, armor/equip, place, use-other, none) keep their results; potion routes to drink BEFORE armor/place; bow falls through to `use-other`.
- `default-inventory.test.ts` — slots 0–12 stay pinned (OAK_PLANKS@0, WOODEN_PICKAXE@4, BREAD@8, IRON_HELMET@9..IRON_BOOTS@12). New items go in slots 13+ ONLY.

Steps:

- [ ] **(CODE, UNIT)** Extend `UseAction` + `resolveUse` in `src/interaction/use-item.ts`. Before (L16–21):
  ```ts
  /** The action a right-click resolves to. */
  export type UseAction =
    | { kind: "eat" }
    | { kind: "equip" }
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
    | { kind: "drink" }
    | { kind: "place" }
    | { kind: "use-other" }
    | { kind: "none" };
  ```
  Before (`resolveUse`, L37–48):
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
  After — drink routed before armor/place (potions have no `placesBlock`, so order only matters for clarity):
  ```ts
  export function resolveUse(def: ItemDef, ctx: UseContext): UseAction {
    if (def.kind === "food") {
      return ctx.hungry ? { kind: "eat" } : { kind: "none" };
    }
    if (def.kind === "potion") {
      return { kind: "drink" };
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
  it("potion → drink (regardless of hunger)", () => {
    const def = getItemDef(Items.POTION_HEALING);
    expect(resolveUse(def, { hungry: true })).toEqual({ kind: "drink" });
    expect(resolveUse(def, { hungry: false })).toEqual({ kind: "drink" });
  });
  it("bow → use-other (no right-click action; charge is mousedown glue)", () => {
    const def = getItemDef(Items.BOW);
    expect(resolveUse(def, { hungry: true })).toEqual({ kind: "use-other" });
  });
  ```
- [ ] **(CODE, LIVE-QA)** Wire the drink branch into the RMB handler in `src/main.ts`. Before (the `equip` branch then `use-other`, L756–768):
  ```ts
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
  After — insert a `drink` branch between `equip` and `use-other`:
  ```ts
      if (action.kind === "equip") {
        const armorSlot = Equipment.slotFor(held.itemId);
        if (armorSlot !== null) {
          const prev = player.equipment.equip(armorSlot, held);
          // The held piece is now worn; the bag slot takes whatever it displaced.
          player.inventory.set(slot, prev);
        }
        return;
      }
      if (action.kind === "drink") {
        const fx = def.potionEffect;
        if (fx !== undefined) {
          if (isInstant(fx.type)) {
            applyInstant(player.survival, fx.type, fx.amplifier);
          } else {
            applyEffect(player.effects, fx.type, fx.amplifier, fx.durationTicks);
          }
          player.inventory.removeFromSlot(slot, 1);
        }
        return;
      }
      if (action.kind === "use-other" || action.kind === "none") {
        // Tools / materials have no right-click effect yet; no place audio/particles.
        return;
      }
  ```
  (Add `applyEffect, applyInstant, isInstant` to the `./effects/status` import in `main.ts`. `def.potionEffect` is in scope via `def = getItemDef(held.itemId)` at L746.)
- [ ] **(CODE, LIVE-QA)** Seed bow/arrows/potions in `src/inventory/default-inventory.ts`. Before (L26–33):
  ```ts
    // Food (previously absent entirely).
    inv.set(8, makeStack(Items.BREAD, 8));
    // Starter armor (Phase 4) — lets the player actually use the equipment system.
    inv.set(9, makeArmorStack(Items.IRON_HELMET));
    inv.set(10, makeArmorStack(Items.IRON_CHESTPLATE));
    inv.set(11, makeArmorStack(Items.IRON_LEGGINGS));
    inv.set(12, makeArmorStack(Items.IRON_BOOTS));
    return inv;
  ```
  After — add the Phase-5 ranged + potion starters in the next free slots (13–17):
  ```ts
    // Food (previously absent entirely).
    inv.set(8, makeStack(Items.BREAD, 8));
    // Starter armor (Phase 4) — lets the player actually use the equipment system.
    inv.set(9, makeArmorStack(Items.IRON_HELMET));
    inv.set(10, makeArmorStack(Items.IRON_CHESTPLATE));
    inv.set(11, makeArmorStack(Items.IRON_LEGGINGS));
    inv.set(12, makeArmorStack(Items.IRON_BOOTS));
    // Ranged + potions (Phase 5) — bow + a quiver + a few drinkables to try.
    inv.set(13, makeStack(Items.BOW, 1, 1));
    inv.set(14, makeStack(Items.ARROW, 32));
    inv.set(15, makeStack(Items.POTION_HEALING, 1, 1));
    inv.set(16, makeStack(Items.POTION_STRENGTH, 1, 1));
    inv.set(17, makeStack(Items.POTION_SWIFTNESS, 1, 1));
    return inv;
  ```
- [ ] **(CODE, UNIT)** Extend `src/inventory/default-inventory.test.ts` (do NOT alter the pinned slots 0–12). Append assertions:
  ```ts
  it("seeds the Phase-5 bow, arrows, and potions in slots 13-17", () => {
    const inv = makeDefaultInventory();
    expect(inv.get(13)?.itemId).toBe(Items.BOW);
    expect(inv.get(14)?.itemId).toBe(Items.ARROW);
    expect(inv.get(14)?.count).toBe(32);
    expect(inv.get(15)?.itemId).toBe(Items.POTION_HEALING);
    expect(inv.get(16)?.itemId).toBe(Items.POTION_STRENGTH);
    expect(inv.get(17)?.itemId).toBe(Items.POTION_SWIFTNESS);
  });
  ```
  (Match the file's existing import of `makeDefaultInventory` + `Items`.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/interaction/use-item.test.ts src/inventory/default-inventory.test.ts` → all green (old branches + new drink/bow cases; pinned slots intact).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(LIVE-QA)** Run the app; right-click a Potion of Healing → it disappears from the bag and hearts rise; right-click Potion of Strength → next melee hits harder; right-click Potion of Swiftness → movement speeds up for ~45 s. Manual.
- [ ] **Commit:** `feat(potions): drink routing + apply effects + seed bow/arrows/potions`

---

### Task 6: Persistence — save/load effects + SAVE_VERSION 4→5

Additive `effects: EffectSave[]` field behind `SAVE_FORMAT` 4→5 and `SAVE_VERSION` 4→5, mirroring the equipment v3→v4 pattern exactly. In-flight arrows are NOT persisted (kinematic, transient).

**Files:**
- Modify: `src/save/serialize.ts` (`EffectSave` near L51; `PlayerSave` L41; `SAVE_FORMAT` L194; `writePlayer` after L388; `readPlayer` after L457 + return L473)
- Modify: `src/save/serialize.test.ts` (extend both `samplePlayer()` L89 and `samplePlayerMin()` L234 + the empty fixtures at L225/L249; round-trip)
- Modify: `src/save/migration.ts` (`SAVE_VERSION` L14; `MIGRATIONS` L52)
- Modify: `src/save/migration.test.ts` (`emptyPlayer()` L25; pin L116; add v4→v5 test)
- Modify: `src/game/persistence.ts` (`snapshotEffects` near L59; `playerSave` L99)
- Modify: `src/main.ts` (restore, after equipment block L398)

**Must-protect:**
- `serialize.test.ts` — `samplePlayer()`/`samplePlayerMin()` round-trip tests (inventory + equipment) stay green; the new `effects` field round-trips cleanly.
- `migration.test.ts` — `emptyPlayer()` must gain `effects:[]` or TS breaks; `expect(SAVE_VERSION).toBe(4)` → `.toBe(5)`; the no-op-at-`SAVE_VERSION` and `MIGRATIONS[1,2,3]` tests stay green.
- `deserializeSave` — `SAVE_FORMAT_MIN` stays 1; `format > SAVE_FORMAT` bound auto-accepts 1–5; the `containerFormat >= 4` equipment gate is UNCHANGED; effects is an independent `>= 5` gate appended after it.
- Effects array uses 3×i32 per entry (type, amplifier, ticksRemaining) with a u32 length prefix — NO per-slot presence flag (effects are never sparse/null). `periodTimer` is scratch state and is NOT persisted (defaults to 0 on load via `applyEffect`/restore).

Steps:

- [ ] **(CODE)** Add the `EffectSave` interface to `src/save/serialize.ts`. After the `ItemStackSave` interface (L44–51), insert:
  ```ts
  /** A persisted status effect (Phase 5). 3×i32; no presence flag (never null). */
  export interface EffectSave {
    type: number;
    amplifier: number;
    ticksRemaining: number;
  }
  ```
- [ ] **(CODE)** Add `effects` to `PlayerSave`. Before (L40–42):
  ```ts
    /** Worn armor [helmet, chestplate, leggings, boots]. Added in save v4; default all-null. */
    equipment: (ItemStackSave | null)[];
  }
  ```
  After:
  ```ts
    /** Worn armor [helmet, chestplate, leggings, boots]. Added in save v4; default all-null. */
    equipment: (ItemStackSave | null)[];
    /** Active status effects. Added in save v5; absent in older saves (migrated with []). */
    effects: EffectSave[];
  }
  ```
- [ ] **(CODE)** Bump `SAVE_FORMAT` + changelog. Before (L185–194):
  ```ts
  /**
   * Container format version.
   *  - 1: header + player + binary columns.
   *  - 2: …plus a trailing length-prefixed JSON {@link MobSave}[] blob.
   *  - 3: …plus spawnX/spawnY/spawnZ (f64×3) appended at the end of the player record.
   *  - 4: …plus a length-prefixed equipment slot array at the end of the player record.
   * Older containers are still readable (spawn defaults to the player position;
   * equipment defaults to all-null on containers older than format 4).
   */
  const SAVE_FORMAT = 4;
  ```
  After:
  ```ts
  /**
   * Container format version.
   *  - 1: header + player + binary columns.
   *  - 2: …plus a trailing length-prefixed JSON {@link MobSave}[] blob.
   *  - 3: …plus spawnX/spawnY/spawnZ (f64×3) appended at the end of the player record.
   *  - 4: …plus a length-prefixed equipment slot array at the end of the player record.
   *  - 5: …plus a length-prefixed status-effects array at the end of the player record.
   * Older containers are still readable (spawn defaults to the player position;
   * equipment defaults to all-null on containers older than format 4; effects
   * default to empty on containers older than format 5).
   */
  const SAVE_FORMAT = 5;
  ```
- [ ] **(CODE)** Append the effects block to `writePlayer`. Before (end of `writePlayer`, the closing `}` after the equipment loop L388–389):
  ```ts
      } else {
        w.u8(DURABILITY_ABSENT);
      }
    }
  }
  ```
  After — append the effects block (3×i32 per entry; length-prefixed):
  ```ts
      } else {
        w.u8(DURABILITY_ABSENT);
      }
    }

    // Status effects (added in container format 5). 3×i32 each; length-prefixed.
    w.u32(p.effects.length);
    for (const fx of p.effects) {
      w.i32(fx.type);
      w.i32(fx.amplifier);
      w.i32(fx.ticksRemaining);
    }
  }
  ```
- [ ] **(CODE)** Read the effects block in `readPlayer`, gated on `containerFormat >= 5`, and add it to the return literal. Before (the equipment if-block close + return, L456–474):
  ```ts
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
  After:
  ```ts
        } else {
          equipment.push({ itemId, count, maxStack });
        }
      }
    }

    // Effects (added in container format 5). Older containers → empty list.
    const effects: EffectSave[] = [];
    if (containerFormat >= 5) {
      const fxCount = r.u32();
      for (let i = 0; i < fxCount; i++) {
        const type = r.i32();
        const amplifier = r.i32();
        const ticksRemaining = r.i32();
        effects.push({ type, amplifier, ticksRemaining });
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
      effects,
    };
  }
  ```
- [ ] **(CODE)** Bump `SAVE_VERSION` + add `MIGRATIONS[4]` in `src/save/migration.ts`. Before (L14):
  ```ts
  export const SAVE_VERSION = 4;
  ```
  After:
  ```ts
  export const SAVE_VERSION = 5;
  ```
  Before (the `MIGRATIONS` registry tail, L44–52):
  ```ts
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
  After — add the v4→v5 step seeding an empty effects array (also extend the doc comment above MIGRATIONS to mention `MIGRATIONS[4]`):
  ```ts
    3: (data) => ({
      ...data,
      version: 4,
      player: {
        ...data.player,
        equipment: [null, null, null, null],
      },
    }),
    4: (data) => ({
      ...data,
      version: 5,
      player: {
        ...data.player,
        effects: [],
      },
    }),
  };
  ```
- [ ] **(CODE)** Add `snapshotEffects` + wire it into `buildWorldSave` in `src/game/persistence.ts`. After `snapshotEquipment` (L59), insert:
  ```ts
  /** Snapshot the player's active status effects into save shape (3 ints each). */
  function snapshotEffects(player: Player): EffectSave[] {
    return player.effects.list.map((e) => ({
      type: EFFECT_TYPE_IDS[e.type],
      amplifier: e.amplifier,
      ticksRemaining: e.ticksRemaining,
    }));
  }
  ```
  In `buildWorldSave`, before (L99–100):
  ```ts
      equipment: snapshotEquipment(player.equipment),
    };
  ```
  After:
  ```ts
      equipment: snapshotEquipment(player.equipment),
      effects: snapshotEffects(player),
    };
  ```
  (Add to the imports in `persistence.ts`: `type EffectSave` to the `../save/serialize` import list, and `import { EFFECT_TYPE_IDS } from "../effects/status";`.)
- [ ] **(CODE)** Restore effects in `src/main.ts` after the equipment restore block (ends L398). Before:
  ```ts
    // Worn armor (save v4+; older saves migrate to all-null).
    const eq = p.equipment ?? [null, null, null, null];
    ARMOR_SLOTS.forEach((armorSlot, i) => {
      const slot = eq[i] ?? null;
      player.equipment.set(armorSlot, slot === null ? null : { ...slot });
    });
  ```
  After — append the effects restore. Re-apply each saved effect via `applyEffect` (which resets `periodTimer` to 0); instants were never persisted so they are not restored:
  ```ts
    // Worn armor (save v4+; older saves migrate to all-null).
    const eq = p.equipment ?? [null, null, null, null];
    ARMOR_SLOTS.forEach((armorSlot, i) => {
      const slot = eq[i] ?? null;
      player.equipment.set(armorSlot, slot === null ? null : { ...slot });
    });

    // Active status effects (save v5+; older saves migrate to []).
    player.effects.list.length = 0;
    for (const fx of p.effects ?? []) {
      const type = effectTypeFromId(fx.type);
      if (type !== null) {
        player.effects.list.push({
          type,
          amplifier: fx.amplifier,
          ticksRemaining: fx.ticksRemaining,
          periodTimer: 0,
        });
      }
    }
  ```
  (Add `effectTypeFromId` to the `./effects/status` import in `main.ts`.)
- [ ] **(CODE, UNIT)** Update `src/save/migration.test.ts`. First add `effects: []` to `emptyPlayer()` (L25, alongside the existing `equipment: []`):
  ```ts
      equipment: [],
      effects: [],
    };
  ```
  Update the pin (the `it('exposes SAVE_VERSION = 4 ...')` test ~L116):
  ```ts
    it('exposes SAVE_VERSION = 5 and a MIGRATIONS registry', () => {
      expect(SAVE_VERSION).toBe(5);
      expect(typeof MIGRATIONS).toBe('object');
    });
  ```
  Add a v4→v5 migration test (model it on the existing `MIGRATIONS[3]` equipment test):
  ```ts
    it('MIGRATIONS[4] adds an empty effects array (v4 → v5)', () => {
      const v4 = saveAt(4, 42);
      const out = MIGRATIONS[4]!(v4);
      expect(out.version).toBe(5);
      expect(out.player.effects).toEqual([]);
    });
  ```
- [ ] **(CODE, UNIT)** Extend `src/save/serialize.test.ts`. Add `effects` to BOTH player fixtures. In `samplePlayer()` (after the `equipment` array, ~L124) add a non-empty effects list:
  ```ts
      effects: [
        { type: 5, amplifier: 1, ticksRemaining: 600 }, // strength II
        { type: 0, amplifier: 0, ticksRemaining: 200 }, // regeneration I
      ],
  ```
  In `samplePlayerMin()` (after its `equipment: []`, L249) and in the empty inline fixture at L225, add `effects: [],`. Then add a round-trip assertion next to the existing equipment one (after L158):
  ```ts
    expect(round.player.effects).toEqual(player.effects);
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/save/serialize.test.ts src/save/migration.test.ts src/game/persistence.test.ts` → all green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(save): persist status effects + SAVE_VERSION 4→5 migration`

---

### Task 7: PURE arrow — entity + charge→velocity + swept step + hit precedence

The fully unit-testable core of the ranged system: an `Arrow` entity, the `bowChargeToSpeed` mapping, and a pure `arrowStep` that integrates gravity, sweeps vs voxels (DDA, no tunneling), tests vs mob AABBs, and resolves NEAREST-hit (block vs mob) precedence. No Babylon, no input.

**Files:**
- Create: `src/arrows/entity.ts`, `src/arrows/entity.test.ts`
- Create: `src/arrows/physics.ts`, `src/arrows/physics.test.ts`
- Modify: `src/rules/mc-1.20.ts` (add `ARROW_CAP` + arrow tuning after `MOB_CAP`/`EFFECT_TUNING`)

**Must-protect:**
- `raycast.test.ts` — `raycastVoxel` is REUSED unchanged via the `(bx,by,bz) => world.getBlock(...)` BlockQuery contract (returns `Blocks.AIR` for empty, any non-AIR for solid).
- `mob-driver.test.ts` `pickMob` suite — `pickMob` is REUSED unchanged for the mob-AABB test.
- `Vec3` is imported from `../mobs/entity` (already exported there) — do NOT redefine. (`raycast.ts` also exports a `Vec3`; import the entity one to match `pickMob`/`Mob`.)
- `mc-1.20.test.ts` — new `ARROW_CAP`/arrow constants must not break existing constant assertions.

Steps:

- [ ] **(CODE, UNIT)** Add arrow tuning to `src/rules/mc-1.20.ts` immediately after the `EFFECT_TUNING` block (from Task 1). Insert:
  ```ts
  /** Max simultaneous in-flight arrows (pooled/capped). */
  export const ARROW_CAP = 16 as const;

  /** Bow/arrow ballistics (blocks/tick at 20 TPS). */
  export const ARROW = {
    /** Launch speed at full charge (blocks/tick). ~3 b/tick ≈ 60 b/s. */
    MAX_SPEED: 3.0,
    /** Launch speed at zero charge (a limp release still leaves the bow). */
    MIN_SPEED: 0.6,
    /** Milliseconds of hold to reach full charge. */
    FULL_CHARGE_MS: 1000,
    /** Per-tick gravity applied to vy (matches mob integration: vy*DRAG - GRAVITY). */
    GRAVITY: 0.05,
    /** Per-tick air drag multiplier on velocity (slight). */
    DRAG: 0.99,
    /** Arrow half-extent for the swept AABB / render box (blocks). */
    WIDTH: 0.1,
    /** Arrow length along travel (render only). */
    LENGTH: 0.5,
    /** Damage a fully-charged arrow deals to a mob (half-hearts). */
    DAMAGE: 6,
    /** Ticks an arrow may fly before auto-despawn (safety cap). 30 s. */
    MAX_AGE: 600,
    /** Distance past the shooter eye to spawn the arrow (clear the body). */
    SPAWN_OFFSET: 0.5,
  } as const;
  ```
- [ ] **(CODE, UNIT)** Create `src/arrows/entity.ts`:
  ```ts
  /**
   * entity.ts — the kinematic Arrow entity (Phase 5).
   *
   * An Arrow is NEVER a physics body: it carries a position (feet) + velocity and
   * is swept per-tick by arrowStep (src/arrows/physics.ts). Minimal state — no
   * health, no AI, no knockback. Vec3 is imported from the mob entity module so
   * Arrow positions are directly comparable with mob AABBs (pickMob).
   */

  import type { Vec3 } from "../mobs/entity";
  import { ARROW } from "../rules/mc-1.20";

  export const ARROW_WIDTH = ARROW.WIDTH;
  export const ARROW_LENGTH = ARROW.LENGTH;

  /** A single in-flight (or just-landed) arrow. */
  export class Arrow {
    readonly id: number;
    /** Tip/reference position in world space. */
    feet: Vec3;
    /** Velocity in blocks/tick. */
    velocity: Vec3;
    /** True once the arrow has struck a block (stops moving; pending cleanup). */
    landed: boolean;
    /** True once the arrow has struck a mob (pending cleanup). */
    hitMob: boolean;
    /** Id of the mob that fired/owns the arrow context (player = -1). */
    readonly shooterId: number;
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

    /** True once the arrow should be removed from the manager. */
    isDone(maxAge: number): boolean {
      return this.landed || this.hitMob || this.age >= maxAge;
    }
  }

  /**
   * Map a bow hold time (ms) to a launch speed (blocks/tick), clamped between
   * MIN_SPEED and MAX_SPEED. Linear in the 0..FULL_CHARGE_MS window.
   */
  export function bowChargeToSpeed(chargeMs: number): number {
    const t = Math.max(0, Math.min(1, chargeMs / ARROW.FULL_CHARGE_MS));
    return ARROW.MIN_SPEED + t * (ARROW.MAX_SPEED - ARROW.MIN_SPEED);
  }

  /**
   * Compute the arrow spawn origin + velocity from an eye position, a (possibly
   * unnormalized) aim direction, and a launch speed. The origin is pushed
   * SPAWN_OFFSET blocks along the aim so the arrow clears the shooter's own body
   * (raycastVoxel checks the origin voxel first — spawning inside a wall would
   * self-hit).
   */
  export function launchFrom(
    eye: Vec3,
    aimDir: Vec3,
    speed: number,
  ): { origin: Vec3; velocity: Vec3 } {
    const len = Math.hypot(aimDir.x, aimDir.y, aimDir.z) || 1;
    const nx = aimDir.x / len;
    const ny = aimDir.y / len;
    const nz = aimDir.z / len;
    const origin: Vec3 = {
      x: eye.x + nx * ARROW.SPAWN_OFFSET,
      y: eye.y + ny * ARROW.SPAWN_OFFSET,
      z: eye.z + nz * ARROW.SPAWN_OFFSET,
    };
    const velocity: Vec3 = { x: nx * speed, y: ny * speed, z: nz * speed };
    return { origin, velocity };
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/arrows/entity.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { Arrow, bowChargeToSpeed, launchFrom } from "./entity";
  import { ARROW } from "../rules/mc-1.20";

  describe("bowChargeToSpeed", () => {
    it("clamps to MIN_SPEED at zero charge", () => {
      expect(bowChargeToSpeed(0)).toBeCloseTo(ARROW.MIN_SPEED, 6);
    });
    it("clamps to MAX_SPEED at/after full charge", () => {
      expect(bowChargeToSpeed(ARROW.FULL_CHARGE_MS)).toBeCloseTo(ARROW.MAX_SPEED, 6);
      expect(bowChargeToSpeed(ARROW.FULL_CHARGE_MS * 5)).toBeCloseTo(ARROW.MAX_SPEED, 6);
    });
    it("is monotonic in between", () => {
      expect(bowChargeToSpeed(250)).toBeLessThan(bowChargeToSpeed(750));
    });
  });

  describe("launchFrom", () => {
    it("offsets the origin along the (normalized) aim and scales velocity by speed", () => {
      const { origin, velocity } = launchFrom({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -2 }, 3);
      expect(origin.z).toBeCloseTo(-ARROW.SPAWN_OFFSET, 6);
      expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeCloseTo(3, 6);
      expect(velocity.z).toBeCloseTo(-3, 6);
    });
  });

  describe("Arrow.isDone", () => {
    it("is done when landed, hit, or aged out", () => {
      const a = new Arrow(1, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
      expect(a.isDone(ARROW.MAX_AGE)).toBe(false);
      a.age = ARROW.MAX_AGE;
      expect(a.isDone(ARROW.MAX_AGE)).toBe(true);
      const b = new Arrow(2, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
      b.landed = true;
      expect(b.isDone(ARROW.MAX_AGE)).toBe(true);
    });
  });
  ```
- [ ] **(CODE, UNIT)** Create `src/arrows/physics.ts`:
  ```ts
  /**
   * physics.ts — PURE per-tick kinematic arrow step (Phase 5).
   *
   * Each tick: apply gravity/drag to velocity, then sweep the arrow from its
   * current position to current+velocity. The swept segment is tested against:
   *   (a) solid voxels via the existing Amanatides-Woo DDA (raycastVoxel), and
   *   (b) every mob AABB via the existing pickMob slab test,
   * and resolves NEAREST-hit precedence (block vs mob) by comparing entry
   * distances along the SAME segment. On a block hit the arrow lands at the hit;
   * on a mob hit the arrow is consumed (and the caller deals damage). With no
   * hit the arrow advances the full segment.
   *
   * Reuses raycastVoxel (src/interaction/raycast.ts) and pickMob
   * (src/game/mob-driver.ts) unchanged — both take the segment direction and a
   * maxDistance equal to the segment length, so a per-tick sweep never tunnels.
   */

  import type { Vec3 } from "../mobs/entity";
  import type { Mob } from "../mobs/entity";
  import { raycastVoxel, type BlockQuery } from "../interaction/raycast";
  import { pickMob } from "../game/mob-driver";
  import { ARROW } from "../rules/mc-1.20";

  /** What the arrow hit this tick (if anything). */
  export type ArrowHit =
    | { kind: "none" }
    | { kind: "block" }
    | { kind: "mob"; mob: Mob };

  /** Distance from `a` to `b`. */
  function dist(a: Vec3, b: Vec3): number {
    return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }

  /**
   * Advance `arrow` one tick against blocks (via `getBlock`) and `mobs`. Mutates
   * arrow.feet/velocity/age and sets arrow.landed / arrow.hitMob on a hit.
   * Returns what was hit so the caller can apply mob damage / play audio.
   *
   * Block-vs-mob precedence is by ENTRY DISTANCE along the segment: pickMob is
   * bounded by min(segLen, blockDist), so any mob it returns is provably nearer
   * than the block hit — block precedence falls out of that bound, with no need
   * to export mob-driver's private raySlab.
   */
  export function arrowStep(
    arrow: { feet: Vec3; velocity: Vec3; age: number; landed: boolean; hitMob: boolean },
    getBlock: BlockQuery,
    mobs: Mob[],
  ): ArrowHit {
    arrow.age++;

    // 1) Integrate gravity + drag (mob-style: vy*DRAG - GRAVITY).
    arrow.velocity.x *= ARROW.DRAG;
    arrow.velocity.z *= ARROW.DRAG;
    arrow.velocity.y = arrow.velocity.y * ARROW.DRAG - ARROW.GRAVITY;

    const from: Vec3 = { x: arrow.feet.x, y: arrow.feet.y, z: arrow.feet.z };
    const seg: Vec3 = { x: arrow.velocity.x, y: arrow.velocity.y, z: arrow.velocity.z };
    const segLen = Math.hypot(seg.x, seg.y, seg.z);
    if (segLen === 0) return { kind: "none" };
    // Unit travel direction. Every proven call site (the melee
    // `pickMob(eye, dir, REACH, ...)` / block raycast) passes a UNIT dir + a
    // world-distance, so pass the same convention here: `maxDistance = segLen`
    // is then unambiguously in BLOCKS regardless of how each routine treats |dir|.
    const dir: Vec3 = { x: seg.x / segLen, y: seg.y / segLen, z: seg.z / segLen };

    // 2) Block hit along the segment (DDA clamps to segLen → no tunneling).
    const blockHit = raycastVoxel(from, dir, segLen, getBlock);
    const blockDist =
      blockHit === null
        ? Number.POSITIVE_INFINITY
        : dist(from, {
            x: blockHit.block.x + 0.5,
            y: blockHit.block.y + 0.5,
            z: blockHit.block.z + 0.5,
          });

    // 3) Nearest mob whose AABB the segment enters, within the BLOCK distance (so
    //    a mob behind a wall is not hit). pickMob returns the nearest mob; bound
    //    its search to min(segLen, blockDist) so block precedence is automatic.
    const mobReach = Math.min(segLen, blockDist);
    const mob = pickMob(from, dir, mobReach, mobs);

    if (mob !== null) {
      // Move the arrow to the mob's center plane along the segment (good enough
      // for a visual stick; the arrow is consumed this tick anyway).
      arrow.feet = { x: mob.feet.x, y: mob.feet.y + 0.5, z: mob.feet.z };
      arrow.hitMob = true;
      arrow.velocity = { x: 0, y: 0, z: 0 };
      return { kind: "mob", mob };
    }

    if (blockHit !== null) {
      // Land at the empty voxel just before the hit (so it sits flush, not inside).
      arrow.feet = {
        x: blockHit.previous.x + 0.5,
        y: blockHit.previous.y + 0.5,
        z: blockHit.previous.z + 0.5,
      };
      arrow.landed = true;
      arrow.velocity = { x: 0, y: 0, z: 0 };
      return { kind: "block" };
    }

    // 4) No hit — advance the full segment.
    arrow.feet = { x: from.x + seg.x, y: from.y + seg.y, z: from.z + seg.z };
    return { kind: "none" };
  }
  ```
  (NOTE on precedence: `pickMob` is bounded by `min(segLen, blockDist)`, so any mob hit it returns is provably NEARER than the block hit — block-vs-mob nearest precedence is enforced by that bound without exporting `raySlab`. `blockDist` uses the voxel-center approximation already used by `blockHitDistance` in main.ts:650; it is the codebase's existing convention.)
- [ ] **(CODE, UNIT)** Create `src/arrows/physics.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { arrowStep } from "./physics";
  import { Arrow } from "./entity";
  import { Mob } from "../mobs/entity";
  import { Blocks } from "../rules/mc-1.20";

  const AIR = () => Blocks.AIR;

  describe("arrowStep", () => {
    it("applies gravity: a horizontally-launched arrow drops over ticks", () => {
      const a = new Arrow(1, { x: 0, y: 80, z: 0 }, { x: 1, y: 0, z: 0 });
      const startY = a.feet.y;
      arrowStep(a, AIR, []);
      arrowStep(a, AIR, []);
      expect(a.feet.y).toBeLessThan(startY); // arced downward
      expect(a.feet.x).toBeGreaterThan(0); // advanced forward
    });

    it("lands on a solid block without tunneling through it", () => {
      // Solid wall at x=2; arrow flying +X fast enough to overshoot in one tick.
      const solidWall: typeof AIR = (bx) => (bx >= 2 ? Blocks.STONE : Blocks.AIR);
      const a = new Arrow(2, { x: 0, y: 80, z: 0 }, { x: 3, y: 0, z: 0 });
      const hit = arrowStep(a, solidWall, []);
      expect(hit.kind).toBe("block");
      expect(a.landed).toBe(true);
      // Arrow stopped before the wall (x < 2), not past it.
      expect(a.feet.x).toBeLessThan(2);
    });

    it("hits a mob in the path", () => {
      const mob = new Mob(7, "zombie", { x: 2, y: 80, z: 0 });
      const a = new Arrow(3, { x: 0, y: 80.9, z: 0 }, { x: 3, y: 0, z: 0 });
      const hit = arrowStep(a, AIR, [mob]);
      expect(hit.kind).toBe("mob");
      if (hit.kind === "mob") expect(hit.mob.id).toBe(7);
      expect(a.hitMob).toBe(true);
    });

    it("prefers the block when it is nearer than the mob", () => {
      // Wall at x=1 (nearer); mob at x=3 (behind the wall) → block wins.
      const wall: typeof AIR = (bx) => (bx >= 1 ? Blocks.STONE : Blocks.AIR);
      const mob = new Mob(8, "zombie", { x: 3, y: 80, z: 0 });
      const a = new Arrow(4, { x: 0, y: 80.9, z: 0 }, { x: 4, y: 0, z: 0 });
      const hit = arrowStep(a, wall, [mob]);
      expect(hit.kind).toBe("block");
    });

    it("returns none and advances when nothing is hit", () => {
      const a = new Arrow(5, { x: 0, y: 80, z: 0 }, { x: 1, y: 0, z: 0 });
      const hit = arrowStep(a, AIR, []);
      expect(hit.kind).toBe("none");
      expect(a.feet.x).toBeGreaterThan(0);
    });
  });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/arrows/entity.test.ts src/arrows/physics.test.ts` → all green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/interaction/raycast.test.ts src/game/mob-driver.test.ts` → `raycastVoxel` + `pickMob` still green (reused unchanged).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(arrows): pure Arrow entity + charge→velocity + swept step + hit precedence`

---

### Task 8: `ArrowManager` (pooled/capped) + `ArrowRenderer`

The registry (mirrors `MobManager`: monotonic-never-reused ids, cap gated by the caller) and the Babylon renderer (mirrors `MobRenderer`: create/reposition/dispose with one elongated box per arrow, oriented along velocity).

**Files:**
- Create: `src/arrows/manager.ts`, `src/arrows/manager.test.ts`
- Create: `src/rendering/arrow-renderer.ts`, `src/rendering/arrow-renderer.test.ts`

**Must-protect:**
- `mobs/manager.test.ts` / `rendering/mob-renderer.test.ts` — UNTOUCHED. `ArrowManager`/`ArrowRenderer` are separate classes; `MobManager.mobs` stays `Map<number, Mob>`; the mob material cache is not shared.
- Arrow ids are monotonic-and-never-reused (so the renderer's `Map<number, record>` can never confuse a recycled id with a live mesh).

Steps:

- [ ] **(CODE, UNIT)** Create `src/arrows/manager.ts`:
  ```ts
  /**
   * manager.ts — the registry of live arrows (Phase 5). Mirrors MobManager: a
   * Map<number, Arrow> with monotonic, never-reused ids; spawn/despawn/all/count.
   * The cap (ARROW_CAP) is enforced by the CALLER via canFireArrow(count) before
   * spawn — the manager itself is a pure registry (matching the MobManager /
   * canSpawnMore split).
   */

  import type { Vec3 } from "../mobs/entity";
  import { Arrow } from "./entity";
  import { ARROW_CAP } from "../rules/mc-1.20";

  /** True iff another arrow may be fired given the current live count. */
  export function canFireArrow(currentCount: number): boolean {
    return currentCount < ARROW_CAP;
  }

  export class ArrowManager {
    /** Live arrows by id. */
    readonly arrows: Map<number, Arrow> = new Map();
    /** Next id to hand out (monotonic; never reused). */
    private nextId = 1;

    /** Spawn an arrow; returns it. Caller must gate on canFireArrow() first. */
    spawn(origin: Vec3, velocity: Vec3, shooterId = -1): Arrow {
      const id = this.nextId++;
      const arrow = new Arrow(id, origin, velocity, shooterId);
      this.arrows.set(id, arrow);
      return arrow;
    }

    /** Remove an arrow by id. Returns true iff one was removed. */
    despawn(id: number): boolean {
      return this.arrows.delete(id);
    }

    /** All live arrows (snapshot array). */
    all(): Arrow[] {
      return [...this.arrows.values()];
    }

    /** Number of live arrows. */
    count(): number {
      return this.arrows.size;
    }
  }
  ```
- [ ] **(CODE, UNIT)** Create `src/arrows/manager.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { ArrowManager, canFireArrow } from "./manager";
  import { ARROW_CAP } from "../rules/mc-1.20";

  describe("ArrowManager", () => {
    it("assigns monotonic ids that are never reused after despawn", () => {
      const m = new ArrowManager();
      const a = m.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
      const b = m.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
      expect(b.id).toBe(a.id + 1);
      m.despawn(a.id);
      const c = m.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
      expect(c.id).toBe(b.id + 1); // not reusing a.id
    });
    it("all() is a snapshot; count() tracks size", () => {
      const m = new ArrowManager();
      m.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
      expect(m.count()).toBe(1);
      expect(m.all()).toHaveLength(1);
    });
  });

  describe("canFireArrow cap", () => {
    it("allows up to ARROW_CAP, denies at/over", () => {
      expect(canFireArrow(0)).toBe(true);
      expect(canFireArrow(ARROW_CAP - 1)).toBe(true);
      expect(canFireArrow(ARROW_CAP)).toBe(false);
    });
  });
  ```
- [ ] **(CODE, LIVE-QA)** Create `src/rendering/arrow-renderer.ts` (mirror `MobRenderer`'s create/reposition/dispose; one shared material; orient along velocity). Read `src/rendering/mob-renderer.ts` first to copy the exact `TransformNode`/`shadowSink` idioms and the `nowMs===undefined` test path. IMPORTANT DIVERGENCE from MobRenderer: arrows die ONE-AT-A-TIME and share a SINGLE material, so per-instance disposal uses `root.dispose(false, false)` (free the mesh/geometry but KEEP the shared material) — disposing the material per-arrow would break every other live arrow. The shared material is freed exactly once in `dispose()`:
  ```ts
  /**
   * arrow-renderer.ts — Babylon rendering for in-flight arrows (Phase 5). Mirrors
   * MobRenderer: a Map<number, record> of root TransformNode + one elongated box.
   * On each sync(arrows, nowMs?): create a box for new ids, reposition + orient
   * live ids along their velocity, dispose records whose id vanished. Arrows
   * vanish immediately on removal (no death-grace tween). A single shared brown
   * material is used for all arrows (NOT the MobRenderer's material cache).
   */

  import type { Scene } from "@babylonjs/core/scene";
  import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
  import { Mesh } from "@babylonjs/core/Meshes/mesh";
  import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
  import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
  import { Color3 } from "@babylonjs/core/Maths/math.color";
  import type { Arrow } from "../arrows/entity";
  import { ARROW } from "../rules/mc-1.20";
  import type { ShadowCasterSink } from "./world-renderer"; // same sink type MobRenderer uses

  interface ArrowRecord {
    root: TransformNode;
    mesh: Mesh;
  }

  export class ArrowRenderer {
    private readonly scene: Scene;
    private readonly records = new Map<number, ArrowRecord>();
    private readonly shadowSink: ShadowCasterSink | null;
    private material: StandardMaterial | null = null;

    constructor(scene: Scene, shadowSink?: ShadowCasterSink) {
      this.scene = scene;
      this.shadowSink = shadowSink ?? null;
    }

    private sharedMaterial(): StandardMaterial {
      if (this.material === null) {
        const mat = new StandardMaterial("arrow_mat", this.scene);
        mat.diffuseColor = new Color3(0.55, 0.4, 0.25); // wooden shaft
        this.material = mat;
      }
      return this.material;
    }

    /** Reconcile rendered arrows with the live list each frame. */
    sync(arrows: Arrow[], nowMs?: number): void {
      void nowMs; // arrows have no per-frame animation; param kept for symmetry
      const seen = new Set<number>();
      for (const arrow of arrows) {
        seen.add(arrow.id);
        let record = this.records.get(arrow.id);
        if (record === undefined) {
          const root = new TransformNode(`arrow_${arrow.id}`, this.scene);
          const mesh = CreateBox(
            `arrow_${arrow.id}_mesh`,
            { width: ARROW.WIDTH, height: ARROW.WIDTH, depth: ARROW.LENGTH },
            this.scene,
          );
          mesh.material = this.sharedMaterial();
          mesh.parent = root;
          this.shadowSink?.addShadowCaster(mesh);
          record = { root, mesh };
          this.records.set(arrow.id, record);
        }
        record.root.position.set(arrow.feet.x, arrow.feet.y, arrow.feet.z);
        // Orient along velocity: yaw from XZ, pitch from vy.
        const v = arrow.velocity;
        const speed = Math.hypot(v.x, v.y, v.z);
        if (speed > 1e-6) {
          record.root.rotation.y = Math.atan2(v.x, v.z);
          record.root.rotation.x = -Math.asin(Math.max(-1, Math.min(1, v.y / speed)));
        }
      }
      // Dispose arrows that are gone (immediate; no tween). dispose(false, false):
      // recurse to free the mesh/geometry but DO NOT dispose materials — the brown
      // shaft material is SHARED across all arrows, so disposing it here (arrows die
      // one-at-a-time) would break every other live arrow. It is freed once in
      // dispose() below.
      for (const [id, record] of this.records) {
        if (seen.has(id)) continue;
        this.shadowSink?.removeShadowCaster(record.mesh);
        record.root.dispose(false, false);
        this.records.delete(id);
      }
    }

    /** Tear down all records + the shared material. */
    dispose(): void {
      for (const [, record] of this.records) {
        this.shadowSink?.removeShadowCaster(record.mesh);
        record.root.dispose(false, false); // free meshes; shared material disposed once below
      }
      this.records.clear();
      this.material?.dispose();
      this.material = null;
    }
  }
  ```
  (NOTE: confirm `ShadowCasterSink` is exported from `mob-renderer.ts`; if not, import it from wherever it is declared, or duplicate the 2-method interface `{ addShadowCaster(m): void; removeShadowCaster(m): void }` locally. Read mob-renderer.ts to confirm the export and the exact `@babylonjs/core` import names used there.)
- [ ] **(CODE, UNIT)** Create `src/rendering/arrow-renderer.test.ts` (mirror `mob-renderer.test.ts`'s NullEngine setup — read it first for the exact harness):
  ```ts
  import { describe, it, expect, beforeEach, afterEach } from "vitest";
  import { NullEngine, Scene } from "@babylonjs/core";
  import { ArrowRenderer } from "./arrow-renderer";
  import { Arrow } from "../arrows/entity";

  let engine: NullEngine;
  let scene: Scene;

  beforeEach(() => {
    engine = new NullEngine();
    scene = new Scene(engine);
  });
  afterEach(() => {
    scene.dispose();
    engine.dispose();
  });

  describe("ArrowRenderer", () => {
    it("creates a mesh for a new arrow and disposes it when gone", () => {
      const r = new ArrowRenderer(scene);
      const a = new Arrow(1, { x: 0, y: 80, z: 0 }, { x: 1, y: 0, z: 0 });
      r.sync([a]);
      const before = scene.meshes.length;
      expect(before).toBeGreaterThan(0);
      r.sync([]); // arrow gone → mesh disposed
      expect(scene.meshes.length).toBeLessThan(before);
    });
    it("shares ONE material across all arrows", () => {
      const r = new ArrowRenderer(scene);
      r.sync([
        new Arrow(1, { x: 0, y: 80, z: 0 }, { x: 1, y: 0, z: 0 }),
        new Arrow(2, { x: 1, y: 80, z: 0 }, { x: 1, y: 0, z: 0 }),
      ]);
      const arrowMats = scene.materials.filter((m) => m.name === "arrow_mat");
      expect(arrowMats).toHaveLength(1);
    });
  });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/arrows/manager.test.ts src/rendering/arrow-renderer.test.ts` → all green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/mobs/manager.test.ts src/rendering/mob-renderer.test.ts` → mob registry + renderer still green (untouched).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(arrows): pooled/capped ArrowManager + ArrowRenderer`

---

### Task 9: Input glue — bow charge + per-tick stepping + rendering (LIVE-QA)

Wire the whole ranged loop into `main.ts`: charge on RMB mousedown (bow held), fire on RMB mouseup (charge→velocity, consume one arrow), step arrows each fixed tick (apply mob damage on hit), and render them each frame. All of this is Babylon/input glue over the pure modules above.

**Files:**
- Modify: `src/main.ts` (module-level `arrowManager`/`arrowRenderer` + `bowChargeStartMs`; RMB charge-start in `handleClick`; mouseup release; tick-loop arrow step; render-loop arrow sync)

**Must-protect:**
- The mouseup LMB branch (`if (e.button === 0) resetMining()`, L788) fires on every LMB release regardless of bow state — only ADD an `else if (e.button === 2)`.
- `handleClick`'s `pointerLocked()` + `uiBlockingGameplay()` guards (L662–666) gate charge-start; never set `bowChargeStartMs` unless pointer is locked.
- The `resolveUse` `use-other`/`none` firewall (L765–768) is not weakened — charge-start is inserted BEFORE the `resolveUse` call (after `held` is obtained at L744), and the bow still resolves to `use-other` (no accidental placement).
- The tick-loop arrow step goes BETWEEN `aiTick`/`tickEffects` (L923–928) and the `isDead`/`break` (so arrows do not freeze on death); `accumulator -= TICK_SECONDS` (L935) stays the last statement in the tick body.
- The render-loop arrow sync goes alongside `mobRenderer.sync(...)` at L986, BEFORE `scene.render()` (L988) — it renders even while frozen (no snap on resume), but the tick loop already skips stepping when frozen.

Steps:

- [ ] **(CODE, LIVE-QA)** Add module-level arrow state near the other game singletons in `src/main.ts` (e.g. just after `const mobDriver = new MobDriver(world, renderer);` at L203). The renderer needs the scene + (optional) shadow sink the `MobRenderer` was constructed with — read the `mobRenderer` construction line and mirror its args:
  ```ts
  const arrowManager = new ArrowManager();
  // Mirror the MobRenderer construction at main.ts:205
  //   `new MobRenderer(scene, shadowGenerator ?? undefined)` — the ShadowGenerator
  // satisfies the ShadowCasterSink interface (add/removeShadowCaster).
  const arrowRenderer = new ArrowRenderer(scene, shadowGenerator ?? undefined);
  /** Wall-clock ms when the bow charge began, or null when not charging. */
  let bowChargeStartMs: number | null = null;
  ```
  (Add imports: `import { ArrowManager, canFireArrow } from "./arrows/manager";`, `import { ArrowRenderer } from "./rendering/arrow-renderer";`, `import { arrowStep } from "./arrows/physics";`, `import { launchFrom, bowChargeToSpeed } from "./arrows/entity";`. `Items` and `Inventory` are already imported. `shadowGenerator` is the module-level var used at main.ts:205.)
- [ ] **(CODE, LIVE-QA)** Start the bow charge on RMB mousedown in `handleClick`. Insert it in the `else if (button === 2)` branch, AFTER `held` is obtained (L744) and BEFORE `const def = getItemDef(held.itemId)` (L746). Before (L743–746):
  ```ts
      const slot = player.hotbar.selected;
      const held = player.inventory.get(slot);
      if (held === null || held.count <= 0) return;
      const def = getItemDef(held.itemId);
  ```
  After:
  ```ts
      const slot = player.hotbar.selected;
      const held = player.inventory.get(slot);
      if (held === null || held.count <= 0) return;
      // Bow: begin charging on RMB-down; release fires on RMB-up (mouseup handler).
      if (held.itemId === Items.BOW) {
        bowChargeStartMs = performance.now();
        return; // do NOT fall through to resolveUse / placeBlock
      }
      const def = getItemDef(held.itemId);
  ```
- [ ] **(CODE, LIVE-QA)** Fire the arrow on RMB mouseup. Before (the mouseup handler, L787–789):
  ```ts
  canvas.addEventListener("mouseup", (e) => {
    if (e.button === 0) resetMining();
  });
  ```
  After — add the RMB-release branch (guarded; consumes one arrow; capped):
  ```ts
  canvas.addEventListener("mouseup", (e) => {
    if (e.button === 0) {
      resetMining();
      return;
    }
    if (e.button === 2 && bowChargeStartMs !== null) {
      const chargeMs = performance.now() - bowChargeStartMs;
      bowChargeStartMs = null;
      if (!pointerLocked() || uiBlockingGameplay()) return;
      // Need a bow held AND at least one arrow.
      const slot = player.hotbar.selected;
      const held = player.inventory.get(slot);
      if (held === null || held.itemId !== Items.BOW) return;
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
      // NOTE: Inventory.SLOTS is in scope via the existing `Inventory` import in main.ts.
      gameAudio?.onMobHurt(eye); // placeholder bow-twang via existing audio hook; swap for a dedicated cue if available
    }
  });
  ```
  (NOTE: the arrow slot is found by the INLINE scan above — `Inventory` has no `findSlot` accessor, and we do NOT add one (don't widen the Inventory API). Confirm `Inventory.SLOTS`, `inventory.get(i)`, and `inventory.removeFromSlot(slot, n)` exist — they do; main.ts already uses `removeFromSlot` for eating. `performance.now()`, `camera`, `Vector3`, and `player.eyePosition()` must be in module scope at this handler — verify and mirror the existing click-handler usage.)
- [ ] **(CODE, LIVE-QA)** Step arrows each fixed tick. Insert in the tick loop AFTER the `tickEffects(...)` call (added in Task 2) and BEFORE the `isDead` block (L928). Add:
  ```ts
      // Step in-flight arrows: sweep vs blocks + mobs, apply damage, recycle.
      const liveMobs = mobDriver.manager.all();
      for (const arrow of arrowManager.all()) {
        const hit = arrowStep(
          arrow,
          (bx, by, bz) => world.getBlock(bx, by, bz),
          liveMobs,
        );
        if (hit.kind === "mob") {
          attackMob(hit.mob, currentTick, ARROW.DAMAGE, {
            x: arrow.feet.x,
            z: arrow.feet.z,
          });
          gameAudio?.onMobHurt(hit.mob.feet);
        }
        if (arrow.isDone(ARROW.MAX_AGE)) {
          arrowManager.despawn(arrow.id);
        }
      }
  ```
  (Add `import { ARROW } from "./rules/mc-1.20";` if `ARROW` is not already imported in main.ts — check the existing `mc-1.20` import line and extend it. `attackMob` is already imported. `currentTick` is in scope at L920.)
- [ ] **(CODE, LIVE-QA)** Render arrows each frame. Before (L986–988):
  ```ts
    mobRenderer.sync(mobDriver.manager.all(), performance.now(), clock.totalTicks);

    scene.render();
  ```
  After:
  ```ts
    mobRenderer.sync(mobDriver.manager.all(), performance.now(), clock.totalTicks);
    arrowRenderer.sync(arrowManager.all(), performance.now());

    scene.render();
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors (this task is glue; confirm `findSlot`/`ARROW`/import names resolve).
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/arrows` → all arrow unit suites still green.
- [ ] **(LIVE-QA)** Run the app:
  - Hold RMB with the bow selected → release after ~1 s → an arrow arcs out and sticks in terrain (no tunneling at any charge).
  - A short tap fires a weak, steeply-arcing arrow; a full hold fires a fast, flat one.
  - Aim at a zombie and fire → it takes damage + lurches (knockback via the 4-arg `attackMob`); the arrow vanishes on hit.
  - An arrow aimed at a mob BEHIND a wall hits the wall, not the mob.
  - Firing consumes one arrow from the quiver; with 0 arrows, RMB-up does nothing.
  - Never more than `ARROW_CAP` arrows exist at once.
- [ ] **Commit:** `feat(ranged): bow charge input + per-tick arrow stepping + rendering`

---

### Task 10: Full regression + live-QA gate

**Files:** No new source — verification + manual feel QA.

Steps:

- [ ] **(VERIFY, UNIT)** `corepack pnpm test` → the WHOLE suite green. Confirm the must-protect tests pass unchanged in intent:
  - `src/survival/stats.test.ts` — all 13 regen/starve/eat/damage tests; `makeSurvivalState` `toEqual<SurvivalState>` still matches (no new survival field).
  - `src/inventory/inventory.test.ts` — `Inventory.SLOTS === 36` (not widened).
  - `src/game/mob-driver.test.ts` — `applyPlayerDamage` 5 pinned cases (no-effect resistance is a no-op); `attackMob(mob, 1234)` default deals `PLAYER_ATTACK_DAMAGE = 4`; `attackDamageFor` iron sword = 10.
  - `src/rules/items.test.ts` — id-uniqueness / ≥256 / every-`Items.*`-registered invariants (new bow/arrow/potion ids at +59..+68).
  - `src/interaction/use-item.test.ts` — six original branches + new drink/bow cases.
  - `src/save/migration.test.ts` — `SAVE_VERSION === 5`; no-op-at-`SAVE_VERSION`; `MIGRATIONS[1,2,3]` unchanged; new `MIGRATIONS[4]` test.
  - `src/save/serialize.test.ts` + `src/game/persistence.test.ts` — inventory + equipment + new effects round-trip.
  - `src/interaction/raycast.test.ts` + `pickMob` — reused unchanged by the arrow step.
  - `src/mobs/manager.test.ts` + `src/rendering/mob-renderer.test.ts` — untouched by the arrow registry/renderer.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors (no missing `"potion"` branch in any exhaustive `switch (def.kind)` — there are none).
- [ ] **(LIVE-QA)** Run the app (per CLAUDE.md, /browse or the ▶-run skill). Verify the feel the headless suite cannot:
  - **Potions:** Healing restores hearts; Harming drops them; Regeneration ticks hearts back over ~45 s independent of food; Poison ticks hearts down but never kills (floors at 1 heart); Strength makes melee hit harder; Swiftness visibly speeds movement; Resistance reduces incoming mob damage (compare hearts lost with/without). Drinking consumes the bottle.
  - **Ranged:** charge → arc → stick; charge maps to range/flatness; arrows hit mobs (damage + knockback) and stick in terrain; wall occludes a mob behind it; quiver depletes; never exceeds `ARROW_CAP`.
  - **Persistence:** drink a long-duration potion, save + reload → the effect persists with the right remaining duration; loading a pre-Phase-5 save loads with empty effects and does not crash; in-flight arrows are gone after reload (expected — transient).
- [ ] **Commit (if any test-only fixups were needed):** `test: green Phase-5 ranged+potions suite`

---

## Self-review resolutions (planner)

Verified against the live codebase before locking:
- **Effects live OUTSIDE `SurvivalState`.** `stats.test.ts:17` uses `expect(makeSurvivalState()).toEqual<SurvivalState>({...})` — a strict shape check. Adding `activeEffects` to `SurvivalState` would break it (and risk the 13 regen/starve tests). Resolved by a separate `EffectState` on `player.effects`; `tickSurvival` and `stats.ts` are NOT edited at all. The recon's strongest must-protect.
- **Regen vs natural regen do not double-count incorrectly — they correctly STACK.** `tickEffects` runs from main.ts AFTER `player.update()` (which calls `tickSurvival`). The Regen effect uses its OWN `periodTimer` (never `regenTimer`), charges NO exhaustion, and ignores food — matching MC, where potion-regen and food-regen both fire. Both calling `heal()` (capped at `HEALTH.MAX`) is safe.
- **Poison bypasses `damage()`.** Poison writes `s.health = Math.max(1, ...)` directly (floor 1, cannot kill), adds no `EXHAUSTION.TAKE_DAMAGE`, and never touches `lastDamageTick` i-frames — exactly like starvation's direct-write pattern, so `damage(s,6)→14` and the starvation-floors-at-0 tests are untouched.
- **Resistance order is armor → resistance → clamp**, inserted between `armorReduction()` and the `effective <= 0` early-return; the zero-check MOVES to after resistance so a resistance-zeroed hit also skips durability wear (covered by a new test). `resistanceFraction` defaults to 0, so the 5 pinned `applyPlayerDamage` cases are byte-identical.
- **Strength is additive at the call-site** (`attackDamageFor(heldDef) + strengthBonus(...)`), never mutating `PLAYER_ATTACK_DAMAGE` or `attackDamageFor` — `attackMob`'s pinned 2-arg default stays 4.
- **Swiftness via an optional `Player.update(..., speedMultiplier = 1)` arg** (default 1 keeps all existing call-sites + `controller.test.ts` valid); applied to the `speed` local before `/ TICKS_PER_SECOND`, matching the recon's hook point.
- **Arrow hit precedence without exporting `raySlab`:** `pickMob` is bounded by `min(segLen, blockDist)`, so any mob it returns is provably nearer than the block hit. `blockDist` uses the voxel-center approximation already used by `blockHitDistance` (main.ts:650) — the codebase's existing convention. This avoids touching `mob-driver.ts`'s private `raySlab`.
- **`raycastVoxel` reuse + spawn offset:** the DDA checks the origin voxel first, so `launchFrom` pushes the spawn `SPAWN_OFFSET` past the eye to avoid an instant self-hit; the per-tick `maxDistance = segLen` clamps the sweep so a fast arrow never tunnels.
- **Persistence mirrors equipment exactly:** `SAVE_FORMAT` 4→5 + `SAVE_VERSION` 4→5; effects are 3×i32 + u32 length-prefix (no presence flag — never sparse); `MIGRATIONS[4]` seeds `[]`; `periodTimer` is scratch and not persisted (reset to 0 on load). Both `samplePlayer()` and `samplePlayerMin()` (and the inline empty fixtures) need `effects`, and `emptyPlayer()` in `migration.test.ts` too, or TS breaks.
- **Brewing stand DEFERRED to Phase 6** — potions are SEEDED into the default inventory (slots 15–17) like the Phase-4 starter armor. No crafting/brewing path is planned here.
- **`gameAudio?.onMobHurt` is a placeholder bow/hit cue** — there is no confirmed dedicated bow-shoot sound in the recon; the optional-callback idiom (`MobAudioCallbacks`) is the pattern to extend if a real cue is added, but that is cosmetic and out of scope.

### Post-recon verification (signatures confirmed against the live code)
- **`heal(s, amount)` EXISTS** in `stats.ts` and clamps to `HEALTH.MAX` (so potion-regen via `heal()` is correct and stacks safely with natural regen). `tickSurvival` natural regen requires `food >= 18 && saturation > 0`, charges exhaustion, and uses its own `regenTimer` — fully independent of the effect's `periodTimer`. `damage()` adds `EXHAUSTION.TAKE_DAMAGE`; poison deliberately bypasses it (direct `Math.max(1, …)` write). Confirmed.
- **`raycastVoxel(origin, dir, maxDistance, getBlock): RaycastHit | null`** returns `.block {x,y,z}`, `.face`, `.previous {x,y,z}`; `BlockQuery = (bx,by,bz) => BlockId`; `world.getBlock` returns `BlockId` (AIR=0 out of range). **`pickMob(rayOrigin, rayDir, maxDist, mobs): Mob | null`** is exported and normalizes `rayDir` internally; its private `raySlab` returns the entry distance, so the `min(segLen, blockDist)` bound gives correct block-vs-mob precedence. Confirmed.
- **`ShadowCasterSink` is exported from `world-renderer.ts`** (not mob-renderer); `MobRenderer` is `new MobRenderer(scene, shadowGenerator ?? undefined)` at main.ts:205; `shadowGenerator: CascadedShadowGenerator | null` is module-scope. `camera`, `Vector3`, `performance` are all in scope at the mouseup handler. No `switch (def.kind)` exists, so `"potion"` adds no exhaustiveness breakage. All save fixtures (`samplePlayer`, `samplePlayerMin`, the inline literal, `emptyPlayer`) have `equipment` and need `effects` added (or TS breaks). Confirmed.
- **PATCH — controller swiftness test:** `controller.test.ts` has NO `makeOpenWorld`; it uses `flatFloor(floorY)` / `emptyWorld()` (real `World`) and a `noInput()` helper. Task 3's test was rewritten to use `flatFloor(63)` + `{...noInput(), forward: true}` over several ticks.
- **PATCH — arrow-renderer shared material:** arrows die one-at-a-time and share ONE material, so per-instance disposal uses `dispose(false, false)` (frees the mesh, keeps the material); the shared material is freed once in `dispose()`. (MobRenderer's `(false, true)` only "works" because its tests dispose all mobs together — wrong for per-arrow recycling.)
- **PATCH — arrowStep unit direction:** the sweep now normalizes the travel direction and passes a UNIT dir + `maxDistance = segLen` to both `raycastVoxel` and `pickMob`, matching the proven melee call convention (removes any ambiguity in how each routine interprets a non-unit dir).

## Notes on testability

- **Unit-testable (no live QA):** the whole `status.ts` engine (Task 1), resistance/strength/swiftness math + the `applyPlayerDamage` resistance stage (Task 3), the `potion()`/`isPotion`/`potionEffectOf` registry (Task 4), `resolveUse` drink routing (Task 5), `MIGRATIONS[4]` + serialize effects round-trip (Task 6), `bowChargeToSpeed`/`launchFrom` + `arrowStep` block/mob/precedence (Task 7), `ArrowManager`/`canFireArrow` + `ArrowRenderer` lifecycle via `NullEngine` (Task 8).
- **Requires live QA (feel/glue only):** drinking visibly applying effects, resistance mitigating hearts, swiftness/strength feel, the bow charge→arc→stick, mob hits + wall occlusion, quiver depletion, the cap, and save/reload persistence of effects. Every underlying behavior is exercised by the pure modules above; only the Babylon/event/HUD glue is QA-only.

## Out of scope (explicitly deferred)

- **Brewing stand / potion crafting** — Phase 6. Potions are seeded into the starter inventory only.
- **Splash / lingering potions + tipped arrows** — only drinkable potions and plain arrows in v1.
- **Fire-resistance gameplay effect** — `fire_resistance` is in the roster + persists, but there is no fire/lava DOT in the codebase for it to negate yet; it is an inert flag until a burn system exists. (Roster completeness per the locked decision; behavior deferred.)
- **Mob-fired arrows as entities** — skeletons still call `hooks.damagePlayer(...)` directly (recon-confirmed); the `Arrow` system is player-fired only. `shooterId` is plumbed for a future mob-archer but unused.
- **Effect HUD / status icons** — effects are observable via hearts/feel; a dedicated effect-bar is a later cosmetic task.
- **Per-amplifier potion variants in the registry** — each potion is a single amplifier-0 (level I) item; level II / extended variants are deferred (the engine + `potionEffect.amplifier` already support them).
- **Knockback strength scaling from charge** — arrows use the standard `attackMob` knockback; charge does not scale knockback.
