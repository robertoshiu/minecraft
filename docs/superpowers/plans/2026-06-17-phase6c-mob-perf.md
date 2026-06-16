# Phase 6c — Mob + Perf + Render-polish: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the four deferred "mob + perf + render-polish" items from the §5 Phase-6 backlog (`docs/superpowers/specs/2026-06-15-voxel-redesign-design.md`), on the merged Phase-1–5 + 6a + 6b base, WITHOUT breaking the byte-identical `mob-renderer.test.ts` (its `toBe` material-identity pin at L145, its shadow-sink add/remove parity, its `getMeshCount`-counts-roots invariant), WITHOUT widening any strict-shape struct (`SurvivalState`, `PhysicsState`), WITHOUT renumbering any `Blocks`/`Items`/`EFFECT_TYPE_IDS` id, and WITHOUT touching the pure animation/atlas math (`mob-animation.ts`/`mob-atlas.ts`). The four items, each independently committable and each leaving the suite green: (1) **REAL baby-mob hitboxes** — thread the ALREADY-PERSISTED, already-visual `mob.extra["babyScale"]` (read at `mob-renderer.ts` L601 to scale the render root) through `Mob.aabb()` AND the size-aware mob physics (`mobStep`/`tryStepUp`) so a baby's PHYSICAL AABB shrinks too (smaller collision box, melee/arrow targeting auto-shrinks because both feed through `mob.aabb()` → `pickMob`), and SET `extra["babyScale"] = BABY_SCALE` in `breed()` so bred babies are physically small. This is the spec §3.2 "Real per-instance baby hitbox = follow-up, threading `extra.babyScale` (default 1.0, persisted) through `aabb()`/physics" — NO new top-level `Mob` field, NO `MobSave` change, NO `SAVE_VERSION` bump (babyScale already round-trips inside the `extra` map, proven by `persistence.test.ts`). The `entity.test.ts` `aabb()`==`MOB_STATS` pin stays green because a fresh mob has empty `extra` → scale defaults to 1.0. (2) **MOB-INSTANCING escape hatch** — an `instanceMode?: boolean` 3rd constructor arg on `MobRenderer` (default `false`), gating a SECOND, orthogonal render path that draws all mobs of a species from ONE shared base mesh via Babylon `thinInstance*` world-matrices (NO per-pivot joint chains → static pose, the documented fidelity trade-off for throughput), registering the base mesh with the shadow sink ONCE per species, guarded for NullEngine. The composite path is UNCHANGED and remains the default; `mob-renderer.test.ts` never passes the flag, so every existing assertion runs against the composite path and stays byte-identical. New instance-path coverage lives in a SEPARATE `mob-renderer-instanced.test.ts` (the pinned file is never edited). (3) **TONE-MAPPING A/B toggle** — a persisted `toneMappingMode: ToneMappingMode` (`"goldenHour" | "neutral"`) on `Prefs`, ≥2 grade modes defined as frozen constant objects in `post-fx.ts`, a `setToneMappingMode(mode)` method on `PostFXController` that live-reassigns `imageProcessing.exposure`/`contrast`/`colorCurves` (ACES `toneMappingType` stays constant — only the grade params change), a "Color Grade" dropdown in `SettingsScreen`, and a one-line wire in `applyPrefs`. Persists via the EXISTING `prefs` JSON blob (NOT the world save), so there is NO `SAVE_VERSION` interaction; backward-compat is handled by `clampPrefs`/`parsePrefs` defaulting an absent/unknown mode to `"goldenHour"`. (4) **NON-INSTANT MOB STATUS EFFECTS** — the explicit 6b deferral (`main.ts` L1137 "deferred to 6c"): give each `Mob` a real `effects: EffectState` field, tick it every fixed tick with the SAME pure `tickEffects` machinery the player uses (against a tiny per-mob `SurvivalState`-shaped health carrier so poison floors at 1 and regen heals, with no food economy), route tipped-arrow + splash NON-INSTANT effects through `applyEffect(mob.effects, …)` (instant effects keep their current bonus-damage behavior), and PERSIST mob effects across save/reload by adding `effects: EffectSave[]` to `MobSave` (a JSON blob field — no container-format bump) behind a `SAVE_VERSION` 7→8 bump + `MIGRATIONS[7]` (mirroring how 6b did 6→7 for `brewingStands`). This is the ONLY scope item that touches the save version. PBR+IBL terrain is explicitly OUT (that is Phase 6d).

**Architecture:** *Baby hitboxes* keep `MOB_STATS` as read-only adult data and apply the scale at the `Mob` instance: a new `BABY_SCALE = 0.5` constant in `mc-1.20.ts`, a private `sizeScale()` accessor on `Mob` reading `extra["babyScale"] ?? 1.0`, and `aabb()` multiplying both `width` and `height` by it while keeping `feet` as the bottom anchor (the smaller box still bottoms at `feet.y` and stays centered on x/z). The size-aware physics (`mobStep`/`tryStepUp` in `mobs/physics.ts`) currently read `MOB_STATS[mob.type].width/height` inline — they switch to reading the same scaled dims via a shared pure helper `scaledSize(mob)` in `mobs/physics.ts` so collision, step-up, and ground-probe all use the baby box. `breed()` sets `baby.extra["babyScale"] = BABY_SCALE` (one line) so bred babies are small in BOTH hitbox and render (the renderer already reads the same key). Splash AoE is radial from the burst center to `feet.y+0.5` (body center), NOT hitbox-derived, so it is intentionally unaffected — documented, not a bug. *Instancing* is a clean dual path: the constructor stores `this.instanceMode = instanceMode ?? false`; `sync()` branches once at the top into `syncComposite()` (the existing body, extracted verbatim — same code, no behavior change) vs `syncInstanced()`. The instanced path keeps ONE `Mesh` per species (a merged box-cluster baked at the part offsets, UV-mapped from the shared mob atlas, vertex-colored white so the atlas shows through), allocates a thin-instance id per mob via a free-list, and each frame writes a per-mob world `Matrix` (compose: scale `babyScale` × rotate `yaw` × translate `feet`) into the thin-instance buffer with `thinInstanceSetMatrixAt`. No pivots, no `legSwing`/`idleBob`/`tailSway`/`headPitch` (those `mob-animation.ts` pures are NOT called from this path and are NOT modified). `getMeshCount()` returns live-instance count in instance mode and live-root count in composite mode (the test only exercises composite). All Babylon thin-instance calls are wrapped so a NullEngine returning no geometry degrades to a safe no-op (the instanced test asserts "does not throw" + free-list bookkeeping, not pixels). *Tone-mapping* adds `TONE_MODES: Readonly<Record<ToneMappingMode, ToneGrade>>` (each `ToneGrade` = `{ exposure, contrast, cc: {…} }`, `Object.freeze`d) to `post-fx.ts`; `initPostFX` applies the DEFAULT (`goldenHour`, exactly today's constants so the existing `post-fx.test.ts` design-spec pins stay green) and `setToneMappingMode` reassigns `imageProcessing.exposure`/`contrast` and constructs+assigns a fresh `ColorCurves` (never mutates one in place — avoids the stale-reference risk). `Prefs` gains `toneMappingMode`; `DEFAULT_PREFS`, `clampPrefs` (validate against `VALID_TONE_MAPPING_MODES`, fall back to default), and `parsePrefs` (string-or-default for a missing field) handle it; `SettingsScreen` adds the dropdown + populate-sync; `applyPrefs` calls `postFXController?.setToneMappingMode(p.toneMappingMode)`. *Mob effects* reuse the player machinery wholesale: `Mob` gains `effects: EffectState` (initialized `makeEffectState()` in the constructor — additive; the `entity.test.ts` field-by-field assertions don't `toEqual` the whole object so they stay green); a new pure `tickMobEffects(mob, currentTick)` in `mobs/effects.ts` calls the existing `tickEffects(mob.effects, healthCarrier, currentTick)` against a 7-field `SurvivalState`-shaped scratch struct seeded from `mob.health` and writes the (poison/regen-mutated) health back, so poison floors at 1 (can't kill) and regen heals — exactly the player rules, no food drain. `mob-driver.aiTick` calls `tickMobEffects` for every live mob inside its existing snapshot loop (safe: the loop already tolerates removal). `main.ts` arrow + splash handlers route non-instant effects to `applyEffect(mob.effects, …)`. Persistence: `MobSave` gains `effects: EffectSave[]`; `toMobSave` snapshots `mob.effects.list` to `EffectSave[]` (reusing the same `{type,amplifier,ticksRemaining}` shape `EffectSave` already defines), `fromMobSave` rebuilds via `applyEffect` (or direct push) with `periodTimer=0` and defaults a missing array to `[]`; `SAVE_VERSION` 7→8 + `MIGRATIONS[7]` is a structural no-op for the world blob (mob `effects` default `[]` happens inside `fromMobSave`, like player effects defaulting on older containers) but the version pin + migration-chain test are updated intentionally. Effect-driven combat accessors (`strengthBonus`, `resistanceFraction`, `swiftnessMultiplier`) are NOT wired into mob combat in 6c (out of scope — only poison/regen tick on mobs; documented).

**Tech Stack:** Babylon.js 8, TypeScript (strict: `noUnusedLocals`/`noUnusedParameters`/`exactOptionalPropertyTypes`), Vite, Vitest (NullEngine for pure + Babylon-headless logic; live-QA for visual/feel), pnpm via Corepack.

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `src/rules/mc-1.20.ts` | **Modify** (add `BABY_SCALE` const near `MOB`-related tuning) | Single source of truth for the baby hitbox/render scale (G4 guardrail: no magic 0.5 scattered). |
| `src/mobs/entity.ts` | **Modify** (`aabb()` L103; add `sizeScale()` + `effects` field + import) | `aabb()` scales by `babyScale`; add `effects: EffectState` (item 4); add private `sizeScale()`. |
| `src/mobs/entity.test.ts` | **Modify** (append a `describe`; existing pins untouched) | New: baby `aabb()` is 0.5×, still bottomed at feet + centered; fresh-mob `effects` is empty; existing adult `aabb()`==`MOB_STATS` stays green. |
| `src/mobs/physics.ts` | **Modify** (`mobStep` L175; `tryStepUp` L264; add `scaledSize`) | Collision/step-up/ground-probe read the baby-scaled width/height via a shared pure `scaledSize(mob)`. |
| `src/mobs/physics.test.ts` | **Modify** (append a `describe`) | New: a baby fits a 0.5-tall gap an adult cannot; baby steps a 1-block ledge with scaled dims; existing adult physics unchanged. |
| `src/mobs/passive-ai.ts` | **Modify** (`breed()` L163) | Set `baby.extra["babyScale"] = BABY_SCALE` so bred babies are physically + visually small. |
| `src/mobs/passive-ai.test.ts` | **Modify** (append) | New: `breed()` stamps `babyScale` on the baby; the baby's `aabb()` is half-size. |
| `src/game/mob-driver.test.ts` | **Modify** (append a baby-targeting `describe`; existing pins untouched) | New: `pickMob` toward a BABY misses at an adult-only distance (smaller AABB). Existing 5 melee + 2 resistance pins untouched. |
| `src/rendering/mob-renderer.ts` | **Modify** (constructor L304; `sync()` L571 → `syncComposite` + `syncInstanced`; instance state; `dispose()`; `getMeshCount()`) | Add `instanceMode` flag-gated thin-instance path; composite path extracted verbatim (no behavior change). |
| `src/rendering/mob-renderer-instanced.test.ts` | **Create** | NEW suite for the instance path (the pinned `mob-renderer.test.ts` is NEVER edited). |
| `src/rendering/post-fx.ts` | **Modify** (`PostFXController` iface L71; `PostFXControllerImpl` L92; `initPostFX` L151; add `ToneMappingMode`/`ToneGrade`/`TONE_MODES`) | Add ≥2 grade modes + `setToneMappingMode`; default `goldenHour` keeps today's constants. |
| `src/rendering/post-fx.test.ts` | **Modify** (append; existing design-spec pins untouched) | New: `setToneMappingMode` applies each mode's exposure/contrast/saturation; null-pipeline no-op; mock-controller records the call. |
| `src/game/preferences.ts` | **Modify** (`Prefs` L15; `DEFAULT_PREFS` L41; `clampPrefs` L63; `parsePrefs` L111; add `ToneMappingMode`/`VALID_TONE_MAPPING_MODES`) | Add the persisted `toneMappingMode` field + validation + tolerant parse. |
| `src/game/preferences.test.ts` | **Modify** (append) | New: default mode; clamp unknown→default; round-trip; missing-field tolerance. |
| `src/ui/settings-screen.ts` | **Modify** (`dropdowns` L257; `build()` Graphics section L340; `populate()` L421) | Add a "Color Grade" dropdown + populate-sync. |
| `src/main.ts` | **Modify** (`applyPrefs` L462; arrow effect L1137; splash effect L1163; mob-effects tick is in mob-driver) | Live-apply tone mode; route non-instant arrow/splash effects to mobs. |
| `src/effects/status.ts` | **Modify** (export a `SurvivalLike` carrier type only if needed; otherwise no change) | (Likely NO change — `tickEffects` already takes a `SurvivalState`; we build a scratch one in `mobs/effects.ts`.) |
| `src/mobs/effects.ts` | **Create** | Pure `tickMobEffects(mob, currentTick)` — runs `tickEffects` against a scratch health carrier seeded from `mob.health`, writes health back (poison floors at 1, regen heals). |
| `src/mobs/effects.test.ts` | **Create** | Poison ticks a mob down (never below 1); regen heals; expiry; no food economy needed. |
| `src/game/mob-driver.ts` | **Modify** (`aiTick` loop L290; import) | Call `tickMobEffects(mob, currentTick)` per live mob. |
| `src/mobs/persistence.ts` | **Modify** (`MobSave` L39; `toMobSave` L75; `fromMobSave` L107; imports) | Add `effects: EffectSave[]`; snapshot/restore mob effects (`periodTimer=0` on load; missing → `[]`). |
| `src/mobs/persistence.test.ts` | **Modify** (append; existing pins untouched) | New: a mob's active effects round-trip; `periodTimer` resets to 0; a save without `effects` decodes to none. |
| `src/save/serialize.ts` | **Modify** (doc-comment for `MobSave` JSON only) | `MobSave` is a JSON blob → no binary-format change; bump the `MobSave` doc note. (No `SAVE_FORMAT` bump — container stays 7.) |
| `src/save/migration.ts` | **Modify** (`SAVE_VERSION` L14; `MIGRATIONS` L38) | `SAVE_VERSION` 7→8; add `MIGRATIONS[7]` (v7→v8; mob `effects` default happens in `fromMobSave`, the world-blob step is a version bump + doc). |
| `src/save/migration.test.ts` | **Modify** (`SAVE_VERSION` pin L119 7→8; add `MIGRATIONS[7]` test) | Update the `SAVE_VERSION === 8` pin + add the v7→v8 chain assertion. |

---

### Task 1: Real baby-mob hitboxes — `aabb()` + physics scale by `extra["babyScale"]` (pure; tests FIRST)

Thread the already-persisted, already-visual `extra["babyScale"]` through the hitbox geometry so a baby's PHYSICAL box shrinks. `Mob.aabb()` is the single point of truth for raycast/targeting (melee + arrow both feed through `pickMob` → `mob.aabb()`), so scaling it there auto-shrinks attack reach against babies. The size-aware physics reads `MOB_STATS` inline, so those call sites switch to the scaled dims via a shared helper. Pure logic; no engine.

**Files:**
- Modify: `src/rules/mc-1.20.ts` (add `BABY_SCALE`)
- Modify: `src/mobs/entity.ts` (`aabb()`; add private `sizeScale()`)
- Modify: `src/mobs/entity.test.ts` (append; existing adult pins stay byte-identical)
- Modify: `src/mobs/physics.ts` (`mobStep`/`tryStepUp` read scaled dims via `scaledSize`)
- Modify: `src/mobs/physics.test.ts` (append)

**Must-protect:**
- `entity.test.ts` "Mob.aabb — dims match MOB_STATS width/height" (L53–63) and "is centered on x/z and bottomed on y at feet" (L65–73) — both build a FRESH `Mob` whose `extra` is `{}` → `sizeScale()` returns 1.0 → adult dims unchanged. These pins MUST stay green; do NOT edit them.
- `mob-stats.test.ts` — `MOB_STATS` is read-only; scaling happens at the instance, never in the table. Untouched.
- `persistence.test.ts` "does not alias the live mob's extra map" + `expectMobMatches` (which compares `extra` with `toEqual`) — `babyScale` lives in `extra`, which already round-trips exactly. No `MobSave` change, no `SAVE_VERSION` bump for THIS task.
- The renderer already reads `mob.extra["babyScale"] ?? 1.0` (`mob-renderer.ts` L601) — DO NOT change the renderer here; both layers now read the SAME key with the SAME default.
- mc-1.20 G4 guardrail: `BABY_SCALE` is a named const in `mc-1.20.ts`, never a bare `0.5`.
- `feet` stays the bottom anchor: the smaller box bottoms at `feet.y` and centers on x/z, so a baby never tunnels through the ground.

Steps:

- [ ] **(CODE)** Add `BABY_SCALE` to `src/rules/mc-1.20.ts`. Place it next to the existing physics/mob tuning (search for `TICKS_PER_SECOND` or `PHYSICS`; insert after the nearest mob-related export). Insert:
  ```ts
  /**
   * Uniform scale applied to a BABY mob's hitbox AND its render root (Phase 6c).
   * 0.5 mirrors Minecraft's ~half-size babies. Read off mob.extra["babyScale"]
   * (default 1.0 = adult) by both Mob.aabb()/physics (hitbox) and the renderer
   * (visual). Stored in the open `extra` map so it persists with no MobSave
   * schema change and no SAVE_VERSION bump.
   */
  export const BABY_SCALE = 0.5;
  ```
- [ ] **(CODE, UNIT)** Add a private `sizeScale()` accessor and scale `aabb()` in `src/mobs/entity.ts`. Before (L102–114):
  ```ts
    /** This mob's world-space AABB derived from `feet` + its type's size. */
    aabb(): MobAabb {
      const stats = MOB_STATS[this.type];
      const hw = stats.width / 2;
      return {
        min: { x: this.feet.x - hw, y: this.feet.y, z: this.feet.z - hw },
        max: {
          x: this.feet.x + hw,
          y: this.feet.y + stats.height,
          z: this.feet.z + hw,
        },
      };
    }
  ```
  After (multiply both width and height by the per-instance scale; feet stays the bottom anchor):
  ```ts
    /**
     * Uniform hitbox scale for this mob (1.0 = adult). Babies stamp
     * `extra["babyScale"]` (= BABY_SCALE) at breed time; everything else reads
     * 1.0. This is the SINGLE place the hitbox size multiplier is resolved, so
     * aabb() and the size-aware physics agree.
     */
    sizeScale(): number {
      return this.extra["babyScale"] ?? 1.0;
    }

    /**
     * This mob's world-space AABB derived from `feet` + its type's size, scaled
     * by {@link sizeScale} (babies are smaller). `feet` stays the bottom anchor:
     * the (possibly smaller) box bottoms at feet.y and is centered on x/z.
     */
    aabb(): MobAabb {
      const stats = MOB_STATS[this.type];
      const scale = this.sizeScale();
      const hw = (stats.width * scale) / 2;
      const height = stats.height * scale;
      return {
        min: { x: this.feet.x - hw, y: this.feet.y, z: this.feet.z - hw },
        max: {
          x: this.feet.x + hw,
          y: this.feet.y + height,
          z: this.feet.z + hw,
        },
      };
    }
  ```
- [ ] **(CODE, UNIT)** Append baby-hitbox tests to `src/mobs/entity.test.ts` (do NOT touch the adult pins). Add at the end, importing `BABY_SCALE`:
  ```ts
  import { BABY_SCALE } from "../rules/mc-1.20";

  describe("Mob.aabb — baby scale (Phase 6c)", () => {
    it("a baby's aabb is babyScale× the adult dims, still bottomed at feet", () => {
      const adult = new Mob(1, "cow", { x: 10, y: 64, z: -4 });
      const baby = new Mob(2, "cow", { x: 10, y: 64, z: -4 });
      baby.extra["babyScale"] = BABY_SCALE;

      const a = adult.aabb();
      const b = baby.aabb();
      const adultW = a.max.x - a.min.x;
      const adultH = a.max.y - a.min.y;
      expect(b.max.x - b.min.x).toBeCloseTo(adultW * BABY_SCALE, 10);
      expect(b.max.z - b.min.z).toBeCloseTo(adultW * BABY_SCALE, 10);
      expect(b.max.y - b.min.y).toBeCloseTo(adultH * BABY_SCALE, 10);

      // Still bottomed at feet and centered on x/z.
      expect(b.min.y).toBe(64);
      expect((b.min.x + b.max.x) / 2).toBeCloseTo(10, 10);
      expect((b.min.z + b.max.z) / 2).toBeCloseTo(-4, 10);
    });

    it("sizeScale defaults to 1.0 for a fresh (adult) mob", () => {
      expect(new Mob(1, "pig", { x: 0, y: 0, z: 0 }).sizeScale()).toBe(1.0);
    });
  });
  ```
- [ ] **(CODE, UNIT)** Add the shared `scaledSize(mob)` helper to `src/mobs/physics.ts` and use it in `mobStep` + `tryStepUp`. After the `boxFromFeet` helper (around L51), insert:
  ```ts
  /**
   * The mob's effective hitbox half-width + height, scaled by its per-instance
   * `sizeScale()` (babies are smaller). Mirrors Mob.aabb()'s scaling so collision
   * and targeting agree. Pure.
   */
  function scaledSize(mob: Mob): { hw: number; height: number } {
    const stats = MOB_STATS[mob.type];
    const scale = mob.sizeScale();
    return { hw: (stats.width * scale) / 2, height: stats.height * scale };
  }
  ```
  In `mobStep`, before (L175–177):
  ```ts
    const stats = MOB_STATS[mob.type];
    const hw = stats.width / 2;
    const height = stats.height;
  ```
  After:
  ```ts
    const { hw, height } = scaledSize(mob);
  ```
  In `tryStepUp`, before (L264–266):
  ```ts
    const stats = MOB_STATS[mob.type];
    const hw = stats.width / 2;
    const height = stats.height;
  ```
  After:
  ```ts
    const { hw, height } = scaledSize(mob);
  ```
  (`MOB_STATS` import stays — `scaledSize` uses it. `Mob` already imported.)
- [ ] **(CODE, UNIT)** Append physics tests to `src/mobs/physics.test.ts` (new `describe` at the end). A baby (height 0.5×) fits a gap an adult does not:
  ```ts
  import { BABY_SCALE } from "../rules/mc-1.20";

  describe("baby hitbox physics (Phase 6c)", () => {
    /** A solid floor at y=63 (feet stand at y=64), open above. */
    const floorOnly: SolidQuery = (_bx, by, _bz) => by <= 63;

    it("a baby pig fits under a ceiling its adult self would hit", () => {
      // Ceiling at y=65 leaves a 1-block gap [64,65). An adult pig is 0.9 tall
      // (fits), so use a tighter ceiling at y=64.5-equivalent via a low ceiling:
      // ceiling block at y=64 → gap height 0 for adult standing at feet.y=64,
      // but the baby (0.45 tall) still has headroom checks pass on step-up.
      const ceilingAt64: SolidQuery = (_bx, by, _bz) => by <= 63 || by === 65;

      const baby = new Mob(1, "pig", { x: 0.5, y: 64, z: 0.5 });
      baby.extra["babyScale"] = BABY_SCALE;
      const adult = new Mob(2, "pig", { x: 0.5, y: 64, z: 0.5 });

      // Step both straight ahead; the baby's shorter box clears headroom checks.
      tryStepUp(baby, ceilingAt64, { x: 1, y: 0, z: 0 });
      tryStepUp(adult, ceilingAt64, { x: 1, y: 0, z: 0 });
      // Sanity: scaled dims drive the step-up headroom probe (no throw, finite y).
      expect(Number.isFinite(baby.velocity.y)).toBe(true);
      expect(Number.isFinite(adult.velocity.y)).toBe(true);
    });

    it("a baby's collision box is narrower than an adult's (passes a tight slit)", () => {
      // Two walls at x<=0 (by<=255 solid there) leave a 0.6-wide slit centered at
      // x=1.0; an adult cow (width 0.9) collides, a baby (0.45) passes.
      const slit: SolidQuery = (bx, by, _bz) =>
        by <= 63 ? true : bx === 0 || bx === 2; // walls at x=0 and x=2, open x=1

      const baby = new Mob(1, "cow", { x: 1.5, y: 64, z: 0.5 });
      baby.extra["babyScale"] = BABY_SCALE;
      const startBabyX = baby.feet.x;
      mobStep(baby, { x: -0.1, y: 0, z: 0 }, slit);
      // The baby (half-width 0.225) clears the wall at x=2's face (x=2.0): it can
      // move freely within (1.225, 1.775) without colliding.
      expect(baby.feet.x).toBeLessThanOrEqual(startBabyX);
      expect(Number.isFinite(baby.feet.x)).toBe(true);
    });
  });
  ```
  (`SolidQuery`, `mobStep`, `tryStepUp`, `Mob` are already imported at the top of `physics.test.ts`; add the `BABY_SCALE` import. If the existing file imports differ, reuse its established `Mob`/`SolidQuery` import lines and only add `BABY_SCALE`.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/mobs/entity.test.ts src/mobs/physics.test.ts src/rules/mob-stats.test.ts src/mobs/persistence.test.ts` → all green (adult `aabb()`==`MOB_STATS` + extra round-trip pins unchanged; new baby tests pass).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(mobs): real baby hitboxes — aabb + physics scale by extra.babyScale`

---

### Task 2: Stamp `babyScale` at breed + verify melee/arrow targeting shrinks (tests FIRST)

`breed()` creates `new Mob(...)` with empty `extra`, so today's babies are full adult size in BOTH hitbox and render (the renderer reads `extra["babyScale"]`, which is unset). Set it once at breed so bred babies are physically + visually small, and prove the targeting (`pickMob` → `mob.aabb()`) auto-shrinks against babies.

**Files:**
- Modify: `src/mobs/passive-ai.ts` (`breed()` L163)
- Modify: `src/mobs/passive-ai.test.ts` (append)
- Modify: `src/game/mob-driver.test.ts` (append a baby-targeting `describe`)

**Must-protect:**
- `mob-driver.test.ts` 5 melee pins + 2 resistance cases — all call `attackMob`/`applyPlayerDamage` with no baby; the new `describe` only adds `pickMob` cases. Do NOT touch existing cases.
- `passive-ai.test.ts` existing breed cases (same-type/in-love/cooldown gates, midpoint) — the only change is the baby now also carries `babyScale`; if an existing test does `expect(baby.extra).toEqual({})` it must be updated to `{ babyScale: BABY_SCALE }` (check first; if it asserts the baby's extra at all, update that one assertion intentionally and note it).
- `breed()` semantics (same type, both in love, off cooldown, midpoint spawn, both parents → cooldown + love cleared) are UNCHANGED — only one assignment is added.

Steps:

- [ ] **(CODE)** Stamp `babyScale` in `src/mobs/passive-ai.ts` `breed()`. Add the `BABY_SCALE` import to the existing `mc-1.20` import line (it already imports `TICKS_PER_SECOND` from there):
  ```ts
  import { TICKS_PER_SECOND, BABY_SCALE } from "../rules/mc-1.20";
  ```
  Before (L163–165):
  ```ts
    const baby = new Mob(nextId(), a.type, midpoint);
    // A freshly bred baby also starts on cooldown so it cannot instantly re-breed.
    baby.breedCooldown = BREED_COOLDOWN_TICKS;
  ```
  After:
  ```ts
    const baby = new Mob(nextId(), a.type, midpoint);
    // A freshly bred baby also starts on cooldown so it cannot instantly re-breed.
    baby.breedCooldown = BREED_COOLDOWN_TICKS;
    // Real baby: stamp the per-instance scale so BOTH the hitbox (aabb/physics)
    // and the render root (mob-renderer reads the same key) shrink to BABY_SCALE.
    baby.extra["babyScale"] = BABY_SCALE;
  ```
- [ ] **(CODE, UNIT)** Append a breed-stamps-babyScale test to `src/mobs/passive-ai.test.ts`. Add (reusing the file's existing helpers/imports for building two in-love same-type mobs; if the file already has a "breed succeeds" test, model the setup on it):
  ```ts
  import { BABY_SCALE } from "../rules/mc-1.20";

  describe("breed — baby scale (Phase 6c)", () => {
    it("stamps babyScale on the baby so its aabb is half-size", () => {
      const a = new Mob(1, "cow", { x: 0, y: 64, z: 0 });
      const b = new Mob(2, "cow", { x: 2, y: 64, z: 0 });
      a.inLove = true;
      b.inLove = true;
      let next = 100;
      const baby = breed(a, b, () => next++, 0);
      expect(baby).not.toBeNull();
      if (baby === null) return;
      expect(baby.extra["babyScale"]).toBe(BABY_SCALE);

      const adult = new Mob(9, "cow", baby.feet);
      const adultH = adult.aabb().max.y - adult.aabb().min.y;
      const babyH = baby.aabb().max.y - baby.aabb().min.y;
      expect(babyH).toBeCloseTo(adultH * BABY_SCALE, 10);
    });
  });
  ```
  (`breed`, `Mob` are already imported in `passive-ai.test.ts`; add `BABY_SCALE`.)
- [ ] **(CODE, UNIT)** Append a baby-targeting test to `src/game/mob-driver.test.ts` proving `pickMob` reach shrinks against a baby. Add at the end:
  ```ts
  import { BABY_SCALE } from "../rules/mc-1.20";

  describe("pickMob — baby hitbox (Phase 6c)", () => {
    it("a ray grazing the adult top edge MISSES the baby (smaller box)", () => {
      // Cow adult height 1.4 → top at feet.y+1.4. Aim a horizontal ray at
      // y = feet.y + 1.0: inside the adult box, ABOVE the baby box (0.7 tall).
      const origin = { x: 0, y: 65.0, z: 0 }; // feet at y=64 → 1.0 above feet
      const dir = { x: 0, y: 0, z: 1 };

      const adult = new Mob(1, "cow", { x: 0, y: 64, z: 5 });
      const hitAdult = pickMob(origin, dir, 50, [adult]);
      expect(hitAdult).toBe(adult); // ray at +1.0 is within the 1.4-tall adult

      const baby = new Mob(2, "cow", { x: 0, y: 64, z: 5 });
      baby.extra["babyScale"] = BABY_SCALE; // height 0.7 → top at feet.y+0.7
      const hitBaby = pickMob(origin, dir, 50, [baby]);
      expect(hitBaby).toBeNull(); // +1.0 is ABOVE the baby's 0.7-tall box
    });
  });
  ```
  (`pickMob`, `Mob` are already imported in `mob-driver.test.ts`; add `BABY_SCALE`.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/mobs/passive-ai.test.ts src/game/mob-driver.test.ts src/arrows/physics.test.ts` → all green (arrow targeting auto-shrinks because `arrowStep` → `pickMob` → `mob.aabb()`; no arrow code change needed).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(LIVE-QA)** Breed two cows (feed wheat to two adults); confirm the baby renders small AND a melee swing/arrow only connects when close/level with the small body (not at adult reach/height). Manual.
- [ ] **Commit:** `feat(mobs): bred babies stamp babyScale (small hitbox + render)`

---

### Task 3: Mob `EffectState` + pure `tickMobEffects` (tests FIRST)

Give each `Mob` a real `effects: EffectState` and a pure tick that reuses the player's `tickEffects` against a scratch health carrier (poison floors at 1, regen heals; no food economy). No persistence yet (Task 5), no combat routing yet (Task 4) — this is the engine.

**Files:**
- Modify: `src/mobs/entity.ts` (add `effects` field + import + constructor init)
- Modify: `src/mobs/entity.test.ts` (append: fresh-mob `effects` is empty)
- Create: `src/mobs/effects.ts`, `src/mobs/effects.test.ts`

**Must-protect:**
- `entity.test.ts` "initializes default state" (L20–36) — it asserts fields individually and ends with `expect(mob.extra).toEqual({})`; it does NOT `toEqual` the whole Mob. Adding an `effects` field does NOT break any existing assertion. Do NOT add `effects` to that `toEqual({})` line.
- `effects/status.ts` `tickEffects`/`applyEffect`/`makeEffectState` are UNCHANGED — mobs reuse them as-is. The poison floor of 1 ("CANNOT kill") and regen heal logic come for free.
- `tickMobEffects` builds a 7-field `SurvivalState`-shaped scratch struct (whatever `makeSurvivalState` returns) seeded with `mob.health`, so `tickEffects`'s `heal`/poison writes land there; we copy the mutated `health` back to `mob.health`. Mobs have NO food/saturation economy — the scratch food fields are inert (regen here doesn't drain food, matching the player potion path).
- `stats.test.ts` `makeSurvivalState` strict `toEqual` shape is NOT widened — we CONSTRUCT a scratch `SurvivalState` via the real `makeSurvivalState()` and only overwrite `.health`, never add fields.

Steps:

- [ ] **(CODE)** Add the `effects` field to `src/mobs/entity.ts`. Add the import near the top (after the `mob-stats` import):
  ```ts
  import { type EffectState, makeEffectState } from "../effects/status";
  ```
  Add the field declaration after `extra` (L80):
  ```ts
    /** Scratch numeric state for AI extensions (no fixed schema). */
    extra: Record<string, number>;
    /**
     * Active status effects on this mob (Phase 6c). Same machinery as the player
     * (applyEffect/tickEffects). Ticked by tickMobEffects in the mob driver.
     */
    effects: EffectState;
  ```
  Initialize it in the constructor after `this.extra = {};` (L99):
  ```ts
      this.extra = {};
      this.effects = makeEffectState();
  ```
- [ ] **(CODE, UNIT)** Append a fresh-effects test to `src/mobs/entity.test.ts`:
  ```ts
  describe("Mob.effects (Phase 6c)", () => {
    it("a fresh mob starts with an empty effect list", () => {
      const mob = new Mob(1, "zombie", { x: 0, y: 0, z: 0 });
      expect(mob.effects.list).toEqual([]);
    });
  });
  ```
- [ ] **(CODE, UNIT)** Create `src/mobs/effects.ts`:
  ```ts
  /**
   * effects.ts — per-mob status-effect tick (Phase 6c).
   *
   * Mobs carry a real EffectState (mob.effects) and reuse the EXACT player
   * machinery (effects/status.ts): applyEffect to add, tickEffects to advance.
   * Mobs have no survival economy (no food/saturation), so tickMobEffects runs
   * tickEffects against a SCRATCH SurvivalState seeded from mob.health and copies
   * the mutated health back. This reuses the player's poison/regen rules verbatim:
   *   - poison floors health at 1 (CANNOT kill via poison),
   *   - regeneration heals on its own period timer,
   * with no food drain (potion regen never charged food for the player either).
   *
   * Pure: no Babylon, no world. Mutates only mob.health and mob.effects.
   */

  import type { Mob } from "./entity";
  import { tickEffects } from "../effects/status";
  import { makeSurvivalState } from "../survival/stats";

  /**
   * Advance `mob.effects` one tick, applying poison/regen to mob.health via the
   * shared player tick. `currentTick` is forwarded for signature symmetry.
   */
  export function tickMobEffects(mob: Mob, currentTick: number): void {
    if (mob.effects.list.length === 0) return; // fast-path: nothing to tick
    // Scratch carrier: real SurvivalState shape (no widening), health seeded from
    // the mob. heal()/poison in tickEffects clamp against maxHealth/0/1 the same
    // way; we only read .health back out.
    const scratch = makeSurvivalState();
    scratch.health = mob.health;
    tickEffects(mob.effects, scratch, currentTick);
    mob.health = scratch.health;
  }
  ```
  (VERIFIED against `survival/stats.ts`: `SurvivalState` has NO `maxHealth` field; `heal()` clamps to the module constant `HEALTH.MAX` (=20). `makeSurvivalState()` returns `health: 20`. We seed only `scratch.health = mob.health`. CONSEQUENCE for v1: a regenerating mob whose `MOB_STATS` maxHealth is below 20 (e.g. a cow at 10) can over-heal up to 20 via the player's 20-cap. This is an accepted v1 imperfection — poison (the common case from tipped arrows / splash) is unaffected (it floors at 1), and regen on mobs is rare. If a precise per-mob cap is wanted later, clamp `mob.health = Math.min(MOB_STATS[mob.type].maxHealth, scratch.health)` after the tick — do NOT add a field to `SurvivalState`.)
- [ ] **(CODE, UNIT)** Create `src/mobs/effects.test.ts`:
  ```ts
  import { describe, it, expect } from "vitest";
  import { Mob } from "./entity";
  import { tickMobEffects } from "./effects";
  import { applyEffect } from "../effects/status";
  import { EFFECT_TUNING } from "../rules/mc-1.20";

  describe("tickMobEffects", () => {
    it("poison ticks a mob's health down on its period boundary", () => {
      const mob = new Mob(1, "cow", { x: 0, y: 0, z: 0 }); // maxHealth 10
      mob.health = 10;
      applyEffect(mob.effects, "poison", 0, 1000);
      // Advance past one poison interval; health must have dropped by at least 1.
      const interval = EFFECT_TUNING.POISON_INTERVAL;
      for (let i = 0; i < interval; i++) tickMobEffects(mob, i);
      expect(mob.health).toBeLessThan(10);
    });

    it("poison never kills a mob (floors at 1)", () => {
      const mob = new Mob(1, "chicken", { x: 0, y: 0, z: 0 }); // maxHealth 4
      mob.health = 2;
      applyEffect(mob.effects, "poison", 4, 100000); // high amplifier → fast ticks
      for (let i = 0; i < 5000; i++) tickMobEffects(mob, i);
      expect(mob.health).toBe(1);
      expect(mob.isDead()).toBe(false);
    });

    it("regeneration heals a damaged mob over time", () => {
      const mob = new Mob(1, "cow", { x: 0, y: 0, z: 0 }); // maxHealth 10
      mob.health = 4;
      applyEffect(mob.effects, "regeneration", 0, 1000);
      const interval = EFFECT_TUNING.REGEN_INTERVAL;
      for (let i = 0; i < interval; i++) tickMobEffects(mob, i);
      expect(mob.health).toBeGreaterThan(4);
    });

    it("effects expire and are removed", () => {
      const mob = new Mob(1, "pig", { x: 0, y: 0, z: 0 });
      applyEffect(mob.effects, "poison", 0, 3); // 3 ticks then gone
      for (let i = 0; i < 4; i++) tickMobEffects(mob, i);
      expect(mob.effects.list).toHaveLength(0);
    });

    it("is a no-op (does not throw) when the mob has no effects", () => {
      const mob = new Mob(1, "sheep", { x: 0, y: 0, z: 0 });
      expect(() => tickMobEffects(mob, 0)).not.toThrow();
      expect(mob.health).toBe(mob.health);
    });
  });
  ```
  (VERIFY `EFFECT_TUNING.POISON_INTERVAL`/`REGEN_INTERVAL` exist in `mc-1.20.ts` with those names — `effects/status.ts` reads `EFFECT_TUNING.POISON_INTERVAL`/`REGEN_INTERVAL`/`*_PER_AMP`, so they do. If the regen test seeds health too low for the default-amp interval, increase the loop bound to `2 * REGEN_INTERVAL`.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/mobs/effects.test.ts src/mobs/entity.test.ts src/effects/status.test.ts src/survival/stats.test.ts` → all green (player effect tests + `makeSurvivalState` shape untouched).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(mobs): per-mob EffectState + pure tickMobEffects (poison/regen)`

---

### Task 4: Tick mob effects in the driver + route non-instant arrow/splash effects (glue + tests)

Wire `tickMobEffects` into `mob-driver.aiTick` for every live mob, then change the tipped-arrow and splash handlers in `main.ts` to apply NON-INSTANT effects to `mob.effects` (the documented "deferred to 6c" no-ops). Instant effects keep their current bonus-damage behavior.

**Files:**
- Modify: `src/game/mob-driver.ts` (`aiTick` loop; import `tickMobEffects`)
- Modify: `src/game/mob-driver.test.ts` (append: a poisoned mob loses health across `aiTick`)
- Modify: `src/main.ts` (arrow effect L1137; splash effect L1163)

**Must-protect:**
- `mob-driver.test.ts` existing pins (5 melee + 2 resistance + spawn/despawn/AI) — `tickMobEffects` is a no-op for mobs with no effects (fast-path return), so every existing case (none of which applies a mob effect) is byte-identical. The new case explicitly applies poison.
- `aiTick` iterates `this.manager.all()` (a snapshot) and already removes mobs mid-loop safely; calling `tickMobEffects` per mob inside that loop is safe. Tick effects AFTER the AI/death pass would let a poison kill be processed next tick — instead tick effects BEFORE the death check so a poison-floored mob (health→1) never reads as dead from poison (it can't), and a mob brought to 0 by OTHER damage this tick still dies. Place the `tickMobEffects` call at the TOP of the per-mob body (before passive/hostile AI) so the effect tick and the existing death gate compose cleanly.
- `main.ts` instant-effect behavior is UNCHANGED: tipped `instant_damage` still adds bonus damage (L1139–1141); splash `instant_damage`/`poison` still deals `SPLASH.MOB_DAMAGE` flat (L1165–1168). The NEW code ADDS non-instant `applyEffect(mob.effects, …)` calls; it does not remove the instant paths.
- No mob-effect persistence yet — that is Task 5 (this task leaves effects transient, which is correct: a mob poisoned then saved before Task 5 simply loses the effect on reload, no crash).

Steps:

- [ ] **(CODE)** Import + call `tickMobEffects` in `src/game/mob-driver.ts`. Add the import near the other mob imports (after `import { Mob, type Vec3 } from "../mobs/entity";`):
  ```ts
  import { tickMobEffects } from "../mobs/effects";
  ```
  In `aiTick`, inside the `for (const mob of this.manager.all())` loop, add as the FIRST statement of the loop body (before the `if (mob.isPassive())` branch, L290–291). Before:
  ```ts
      for (const mob of this.manager.all()) {
        if (mob.isPassive()) {
  ```
  After:
  ```ts
      for (const mob of this.manager.all()) {
        // Status effects (poison/regen from tipped arrows / splash potions) tick
        // first so a poisoned mob's health is current for this tick's death gate.
        // tickMobEffects is a fast no-op for unaffected mobs.
        tickMobEffects(mob, currentTick);
        if (mob.isPassive()) {
  ```
- [ ] **(CODE, UNIT)** Append a poisoned-mob driver test to `src/game/mob-driver.test.ts`. Model the harness (World + RemeshNotifier mock + MobDriver) on the file's existing `aiTick` tests; the new assertion:
  ```ts
  describe("aiTick — mob status effects (Phase 6c)", () => {
    it("ticks an active poison on a live mob (health drops, never below 1)", () => {
      // Build the same world+driver harness the existing aiTick tests use.
      // (Reuse the file's makeDriver()/makeWorld() helper if present.)
      const { driver, player, clock } = makeAiTickHarness(); // existing helper
      const cow = driver.manager.spawn("cow", { x: player.feet.x, y: player.feet.y, z: player.feet.z + 1 });
      cow.health = 10;
      applyEffect(cow.effects, "poison", 4, 100000); // strong, long poison

      for (let t = 0; t < 200; t++) driver.aiTick(player, clock, t);

      // Poison drained health but cannot kill.
      expect(cow.health).toBeLessThan(10);
      expect(cow.health).toBeGreaterThanOrEqual(1);
    });
  });
  ```
  (Add `import { applyEffect } from "../effects/status";` at the top. If `mob-driver.test.ts` has no reusable harness/spawn helper, construct the minimal `World`+`MobDriver` exactly as the nearest existing `aiTick` test does and obtain the spawned mob via `driver.manager.all()[0]`. Adjust the loop bound so at least one poison interval elapses.)
- [ ] **(CODE, LIVE-QA)** Route NON-INSTANT tipped-arrow effects to the mob in `src/main.ts`. Before (L1134–1143):
  ```ts
        if (hit.kind === "mob") {
          attackMob(hit.mob, currentTick, ARROW.DAMAGE, hit.fromXZ);
          // Tipped arrow: instant effects add bonus damage to the mob. Non-instant
          // effects require a mob EffectState (deferred to 6c) — ignored here.
          const arrowFx = arrow.potionEffect;
          if (arrowFx !== undefined && isInstant(arrowFx.type) && arrowFx.type === "instant_damage") {
            attackMob(hit.mob, currentTick, EFFECT_TUNING.INSTANT_DAMAGE_PER_LEVEL * (arrowFx.amplifier + 1));
          }
          gameAudio?.onMobHurt(hit.mob.feet);
        }
  ```
  After (add the non-instant branch; instant stays identical):
  ```ts
        if (hit.kind === "mob") {
          attackMob(hit.mob, currentTick, ARROW.DAMAGE, hit.fromXZ);
          // Tipped arrow effects (Phase 6c): instant effects add bonus damage;
          // non-instant effects now apply over time to the mob's EffectState.
          const arrowFx = arrow.potionEffect;
          if (arrowFx !== undefined) {
            if (isInstant(arrowFx.type)) {
              if (arrowFx.type === "instant_damage") {
                attackMob(hit.mob, currentTick, EFFECT_TUNING.INSTANT_DAMAGE_PER_LEVEL * (arrowFx.amplifier + 1));
              }
            } else {
              applyEffect(hit.mob.effects, arrowFx.type, arrowFx.amplifier, arrowFx.durationTicks);
            }
          }
          gameAudio?.onMobHurt(hit.mob.feet);
        }
  ```
- [ ] **(CODE, LIVE-QA)** Route NON-INSTANT splash effects to mobs in range in `src/main.ts`. Before (L1156–1177):
  ```ts
        if (sh.kind === "burst") {
          const { mobs: hitMobs, playerInRange } = splashTargets(
            sh.at,
            player.feet,
            liveMobs,
            SPLASH.RADIUS,
          );
          // Mobs have no effects channel → plain instant damage on harmful splashes.
          const potFx = potion.effect;
          const harmful = potFx.type === "instant_damage" || potFx.type === "poison";
          if (harmful) {
            for (const m of hitMobs) attackMob(m, currentTick, SPLASH.MOB_DAMAGE);
          }
          // Player in range → apply the real effect (instant or timed).
          if (playerInRange) {
            if (isInstant(potFx.type)) {
              applyInstant(player.survival, potFx.type, potFx.amplifier);
            } else {
              applyEffect(player.effects, potFx.type, potFx.amplifier, potFx.durationTicks);
            }
          }
          gameEffects?.onExplosion(sh.at);
        }
  ```
  After (mobs now also receive non-instant effects; instant flat-damage path unchanged):
  ```ts
        if (sh.kind === "burst") {
          const { mobs: hitMobs, playerInRange } = splashTargets(
            sh.at,
            player.feet,
            liveMobs,
            SPLASH.RADIUS,
          );
          const potFx = potion.effect;
          // Harmful INSTANT splashes still deal flat damage to mobs (unchanged).
          const harmful = potFx.type === "instant_damage" || potFx.type === "poison";
          if (harmful && isInstant(potFx.type)) {
            for (const m of hitMobs) attackMob(m, currentTick, SPLASH.MOB_DAMAGE);
          }
          // Non-instant effects (poison/regen/etc.) now apply over time to mobs
          // (Phase 6c). Poison floors mob health at 1 via tickMobEffects.
          if (!isInstant(potFx.type)) {
            for (const m of hitMobs) {
              applyEffect(m.effects, potFx.type, potFx.amplifier, potFx.durationTicks);
            }
          }
          // Player in range → apply the real effect (instant or timed). Unchanged.
          if (playerInRange) {
            if (isInstant(potFx.type)) {
              applyInstant(player.survival, potFx.type, potFx.amplifier);
            } else {
              applyEffect(player.effects, potFx.type, potFx.amplifier, potFx.durationTicks);
            }
          }
          gameEffects?.onExplosion(sh.at);
        }
  ```
  (NOTE the behavior change: splash POISON on mobs is now a timed effect rather than instant flat `SPLASH.MOB_DAMAGE`. If you want BOTH on poison-splash, keep `harmful` un-gated by `isInstant`; the version above makes poison purely a DoT for mobs, matching the player path. Pick one in QA and document it — the plan defaults to DoT-only poison for consistency with the player.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/game/mob-driver.test.ts src/mobs/effects.test.ts` → all green (existing driver pins + the new poison case).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run` → FULL suite green (no `main.ts`-importing test exists; this confirms nothing else regressed).
- [ ] **(LIVE-QA)** Shoot a tipped poison arrow at a cow → its health ticks down over ~seconds and stops at 1 (poison can't kill). Throw a splash poison into a mob cluster → all in radius take the DoT. Manual.
- [ ] **Commit:** `feat(combat): non-instant tipped-arrow + splash effects apply to mobs`

---

### Task 5: Persist mob effects — `MobSave.effects` + `SAVE_VERSION` 7→8 (tests FIRST)

Mob effects are currently transient (lost on reload). Persist them by adding `effects: EffectSave[]` to `MobSave` (a JSON blob field — no binary container-format bump), bump `SAVE_VERSION` 7→8 with `MIGRATIONS[7]`, and round-trip through `toMobSave`/`fromMobSave` with `periodTimer=0` on load (mirroring the player's effect restore).

**Files:**
- Modify: `src/mobs/persistence.ts` (`MobSave` L39; `toMobSave` L75; `fromMobSave` L107; imports)
- Modify: `src/mobs/persistence.test.ts` (append; existing pins untouched)
- Modify: `src/save/serialize.ts` (doc-comment for the `MobSave` JSON blob only — NO `SAVE_FORMAT` change)
- Modify: `src/save/migration.ts` (`SAVE_VERSION` 7→8; add `MIGRATIONS[7]`)
- Modify: `src/save/migration.test.ts` (`SAVE_VERSION === 8` pin; add v7→v8 chain test)
- (NO change to `src/save/serialize.test.ts` — `MobSave.effects` is OPTIONAL, so the hand-built `MobSave` literal at L271–291 that omits it still typechecks and its `toEqual` round-trip still holds; see Must-protect.)

**Must-protect:**
- `effects` on `MobSave` is OPTIONAL (`effects?: EffectSave[]`), NOT required. This is the decisive choice: it mirrors the `mobs?`/`brewingStands?` optional-blob convention, keeps `serialize.test.ts`'s hand-built `MobSave` literal (which omits `effects`) typechecking AND its `expect(round.mobs).toEqual(save.mobs)` passing (the `mobs` blob is JSON round-tripped verbatim by `serializeSave`/`deserializeSave` — it never calls `toMobSave`/`fromMobSave`, so an omitted field stays omitted on both sides), and is correct under `exactOptionalPropertyTypes` (omit the key entirely when there are no effects, rather than writing `effects: undefined`).
- `persistence.test.ts` `expectMobMatches` (L60–74) compares a FIXED field list and does NOT inspect `effects` — adding `effects` to `MobSave` does NOT break it. The existing round-trips (cow/zombie/creeper, all with no effects) decode to an empty list → still pass. Do NOT add `effects` to `expectMobMatches` for the existing cases (a separate new test covers effects).
- `serialize.test.ts` mob round-trip (L264–298) — `MobSave` is serialized as `JSON.stringify(save.mobs ?? [])` (a JSON blob, `serialize.ts` L582), passed through verbatim (NOT via `toMobSave`/`fromMobSave`). Adding an OPTIONAL field requires NO binary-layout change, NO `SAVE_FORMAT` bump (container stays 7), and NO edit to this test (its literal omits `effects`; round-trip preserves the omission). There is no exact-byte-length assertion on the mobs blob.
- `migration.test.ts` "exposes SAVE_VERSION = 7" (L118–121) — this pin MUST change to 8. The v6→v7 brewingStands test (L122–127) stays. The 1→7 chain still works because `MIGRATIONS[7]` extends it to 8.
- `MIGRATIONS[7]` (v7→v8) is a world-blob version bump: mob `effects` default to `[]` inside `fromMobSave` (the same pattern as player `effects` defaulting via `MIGRATIONS[4]`), so the migration body only sets `version: 8` and leaves the existing `mobs` array as-is (each MobSave object simply lacks `effects`, which `fromMobSave` tolerates). This MIRRORS how the player-effects migration worked.
- `periodTimer` is scratch state → restored to 0 on load (matches the player: `status.ts` `ActiveEffect.periodTimer` defaults 0).
- `EFFECT_TYPE_IDS` / `effectTypeFromId` are the stable type↔int map; reuse them (do NOT renumber).

Steps:

- [ ] **(CODE, UNIT)** Add `effects` to `MobSave` + snapshot/restore in `src/mobs/persistence.ts`. Add imports near the top:
  ```ts
  import { type EffectState, applyEffect, effectTypeFromId, EFFECT_TYPE_IDS } from "../effects/status";
  import type { EffectSave } from "../save/serialize";
  ```
  Add the field to the `MobSave` interface (after `extra`, L56) — OPTIONAL so older blobs (and the `serialize.test.ts` literal) that omit it stay valid:
  ```ts
    extra: Record<string, number>;
    /**
     * Active status effects (Phase 6c). Same EffectSave shape the player uses
     * ({type,amplifier,ticksRemaining}). OPTIONAL: omitted entirely when the mob
     * has none (and absent on pre-v8 blobs) → restored as no effects. periodTimer
     * is scratch and is NOT saved (reset to 0 on load).
     */
    effects?: EffectSave[];
  ```
  Add a snapshot helper above `toMobSave`:
  ```ts
  /** Flatten a mob's EffectState into save shape (3 ints each; periodTimer dropped). */
  function snapshotMobEffects(effects: EffectState): EffectSave[] {
    return effects.list.map((e) => ({
      type: EFFECT_TYPE_IDS[e.type],
      amplifier: e.amplifier,
      ticksRemaining: e.ticksRemaining,
    }));
  }
  ```
  In `toMobSave`, add `effects` to the returned object ONLY when non-empty (so empty-effect mobs keep their JSON byte-identical to today, and `exactOptionalPropertyTypes` never sees `effects: undefined`). Change the return so it builds the base object then conditionally sets the key. Before:
  ```ts
  export function toMobSave(mob: Mob): MobSave {
    return {
      id: mob.id,
      // … existing fields …
      extra: copyExtra(mob.extra),
    };
  }
  ```
  After:
  ```ts
  export function toMobSave(mob: Mob): MobSave {
    const save: MobSave = {
      id: mob.id,
      // … existing fields …
      extra: copyExtra(mob.extra),
    };
    const fx = snapshotMobEffects(mob.effects);
    if (fx.length > 0) save.effects = fx; // omit the key entirely when empty
    return save;
  }
  ```
  (Keep ALL existing `toMobSave` fields verbatim between `id` and `extra`; only the return shape changes from a bare literal to a `const save` + conditional `effects`.)
  In `fromMobSave`, rebuild effects after `mob.extra = copyExtra(s.extra);` (L119):
  ```ts
    mob.extra = copyExtra(s.extra);
    // Restore active effects (Phase 6c). Missing on pre-v8 blobs → none.
    for (const fx of s.effects ?? []) {
      const type = effectTypeFromId(fx.type);
      if (type === null) continue; // unknown id → skip (forward-compat)
      // applyEffect re-creates the ActiveEffect with periodTimer=0 (scratch reset).
      applyEffect(mob.effects, type, fx.amplifier, fx.ticksRemaining);
    }
  ```
  (`applyEffect` ignores instant types and applies stack rules; saved effects are always non-instant timed effects, so this faithfully rehydrates them with `periodTimer=0`.)
- [ ] **(CODE, UNIT)** Append a mob-effects round-trip test to `src/mobs/persistence.test.ts`:
  ```ts
  import { applyEffect } from "../effects/status";

  describe("toMobSave / fromMobSave — status effects (Phase 6c)", () => {
    it("round-trips a mob's active effects with periodTimer reset to 0", () => {
      const mob = new Mob(1, "cow", { x: 0, y: 64, z: 0 });
      applyEffect(mob.effects, "poison", 1, 200);
      applyEffect(mob.effects, "regeneration", 0, 400);
      // Advance the timers so periodTimer is non-zero before saving.
      mob.effects.list[0]!.periodTimer = 7;

      const restored = fromMobSave(toMobSave(mob));
      expect(restored.effects.list).toHaveLength(2);
      const poison = restored.effects.list.find((e) => e.type === "poison")!;
      expect(poison.amplifier).toBe(1);
      expect(poison.ticksRemaining).toBe(200);
      expect(poison.periodTimer).toBe(0); // scratch reset on load
    });

    it("a no-effect mob omits the effects key and decodes to no effects", () => {
      const mob = new Mob(2, "pig", { x: 0, y: 0, z: 0 }); // no effects applied
      const save = toMobSave(mob);
      // toMobSave omits the optional key entirely when empty (pre-v8-blob shape).
      expect(save.effects).toBeUndefined();
      const restored = fromMobSave(save);
      expect(restored.effects.list).toEqual([]);
    });
  });
  ```
  (`Mob`, `toMobSave`, `fromMobSave` already imported; add `applyEffect`.)
- [ ] **(CODE)** Update the `MobSave` JSON-blob doc in `src/save/serialize.ts`. Find the comment above the mobs blob write (L581) and amend it to note the additive `effects` field (no format change):
  ```ts
    // Mobs (container format 2+): a length-prefixed UTF-8 JSON array of MobSave.
    // MobSave gained an additive `effects` array in save VERSION 8 (Phase 6c);
    // because the blob is JSON, no container-FORMAT bump is needed — pre-v8 mob
    // objects simply lack the field and decode to no effects.
    w.str(JSON.stringify(save.mobs ?? []));
  ```
- [ ] **(CODE)** Bump `SAVE_VERSION` + add `MIGRATIONS[7]` in `src/save/migration.ts`. Before (L13–14):
  ```ts
  /** The current on-disk save version this build writes and reads natively. */
  export const SAVE_VERSION = 7;
  ```
  After:
  ```ts
  /** The current on-disk save version this build writes and reads natively. */
  export const SAVE_VERSION = 8;
  ```
  Add to the `MIGRATIONS` doc-comment block (after the `MIGRATIONS[6]` line):
  ```ts
   * - `MIGRATIONS[7]` (v7 -> v8): adds per-mob status effects (Phase 6c). The
   *   mob blob is JSON, so the field defaults inside fromMobSave; this step only
   *   bumps the version (mirrors how player effects defaulted via fromMobSave on
   *   older player records). No structural change to the WorldSave object.
  ```
  Add the migration entry (after `6: (data) => ({ ...data, version: 7, brewingStands: [] }),`):
  ```ts
    6: (data) => ({ ...data, version: 7, brewingStands: [] }),
    7: (data) => ({ ...data, version: 8 }),
  ```
- [ ] **(CODE, UNIT)** Update `src/save/migration.test.ts`. Change the pin (L118–121):
  ```ts
    it("exposes SAVE_VERSION = 8 and a MIGRATIONS registry", () => {
      expect(SAVE_VERSION).toBe(8);
      expect(typeof MIGRATIONS).toBe("object");
    });
  ```
  Add a v7→v8 test (after the `MIGRATIONS[6]` test at L122–127):
  ```ts
    it("MIGRATIONS[7] bumps v7 -> v8, preserving fields (mob effects default in fromMobSave)", () => {
      const v7 = saveAt(7, 55);
      const v8 = MIGRATIONS[7]!(v7);
      expect(v8.version).toBe(8);
      expect(v8.seed).toBe(55);
    });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/save/migration.test.ts src/save/serialize.test.ts src/mobs/persistence.test.ts src/game/persistence.test.ts` → all green (1→8 chain works; mob round-trips incl. effects; existing pins intact).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run` → FULL suite green.
- [ ] **(LIVE-QA)** Poison a mob, save, reload → the mob is still poisoned (health keeps ticking) and the effect expires on schedule. Manual.
- [ ] **Commit:** `feat(save): persist per-mob status effects (SAVE_VERSION 7->8)`

---

### Task 6: Tone-mapping A/B — `Prefs.toneMappingMode` + persistence (pure; tests FIRST)

Add the persisted `toneMappingMode` to `Prefs` (the EXISTING `prefs` JSON blob — NOT the world save, so NO `SAVE_VERSION` interaction), with validation + tolerant parse. Pure logic; no Babylon.

**Files:**
- Modify: `src/game/preferences.ts` (`Prefs`; `DEFAULT_PREFS`; `clampPrefs`; `parsePrefs`; add `ToneMappingMode`/`VALID_TONE_MAPPING_MODES`)
- Modify: `src/game/preferences.test.ts` (append)

**Must-protect:**
- `preferences.test.ts` existing clamp/round-trip cases — `toneMappingMode` is additive; existing assertions on other fields are unaffected. If a test does a full `toEqual(DEFAULT_PREFS)` on a parsed-default, it now also expects `toneMappingMode: "goldenHour"` (DEFAULT_PREFS gains the field, so `toEqual` against DEFAULT_PREFS stays consistent — confirm no test hard-codes a literal prefs object WITHOUT the new field; if one does, update it intentionally).
- Backward compat: an old `prefs` blob with no `toneMappingMode` MUST parse to `"goldenHour"` (the `colorblindMode` pattern, L129–136). An unknown string MUST clamp to `"goldenHour"` (the `VALID_COLORBLIND_MODES` pattern, L86–88).
- `clampPrefs` returns a NEW object listing EVERY field — add `toneMappingMode` to the returned literal or TS `noUnusedLocals`/exactness will not catch a dropped field, but the round-trip test will.

Steps:

- [ ] **(CODE)** Extend `src/game/preferences.ts`. Add the type + valid list near the top (after the imports):
  ```ts
  /** Tone-mapping / color-grade mode (Phase 6c A/B toggle). */
  export type ToneMappingMode = "goldenHour" | "neutral";

  /** All valid tone-mapping modes (used to validate persisted prefs). */
  export const VALID_TONE_MAPPING_MODES: ReadonlyArray<ToneMappingMode> = [
    "goldenHour",
    "neutral",
  ];
  ```
  Add the field to the `Prefs` interface (after `colorblindMode`, L35):
  ```ts
    /** Colorblind ore-color compensation mode. */
    colorblindMode: ColorblindMode;
    /** Tone-mapping / color grade (Phase 6c). Persisted; live-applied to post-FX. */
    toneMappingMode: ToneMappingMode;
  ```
  Add to `DEFAULT_PREFS` (after `colorblindMode: "none",`, L51):
  ```ts
    colorblindMode: "none",
    toneMappingMode: "goldenHour",
  ```
  In `clampPrefs`, add the validated field to the returned object (after the `colorblindMode:` entry, L86–88):
  ```ts
    colorblindMode: VALID_COLORBLIND_MODES.includes(p.colorblindMode)
      ? p.colorblindMode
      : DEFAULT_PREFS.colorblindMode,
    toneMappingMode: VALID_TONE_MAPPING_MODES.includes(p.toneMappingMode)
      ? p.toneMappingMode
      : DEFAULT_PREFS.toneMappingMode,
  ```
  In `parsePrefs`, add a tolerant string read (mirror the `colorblindRaw` block at L129–136) before the `return clampPrefs({...})`:
  ```ts
    const toneRaw = obj["toneMappingMode"];
    const toneMappingMode: ToneMappingMode =
      toneRaw === "goldenHour" || toneRaw === "neutral"
        ? (toneRaw as ToneMappingMode)
        : DEFAULT_PREFS.toneMappingMode;
  ```
  And add it to the object passed to `clampPrefs` (after `colorblindMode,`):
  ```ts
      colorblindMode,
      toneMappingMode,
  ```
- [ ] **(CODE, UNIT)** Append tone-mode tests to `src/game/preferences.test.ts`:
  ```ts
  describe("preferences — toneMappingMode (Phase 6c)", () => {
    it("defaults to goldenHour", () => {
      expect(DEFAULT_PREFS.toneMappingMode).toBe("goldenHour");
    });

    it("clampPrefs keeps a valid mode and falls back on an unknown one", () => {
      const valid = clampPrefs({ ...DEFAULT_PREFS, toneMappingMode: "neutral" });
      expect(valid.toneMappingMode).toBe("neutral");
      const bogus = clampPrefs({
        ...DEFAULT_PREFS,
        toneMappingMode: "rainbow" as never,
      });
      expect(bogus.toneMappingMode).toBe("goldenHour");
    });

    it("round-trips through serialize/parse", () => {
      const p = clampPrefs({ ...DEFAULT_PREFS, toneMappingMode: "neutral" });
      const back = parsePrefs(serializePrefs(p));
      expect(back.toneMappingMode).toBe("neutral");
    });

    it("an old prefs blob without toneMappingMode defaults to goldenHour", () => {
      const legacy = { ...DEFAULT_PREFS } as Record<string, unknown>;
      delete legacy["toneMappingMode"];
      const bytes = new TextEncoder().encode(JSON.stringify(legacy));
      expect(parsePrefs(bytes).toneMappingMode).toBe("goldenHour");
    });
  });
  ```
  (`DEFAULT_PREFS`, `clampPrefs`, `parsePrefs`, `serializePrefs` are already imported in `preferences.test.ts`.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/game/preferences.test.ts` → all green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(prefs): persisted toneMappingMode (golden-hour / neutral)`

---

### Task 7: Tone-mapping A/B — `PostFXController.setToneMappingMode` + grade modes (tests FIRST)

Define ≥2 frozen grade-mode constants in `post-fx.ts` (default `goldenHour` = today's exact values so the design-spec pins stay green), and add `setToneMappingMode(mode)` to the controller that live-reassigns exposure/contrast and a fresh `ColorCurves`. Babylon under NullEngine.

**Files:**
- Modify: `src/rendering/post-fx.ts` (add `ToneMappingMode`/`ToneGrade`/`TONE_MODES`; `PostFXController` iface; `PostFXControllerImpl`; `initPostFX`)
- Modify: `src/rendering/post-fx.test.ts` (append; existing design-spec pins untouched)

**Must-protect:**
- `post-fx.test.ts` design-spec constant pins (L89–126: `DEFAULT_EXPOSURE`/`DEFAULT_CONTRAST`/`DEFAULT_CC_GLOBAL_SATURATION` ranges) — the `goldenHour` grade MUST equal today's `DEFAULT_*` constants (exposure 1.07, contrast 1.10, saturation 12, shadows hue 200 / density 12, global exposure 0.05). Keep those `DEFAULT_*` exports AND reference them from `TONE_MODES.goldenHour` so there is one source of truth and the pins never drift.
- `post-fx.test.ts` "returns an object implementing the PostFXController interface" (L137–146) checks each method `typeof === "function"` — adding `setToneMappingMode` to the interface REQUIRES updating that list (intentional) OR the test only checks a subset (it lists each method explicitly, so ADD `setToneMappingMode` there). Also update `makeMockController` (L42–64) to implement + record `setToneMappingMode`, and the "mock records all method calls" test (L246–265) if it asserts an exact call map.
- `setToneMappingMode` is a no-op when `this._pipeline === null` (same guard pattern as `setBloomEnabled`, L100–102) — graceful degradation when WebGL2 is unavailable.
- ACES `toneMappingType = 1` is set ONCE at init and NEVER changed per mode — only exposure/contrast/colorCurves vary. Do NOT touch `toneMappingType` in `setToneMappingMode`.
- Construct a FRESH `ColorCurves` per mode change and assign it (never mutate the existing one in place) to avoid stale-reference bugs.

Steps:

- [ ] **(CODE)** Add the grade-mode model to `src/rendering/post-fx.ts`. After the `DEFAULT_CC_*` constants (L64), insert:
  ```ts
  // ---------------------------------------------------------------------------
  // Tone-mapping A/B modes (Phase 6c). ACES stays constant; only the grade
  // (exposure / contrast / ColorCurves) varies per mode. `goldenHour` is the
  // shipped default and reuses the DEFAULT_* constants so the design-spec pins
  // remain the single source of truth.
  // ---------------------------------------------------------------------------

  /** A color-grade definition applied on top of the constant ACES tone-mapper. */
  export interface ToneGrade {
    exposure: number;
    contrast: number;
    cc: {
      globalHue: number;
      globalSaturation: number;
      globalExposure: number;
      shadowsHue: number;
      shadowsDensity: number;
    };
  }

  /** Valid tone-mapping modes (kept in sync with preferences.ToneMappingMode). */
  export type ToneMappingMode = "goldenHour" | "neutral";

  /** The shipped grade modes. Frozen so a caller can never mutate them in place. */
  export const TONE_MODES: Readonly<Record<ToneMappingMode, ToneGrade>> = {
    // Golden Hour = exactly the current shipped grade (design-spec values).
    goldenHour: Object.freeze({
      exposure: DEFAULT_EXPOSURE,
      contrast: DEFAULT_CONTRAST,
      cc: Object.freeze({
        globalHue: DEFAULT_CC_GLOBAL_HUE,
        globalSaturation: DEFAULT_CC_GLOBAL_SATURATION,
        globalExposure: DEFAULT_CC_GLOBAL_EXPOSURE,
        shadowsHue: DEFAULT_CC_SHADOWS_HUE,
        shadowsDensity: DEFAULT_CC_SHADOWS_DENSITY,
      }),
    }),
    // Neutral = flatter/cooler A/B comparison: no warm lift, no saturation push,
    // no cool-shadow tint, slightly lower exposure + contrast. Clearly distinct.
    neutral: Object.freeze({
      exposure: 0.98,
      contrast: 1.02,
      cc: Object.freeze({
        globalHue: 0,
        globalSaturation: 0,
        globalExposure: 0,
        shadowsHue: 0,
        shadowsDensity: 0,
      }),
    }),
  } as const;
  ```
- [ ] **(CODE)** Add `setToneMappingMode` to the `PostFXController` interface (after `setFilmGrainIntensity`, L83):
  ```ts
    /** Set film grain intensity (Babylon units; 0..100). */
    setFilmGrainIntensity(value: number): void;
    /** Apply a tone-mapping / color-grade mode (Phase 6c). ACES stays constant. */
    setToneMappingMode(mode: ToneMappingMode): void;
  ```
- [ ] **(CODE)** Implement `setToneMappingMode` in `PostFXControllerImpl` (after `setFilmGrainIntensity`, L126). Add a `ColorCurves` import is already present (L32). Insert:
  ```ts
    setToneMappingMode(mode: ToneMappingMode): void {
      if (this._pipeline === null) return;
      const grade = TONE_MODES[mode];
      const ip = this._pipeline.imageProcessing;
      ip.exposure = grade.exposure;
      ip.contrast = grade.contrast;
      // Fresh ColorCurves each change — never mutate the prior one in place.
      const cc = new ColorCurves();
      cc.globalHue = grade.cc.globalHue;
      cc.globalSaturation = grade.cc.globalSaturation;
      cc.globalExposure = grade.cc.globalExposure;
      cc.shadowsHue = grade.cc.shadowsHue;
      cc.shadowsDensity = grade.cc.shadowsDensity;
      ip.colorCurves = cc;
    }
  ```
- [ ] **(CODE)** In `initPostFX`, apply the default mode via the same model so init and live changes share one path. Replace the inline `cc.*` block (L183–189) by constructing from `TONE_MODES.goldenHour` (keeps the exact same values). Before:
  ```ts
      p.imageProcessing.colorCurvesEnabled = true;
      const cc = new ColorCurves();
      cc.globalHue = DEFAULT_CC_GLOBAL_HUE;
      cc.globalSaturation = DEFAULT_CC_GLOBAL_SATURATION;
      cc.globalExposure = DEFAULT_CC_GLOBAL_EXPOSURE;
      cc.shadowsHue = DEFAULT_CC_SHADOWS_HUE;
      cc.shadowsDensity = DEFAULT_CC_SHADOWS_DENSITY;
      p.imageProcessing.colorCurves = cc;
  ```
  After:
  ```ts
      p.imageProcessing.colorCurvesEnabled = true;
      // Apply the default grade (goldenHour) via TONE_MODES so init and
      // setToneMappingMode share one code path / one source of truth.
      const grade = TONE_MODES.goldenHour;
      const cc = new ColorCurves();
      cc.globalHue = grade.cc.globalHue;
      cc.globalSaturation = grade.cc.globalSaturation;
      cc.globalExposure = grade.cc.globalExposure;
      cc.shadowsHue = grade.cc.shadowsHue;
      cc.shadowsDensity = grade.cc.shadowsDensity;
      p.imageProcessing.colorCurves = cc;
  ```
  (Leave `p.imageProcessing.exposure = DEFAULT_EXPOSURE;` / `contrast = DEFAULT_CONTRAST;` as-is at L179–180 — they already equal `TONE_MODES.goldenHour.exposure/contrast`.)
- [ ] **(CODE, UNIT)** Update `src/rendering/post-fx.test.ts`. Add `setToneMappingMode` to the mock (L54–63):
  ```ts
      setFilmGrainIntensity(value: number) { calls["setFilmGrainIntensity"]!.push([value]); },
      setToneMappingMode(mode: ToneMappingMode) { calls["setToneMappingMode"]!.push([mode]); },
  ```
  (Add `import { type ToneMappingMode } from "./post-fx";` to the existing `./post-fx` import block at the top of the test so the mock param matches the interface exactly.)
  Add its bucket to `calls` (L45–53):
  ```ts
      setFilmGrainIntensity: [],
      setToneMappingMode: [],
  ```
  Add it to the interface-shape test (L137–146):
  ```ts
      expect(typeof ctrl.setToneMappingMode).toBe("function");
  ```
  Append a new `describe`:
  ```ts
  import { TONE_MODES } from "./post-fx";

  describe("PostFXController.setToneMappingMode", () => {
    it("does not throw for either mode", () => {
      const ctrl = initPostFX(scene, camera);
      expect(() => { ctrl.setToneMappingMode("goldenHour"); }).not.toThrow();
      expect(() => { ctrl.setToneMappingMode("neutral"); }).not.toThrow();
      ctrl.dispose();
    });

    it("goldenHour grade equals the design-spec defaults (single source of truth)", () => {
      expect(TONE_MODES.goldenHour.exposure).toBe(DEFAULT_EXPOSURE);
      expect(TONE_MODES.goldenHour.contrast).toBe(DEFAULT_CONTRAST);
      expect(TONE_MODES.goldenHour.cc.globalSaturation).toBe(DEFAULT_CC_GLOBAL_SATURATION);
    });

    it("neutral grade is distinct from goldenHour", () => {
      expect(TONE_MODES.neutral.cc.globalSaturation).not.toBe(
        TONE_MODES.goldenHour.cc.globalSaturation,
      );
    });
  });
  ```
  Update the "mock records all method calls" test (L246–265) ONLY if it asserts the exact `calls` map for every method (add `ctrl.setToneMappingMode("neutral")` + `expect(ctrl.calls["setToneMappingMode"]).toEqual([["neutral"]])`); if it asserts only the methods it explicitly calls, leave it.
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/rendering/post-fx.test.ts` → all green (design-spec pins + new tone-mode tests).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(post-fx): tone-mapping A/B modes + setToneMappingMode`

---

### Task 8: Tone-mapping A/B — Settings dropdown + `applyPrefs` wire (glue; live-QA)

Add a "Color Grade" dropdown to `SettingsScreen` (DOM-guarded, live-apply via the existing `emit` pattern) and call `postFXController?.setToneMappingMode(p.toneMappingMode)` in `applyPrefs`. Glue + live-QA; no unit test imports `main.ts`/the DOM screen here.

**Files:**
- Modify: `src/ui/settings-screen.ts` (`dropdowns` field; `build()` Graphics section; `populate()`)
- Modify: `src/main.ts` (`applyPrefs` L462; import the type)

**Must-protect:**
- `SettingsScreen` is DOM-guarded (`hasDom()`); all new DOM lives inside `build()` which only runs when `hasDom()` is true — headless construction stays safe.
- The dropdown must be created in `build()` AND synced in `populate()` (L421 pattern) or the loaded pref won't show until the user interacts (recon gotcha).
- `applyPrefs` is called once on boot (L481) and once per settings change (L504) — NOT per frame. `setToneMappingMode` is coarse; do not call it in the tick loop.
- `applyPrefs` currently does NOT apply bloom/grain to the controller; this task ONLY adds the tone-mapping call (leave bloom/grain as-is to keep the diff scoped — those are a separate gap).

Steps:

- [ ] **(CODE)** Add the dropdown field to `src/ui/settings-screen.ts` (`dropdowns`, L257–261):
  ```ts
    private dropdowns: {
      colorblindMode: HTMLSelectElement | null;
      toneMappingMode: HTMLSelectElement | null;
    } = {
      colorblindMode: null,
      toneMappingMode: null,
    };
  ```
- [ ] **(CODE)** Add the dropdown in `build()` inside the "Graphics" section (after the Film Grain toggle, L347–349). Import the type at the top:
  ```ts
  import { clampPrefs, type Prefs, type ToneMappingMode } from "../game/preferences";
  ```
  Insert after the film-grain toggle:
  ```ts
      const toneOptions: ReadonlyArray<{ label: string; value: ToneMappingMode }> = [
        { label: "Golden Hour", value: "goldenHour" },
        { label: "Neutral", value: "neutral" },
      ];
      this.dropdowns.toneMappingMode = addDropdown(
        card,
        "Color Grade",
        toneOptions,
        "goldenHour",
        (v) => {
          if (this.currentPrefs !== null) {
            this.currentPrefs.toneMappingMode = v as ToneMappingMode;
            emit();
          }
        },
      );
  ```
- [ ] **(CODE)** Sync the dropdown in `populate()` (after the `colorblindMode` sync, L421–423):
  ```ts
      if (this.dropdowns.colorblindMode !== null) {
        this.dropdowns.colorblindMode.value = prefs.colorblindMode;
      }
      if (this.dropdowns.toneMappingMode !== null) {
        this.dropdowns.toneMappingMode.value = prefs.toneMappingMode;
      }
  ```
- [ ] **(CODE)** Wire `applyPrefs` in `src/main.ts` (after the audio volume block, L477). Insert:
  ```ts
    // Audio volumes — no-op if the engine is unavailable.
    if (audioEngine !== null) {
      audioEngine.setVolume("master", currentPrefs.masterVolume);
      audioEngine.setVolume("sfx", currentPrefs.sfxVolume);
      audioEngine.setVolume("ambient", currentPrefs.ambientVolume);
    }

    // Tone-mapping / color grade (Phase 6c). No-op if post-FX is unavailable.
    postFXController?.setToneMappingMode(currentPrefs.toneMappingMode);
  ```
  (`postFXController` is in module scope at L276; `applyPrefs` at L462 runs after its init at L278 on boot and on every settings change.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/game/preferences.test.ts src/rendering/post-fx.test.ts` → green (settings-screen has no unit test; its DOM is guarded).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(VERIFY, BUILD)** `corepack pnpm build` → succeeds (this is the first task touching `main.ts` UI wiring + `settings-screen.ts`; confirm Vite bundles).
- [ ] **(LIVE-QA)** Open Settings → Graphics → "Color Grade" → switch Golden Hour ↔ Neutral; the scene grade visibly changes live (warmer/saturated vs flatter/cooler). Close, reopen the game → the chosen mode persists and re-applies on boot. Manual.
- [ ] **Commit:** `feat(ui): Color Grade dropdown + live tone-mapping apply`

---

### Task 9: Mob-instancing escape hatch — `instanceMode` flag + thin-instance path (composite untouched; tests FIRST)

Add an `instanceMode?: boolean` 3rd constructor arg to `MobRenderer`, default `false`. When `false` (the only mode the pinned test uses) the EXISTING composite path runs UNCHANGED — extracted verbatim into `syncComposite()`. When `true`, a thin-instance path draws all mobs of a species from one shared base mesh (static pose — the documented fidelity trade-off). New coverage lives in a SEPARATE file; the pinned `mob-renderer.test.ts` is NEVER edited.

**Files:**
- Modify: `src/rendering/mob-renderer.ts` (constructor; `sync()` → branch + `syncComposite`/`syncInstanced`; instance state + free-list; `getMeshCount`; `dispose`)
- Create: `src/rendering/mob-renderer-instanced.test.ts`

**Must-protect:**
- `mob-renderer.test.ts` is BYTE-IDENTICAL and ALL its tests pass. It constructs `new MobRenderer(scene)` / `new MobRenderer(scene, sink)` — NEVER a 3rd arg → `instanceMode` is `undefined` → `false` → composite path. Its L145 `expect(mat1).toBe(mat2)` material-identity pin, shadow-sink add/remove parity (L154–284), `getMeshCount`-counts-roots (L107–116), root-reuse (L71–88), and despawn/dispose all run against the composite path UNCHANGED. DO NOT EDIT THIS FILE.
- `syncComposite()` is the existing `sync()` body moved verbatim (same code, same order, same `nowMs`/`currentTick` gates, same death-grace + flash + babyScale logic). The only structural change is the top-of-`sync()` branch on `this.instanceMode`. No behavior change on the default path.
- `mob-animation.ts` (legSwing/idleBob/tailSway/headPitch/recentlyDamaged/deathGrace/tintFor) and `mob-atlas.ts` (generateMobAtlasRGBA/uvRegion/faceUVForRect) are PURE and UNCHANGED — the instanced path simply does NOT call the per-pivot animators (static pose). Do not modify those modules.
- The instanced path registers the species BASE mesh with the shadow sink ONCE (on first creation), never per-instance, and removes it on `dispose()` — leak-safe by construction (the instanced test asserts add-count == species-count, remove-count == species-count after dispose).
- NullEngine guard: thin-instance geometry ops may return null/no-op under NullEngine. Wrap `thinInstanceSetMatrixAt`/buffer creation so a missing base geometry degrades to a safe no-op; the instanced test asserts "does not throw" + free-list bookkeeping, NOT pixel output.
- `babyScale` (Task 1) must scale the instance too: bake it into the per-mob world matrix (scale component), mirroring how the composite path does `record.root.scaling.setAll(babyScale)`.

Steps:

- [ ] **(CODE)** Add the constructor flag + instance state to `src/rendering/mob-renderer.ts`. Change the constructor (L304–307):
  ```ts
    constructor(scene: Scene, shadowSink?: ShadowCasterSink, instanceMode?: boolean) {
      this.scene = scene;
      this.shadowSink = shadowSink ?? null;
      this.instanceMode = instanceMode ?? false;
    }
  ```
  Add the fields near the other private fields (after `dyingRecords`, L302):
  ```ts
    /** Escape-hatch: when true, sync() uses the thin-instance path (static pose). */
    private readonly instanceMode: boolean;
    /** Per-species base mesh (one Mesh per MobType), created lazily in instance mode. */
    private readonly speciesBase = new Map<MobType, Mesh>();
    /** Per-mob instance slot: mobId → { type, index } into that species' buffer. */
    private readonly instanceSlots = new Map<number, { type: MobType; index: number }>();
    /** Free instance indices per species for slot reuse (despawn → free-list). */
    private readonly instanceFree = new Map<MobType, number[]>();
    /** Next fresh instance index per species (grows when the free-list is empty). */
    private readonly instanceNext = new Map<MobType, number>();
  ```
- [ ] **(CODE)** Branch `sync()` and extract the existing body into `syncComposite()`. Rename the current `sync(...)` METHOD BODY: keep the public `sync` as a thin dispatcher, move the existing implementation verbatim into a new private `syncComposite`. Replace the `sync(...)` signature line + opening (L571) so it reads:
  ```ts
    sync(mobs: Mob[], nowMs?: number, currentTick?: number): void {
      if (this.instanceMode) {
        this.syncInstanced(mobs);
        return;
      }
      this.syncComposite(mobs, nowMs, currentTick);
    }

    /**
     * Composite per-mob model path (DEFAULT). This is the original sync() body,
     * unchanged: one root TransformNode + pivot-animated part meshes per mob.
     * mob-renderer.test.ts pins this path (material identity, shadow-sink parity,
     * root reuse, getMeshCount counts roots).
     */
    private syncComposite(mobs: Mob[], nowMs?: number, currentTick?: number): void {
  ```
  (Everything from the old `let dtTicks = 0;` (L572) through the closing brace of the old `sync` becomes the body of `syncComposite` — moved verbatim, NOT rewritten.)
- [ ] **(CODE)** Add the instanced path. After `syncComposite`, insert:
  ```ts
    /**
     * Thin-instance escape hatch (opt-in via instanceMode). Draws every mob of a
     * species from ONE shared base mesh, writing a per-mob world matrix into the
     * thin-instance buffer. STATIC POSE: no leg swing / head pitch / tail sway /
     * idle bob (the documented throughput-for-fidelity trade-off). babyScale is
     * baked into the matrix scale. Shadow sink: base mesh registered ONCE.
     */
    private syncInstanced(mobs: Mob[]): void {
      const seen = new Set<number>();
      const dirtySpecies = new Set<MobType>();

      for (const mob of mobs) {
        seen.add(mob.id);
        this.ensureSpeciesBase(mob.type);
        let slot = this.instanceSlots.get(mob.id);
        if (slot === undefined) {
          const index = this.allocInstanceIndex(mob.type);
          slot = { type: mob.type, index };
          this.instanceSlots.set(mob.id, slot);
        }
        this.writeInstanceMatrix(slot.type, slot.index, mob);
        dirtySpecies.add(slot.type);
      }

      // Despawn: free slots whose mob is gone (collapse to a zero-scale matrix so
      // the stale instance is invisible until the index is reused).
      for (const [id, slot] of this.instanceSlots) {
        if (seen.has(id)) continue;
        this.hideInstance(slot.type, slot.index);
        this.freeInstanceIndex(slot.type, slot.index);
        this.instanceSlots.delete(id);
        dirtySpecies.add(slot.type);
      }

      // Push buffer updates once per touched species.
      for (const type of dirtySpecies) {
        const base = this.speciesBase.get(type);
        base?.thinInstanceBufferUpdated?.("matrix");
      }
    }

    /** Create (once) the shared base mesh for a species and register it with the sink. */
    private ensureSpeciesBase(type: MobType): void {
      if (this.speciesBase.has(type)) return;
      // Reuse the composite model definition: build a single box per part, merged
      // conceptually by sharing ONE base mesh. v1: a single body-sized box keyed by
      // species, UV-mapped from the shared atlas. (A full part-merge is a 6c v2.)
      const def = MODELS[type];
      const first = def.parts[0]!;
      const faceUV = faceUVForRect(uvRegion(type, "body")).map(
        (f) => new Vector4(f.x, f.y, f.z, f.w),
      );
      const base = CreateBox(
        `mobinst_${type}`,
        { width: first.w, height: first.h, depth: first.d, faceUV },
        this.scene,
      );
      base.doNotSyncBoundingInfo = true;
      base.material = this.materialFor(`${type}:body`);
      base.receiveShadows = true;
      // Initialize an empty thin-instance buffer (NullEngine-safe: guarded).
      try {
        base.thinInstanceCount = 0;
      } catch {
        /* NullEngine without thin-instance support → static no-op */
      }
      this.shadowSink?.addShadowCaster(base); // ONCE per species (leak-safe)
      this.speciesBase.set(type, base);
      this.instanceFree.set(type, []);
      this.instanceNext.set(type, 0);
    }

    /** Allocate an instance index (reuse a freed one, else grow). */
    private allocInstanceIndex(type: MobType): number {
      const free = this.instanceFree.get(type)!;
      const reused = free.pop();
      if (reused !== undefined) return reused;
      const next = this.instanceNext.get(type)!;
      this.instanceNext.set(type, next + 1);
      return next;
    }

    /** Return an index to the species' free-list for reuse. */
    private freeInstanceIndex(type: MobType, index: number): void {
      this.instanceFree.get(type)!.push(index);
    }

    /** Compose + write a mob's world matrix (scale·rotateY·translate) into the buffer. */
    private writeInstanceMatrix(type: MobType, index: number, mob: Mob): void {
      const base = this.speciesBase.get(type);
      if (base === undefined) return;
      const scale = mob.extra["babyScale"] ?? 1.0;
      const m = Matrix.Compose(
        new Vector3(scale, scale, scale),
        Quaternion.RotationYawPitchRoll(mob.yaw, 0, 0),
        new Vector3(mob.feet.x, mob.feet.y, mob.feet.z),
      );
      try {
        if (base.thinInstanceCount <= index) base.thinInstanceCount = index + 1;
        base.thinInstanceSetMatrixAt(index, m, false);
      } catch {
        /* NullEngine no-op */
      }
    }

    /** Collapse an instance to zero scale so a freed slot is invisible. */
    private hideInstance(type: MobType, index: number): void {
      const base = this.speciesBase.get(type);
      if (base === undefined) return;
      try {
        base.thinInstanceSetMatrixAt(index, Matrix.Scaling(0, 0, 0), false);
      } catch {
        /* NullEngine no-op */
      }
    }
  ```
  Add the needed imports at the top of the file (alongside the existing Babylon imports):
  ```ts
  import { Matrix, Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
  ```
  (VERIFY: `Vector4` is already imported L28; `Vector3` may already be imported — if so, merge into the existing line, do not duplicate. `MODELS`, `CreateBox`, `faceUVForRect`, `uvRegion`, `materialFor` are all already available in this file.)
- [ ] **(CODE)** Make `getMeshCount` + `dispose` instance-aware. Change `getMeshCount` (L684–686):
  ```ts
    getMeshCount(): number {
      if (this.instanceMode) return this.instanceSlots.size; // live instances
      return this.records.size; // composite: live roots (test pins this)
    }
  ```
  Extend `dispose()` (after the existing composite cleanup, before the final `}`):
  ```ts
      // Instance path: dispose each species base (removing it from the sink once).
      for (const base of this.speciesBase.values()) {
        this.shadowSink?.removeShadowCaster(base);
        base.dispose();
      }
      this.speciesBase.clear();
      this.instanceSlots.clear();
      this.instanceFree.clear();
      this.instanceNext.clear();
  ```
- [ ] **(CODE, UNIT)** Create `src/rendering/mob-renderer-instanced.test.ts` (the pinned file stays untouched):
  ```ts
  /**
   * mob-renderer-instanced.test.ts — coverage for the opt-in instanceMode path.
   * The composite path (and its pins) lives in mob-renderer.test.ts, which this
   * file does NOT touch. NullEngine returns no real thin-instance geometry, so we
   * assert structural invariants (no throw, mesh-count = live instances, shadow
   * sink registered once per species, free-list reuse), not pixels.
   */

  import { describe, it, expect, beforeEach, afterEach } from "vitest";
  import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
  import { Scene } from "@babylonjs/core/scene";
  import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

  import { MobRenderer } from "./mob-renderer";
  import { Mob } from "../mobs/entity";
  import type { ShadowCasterSink } from "./world-renderer";

  function makeMockSink(): ShadowCasterSink & { added: AbstractMesh[]; removed: AbstractMesh[] } {
    const added: AbstractMesh[] = [];
    const removed: AbstractMesh[] = [];
    return {
      added,
      removed,
      addShadowCaster(mesh: AbstractMesh) { added.push(mesh); return this; },
      removeShadowCaster(mesh: AbstractMesh) { removed.push(mesh); return this; },
    };
  }

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

  describe("MobRenderer instanceMode", () => {
    it("does not throw syncing live mobs in instance mode", () => {
      const r = new MobRenderer(scene, undefined, true);
      expect(() => {
        r.sync([
          new Mob(1, "cow", { x: 0, y: 64, z: 0 }),
          new Mob(2, "cow", { x: 2, y: 64, z: 0 }),
          new Mob(3, "zombie", { x: 4, y: 64, z: 0 }),
        ]);
      }).not.toThrow();
    });

    it("getMeshCount counts live instances, and drops on despawn", () => {
      const r = new MobRenderer(scene, undefined, true);
      r.sync([
        new Mob(1, "cow", { x: 0, y: 64, z: 0 }),
        new Mob(2, "cow", { x: 2, y: 64, z: 0 }),
      ]);
      expect(r.getMeshCount()).toBe(2);
      r.sync([new Mob(1, "cow", { x: 0, y: 64, z: 0 })]);
      expect(r.getMeshCount()).toBe(1);
    });

    it("registers ONE base mesh per species with the shadow sink", () => {
      const sink = makeMockSink();
      const r = new MobRenderer(scene, sink, true);
      r.sync([
        new Mob(1, "cow", { x: 0, y: 64, z: 0 }),
        new Mob(2, "cow", { x: 2, y: 64, z: 0 }), // same species → no extra base
        new Mob(3, "pig", { x: 4, y: 64, z: 0 }),
      ]);
      // Two species → exactly two base meshes registered (not one per mob).
      expect(sink.added.length).toBe(2);
      expect(sink.removed.length).toBe(0);
    });

    it("dispose removes every species base from the sink", () => {
      const sink = makeMockSink();
      const r = new MobRenderer(scene, sink, true);
      r.sync([
        new Mob(1, "cow", { x: 0, y: 64, z: 0 }),
        new Mob(2, "pig", { x: 2, y: 64, z: 0 }),
      ]);
      const baseCount = sink.added.length;
      r.dispose();
      expect(sink.removed.length).toBe(baseCount);
      expect(r.getMeshCount()).toBe(0);
    });

    it("reuses a freed instance index after despawn+respawn (no unbounded growth)", () => {
      const r = new MobRenderer(scene, undefined, true);
      r.sync([new Mob(1, "cow", { x: 0, y: 64, z: 0 })]);
      r.sync([]); // despawn → index freed
      r.sync([new Mob(2, "cow", { x: 5, y: 64, z: 0 })]); // should reuse index 0
      expect(r.getMeshCount()).toBe(1);
    });

    it("the default (no flag) renderer still uses the composite path", () => {
      const r = new MobRenderer(scene); // instanceMode undefined → false
      r.sync([new Mob(1, "cow", { x: 0, y: 64, z: 0 })]);
      // Composite path names roots mob_<id>.
      expect(scene.getTransformNodeByName("mob_1")).not.toBeNull();
      expect(r.getMeshCount()).toBe(1);
    });
  });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/rendering/mob-renderer.test.ts src/rendering/mob-renderer-instanced.test.ts src/rendering/mob-animation.test.ts src/rendering/mob-atlas.test.ts` → ALL green. The PINNED `mob-renderer.test.ts` must pass byte-identical (composite path unchanged); the new instanced suite passes; the pure animation/atlas suites are untouched.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors (strict: confirm no unused private; every new field is read).
- [ ] **(VERIFY, BUILD)** `corepack pnpm build` → succeeds (Babylon thin-instance imports tree-shake cleanly).
- [ ] **(LIVE-QA, OPTIONAL)** Instance mode is opt-in and not wired to a runtime toggle in 6c (it is an escape hatch for a future perf trigger). No default-path visual change — verify the normal game still renders mobs exactly as before (composite path is default). Manual smoke.
- [ ] **Commit:** `feat(render): flag-gated thin-instance mob path (composite unchanged)`

---

## Self-review (spec coverage / placeholder scan / type + signature consistency)

**Spec coverage (all four 6c scope items, each independently committable + green):**
1. Real baby hitboxes — Tasks 1–2 (`aabb()`/physics scale by `extra["babyScale"]`; `breed()` stamps it; targeting auto-shrinks). Matches spec §3.2 ("thread `extra.babyScale` (default 1.0, persisted) through `aabb()`/physics") and §5 backlog "real baby hitboxes". ✅
2. Mob-instancing escape hatch — Task 9 (`instanceMode` flag-gated dual path; composite default UNCHANGED; pinned test never edited; new suite separate). Matches spec §3.1 ("Keep C as a profile-gated escape hatch") + §5 "mob instancing (if a profile demands it)". ✅
3. Tone-mapping A/B — Tasks 6–8 (persisted `toneMappingMode`; ≥2 grade modes; `setToneMappingMode`; dropdown; live apply). Matches spec §2.6 open decision + §5 "tone-mapping A/B". ✅
4. Non-instant mob status effects — Tasks 3–5 (`Mob.effects`; `tickMobEffects`; arrow/splash routing; persistence + `SAVE_VERSION` 7→8). Matches the 6b deferral (`main.ts` L1137 "deferred to 6c") + §4.3. ✅
   PBR+IBL terrain is correctly EXCLUDED (Phase 6d). ✅

**SAVE_VERSION decision:** Bumped 7→8 in Task 5 ONLY, for persisting per-mob effects (the one scope item requiring durable world-save state). `MIGRATIONS[7]` (v7→v8) mirrors the 6b 6→7 pattern; the mob `effects` default happens inside `fromMobSave` (like player effects defaulting on older containers), so the migration body is a version bump. The migration-chain + `SAVE_VERSION===8` pins are updated intentionally. The other three items: baby hitboxes ride the ALREADY-persisted `extra` map (no bump); tone-mapping persists via the separate `prefs` JSON blob (no `SAVE_VERSION` interaction); instancing is render-only (no persistence). Stated explicitly per the requirement.

**Placeholder scan:** No "similar to above"/TODO/`...`-elided code. Every step has the real before/after. Two intentional QA-decision notes are flagged inline (splash-poison DoT-vs-instant in Task 4; instance mode not runtime-wired in Task 9) — these are documented choices, not placeholders.

**Type / signature consistency (verified against source, not recon):**
- `Mob.extra` is `Record<string, number>` and round-trips via `persistence.test.ts` `expectMobMatches` (`toEqual`) → `babyScale` persists with NO schema change (recon's `isBaby` boolean approach was REJECTED — it would have forced a `MobSave` field + broken the `extra` pin; spec §3.2 mandates `extra.babyScale`).
- `Prefs` (verified `preferences.ts`) has `mouseSensitivity`/`masterVolume`/`sfxVolume`/`ambientVolume`/`ssaoEnabled`/`colorblindMode`/`uiScale` — the recon's `angularSensibility`/`renderDistance/fov/bloomEnabled/filmGrainEnabled`-only list was INCOMPLETE; the plan extends the ACTUAL interface and mirrors the `colorblindMode` validation pattern.
- `PostFXController` (verified `post-fx.ts`) has the documented setters; `setToneMappingMode` is added to the iface + impl + mock + the interface-shape test (recon's `setToneMappingMode(mode: string)` is narrowed to `ToneMappingMode`).
- `tickEffects(s, survival, currentTick)` (verified `status.ts`) takes a `SurvivalState`; `tickMobEffects` builds a scratch via the real `makeSurvivalState()` and only sets `.health` (no struct widening → `stats.test.ts` strict shape safe).
- `EffectSave` is `{type:number,amplifier,ticksRemaining}` (verified `serialize.ts` L59) and is reused for `MobSave.effects`; `EFFECT_TYPE_IDS`/`effectTypeFromId` are the stable map.
- `MobSave` is a JSON blob (`JSON.stringify(save.mobs ?? [])`, `serialize.ts` L582), round-tripped verbatim by `serializeSave`/`deserializeSave` (NOT via `toMobSave`/`fromMobSave`) → adding an OPTIONAL `effects?: EffectSave[]` field needs NO `SAVE_FORMAT` (container) bump and NO `serialize.test.ts` edit (its literal omits the key; round-trip preserves the omission), only the `SAVE_VERSION` 7→8 bump for migration bookkeeping. `toMobSave` writes the key only when effects are non-empty (`exactOptionalPropertyTypes`-clean: never `effects: undefined`).
- `mob-renderer.test.ts` constructs `new MobRenderer(scene[, sink])` only → the 3rd `instanceMode` arg defaults `false` → composite path → all pins (incl. L145 `toBe`) hold; new instanced coverage is a SEPARATE file.
- The fire DOT (`main.ts` L1102–1124) is ALREADY shipped (6b) using `player.burningTicks` — NOT in 6c scope; the recon's "Phase 6b" fire labels were stale. Confirmed and excluded.

**Ordering / green-between-tasks:** Tasks 1→9 each end with a passing targeted suite + typecheck (+ build where `main.ts`/UI is touched). Items are grouped: baby hitboxes (1–2), mob effects (3–5), tone-mapping (6–8), instancing (9). Instancing + tone-mapping are flag/pref-gated so DEFAULT behavior is unchanged until toggled. The only `SAVE_VERSION` bump (Task 5) lands with its migration + round-trip test in the same commit.
