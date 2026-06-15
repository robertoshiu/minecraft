# Phase 3 — Mob Textures + Expressive Rig: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 7 mob species visually distinct and alive — per-part procedural textures, a continuous multi-channel procedural rig (gait / head look-at / idle bob / tail-ear), per-individual variety (visual-only baby + vertex-color tint), and hit-flash + death-grace feedback — without breaking the material-sharing / shadow-sink / synchronous-disposal contracts pinned by `src/rendering/mob-renderer.test.ts`.

**Architecture:** Extract the animation-channel math and the hit/death state machines into a PURE, Babylon-free module (`src/rendering/mob-animation.ts`) with deterministic unit tests, then thread a continuous wall-clock `nowMs` + `currentTick` into `MobRenderer.sync()` as OPTIONAL trailing args (the test path passes neither → behaviour is byte-identical to today, including immediate synchronous disposal). Textures come from a SEPARATE procedural mob atlas (pure `Uint8Array`, same pattern as `atlas.ts`) loaded as a `RawTexture` (NEAREST + CLAMP + no mips) and addressed per box-face via `CreateBox({ faceUV })`; material sharing is preserved by re-keying the cache from hex-color to a `${species}:${role}` key and using vertex colors (never per-instance materials) for variety and the hit-flash overlay.

**Tech Stack:** Babylon.js 8, TypeScript, Vite, Vitest

---

## File Structure

| Path | Status | Purpose |
|---|---|---|
| `src/rendering/mob-animation.ts` | **Create** | Pure (Babylon-free) animation-channel math + hit/death state machines. Unit-tested. |
| `src/rendering/mob-animation.test.ts` | **Create** | Deterministic unit tests for every pure function in `mob-animation.ts`. |
| `src/rendering/mob-atlas.ts` | **Create** | Pure `Uint8Array` mob-texture-atlas generator + UV-region table (no Babylon import). |
| `src/rendering/mob-atlas.test.ts` | **Create** | Unit tests: atlas dimensions, deterministic output, UV-region bounds in `[0,1]`. |
| `src/rendering/mob-renderer.ts` | **Modify** | Schema extension (`pivotRole`, gait params, faceUV), continuous `deltaTime`, multi-channel rig, textured material, variety, hit-flash, death-grace, perf. |
| `src/rendering/mob-renderer.test.ts` | **Protect (no edits required)** | The must-stay-green contract. New unit assertions MAY be appended but the existing assertions must not change. |
| `src/main.ts` | **Modify** | One line: pass `performance.now()` and `clock.totalTicks` into `mobRenderer.sync(...)`. |

---

## Conventions used in this plan

- `TICKS_PER_SECOND` is `20`, exported from `src/rules/mc-1.20.ts:77`. The pure module takes it as an explicit parameter (never imports Babylon or game state).
- `sync()`'s new signature is `sync(mobs: Mob[], nowMs?: number, currentTick?: number): void`. **When `nowMs === undefined` the renderer behaves EXACTLY as today** (reads tick-quantized `mob.age`, disposes despawns synchronously). This is the test path. The live path (main.ts) passes both args.
- "Pivot role" replaces the boolean `isLeg`. `isLeg?: true` stays supported during the transition but is normalized to `pivotRole: "leg"` internally.

---

## Task 1: Pure animation-channel module + state machines (UNIT)

Extract all per-frame rig math and the hit/death timing into a pure, deterministic module so it can be unit-tested with no `Scene`. This is the testability backbone of the phase.

**Files:**
- Create: `src/rendering/mob-animation.ts`
- Create (test): `src/rendering/mob-animation.test.ts`

Steps:

- [ ] **(UNIT)** Create `src/rendering/mob-animation.ts` with a `GaitParams` type and a pure `legSwing` function. This is the extraction of the current sin formula at `mob-renderer.ts:386` (`pivot.rotation.x = Math.sin(mob.age * 0.3 + phase) * 0.5`). New code:
  ```ts
  /** Per-species gait tuning. freq is rad per tick-equivalent; amp is max swing (rad). */
  export interface GaitParams {
    /** Angular frequency multiplier on the time input (was 0.3). */
    freq: number;
    /** Peak leg swing amplitude in radians (was 0.5). */
    amp: number;
  }

  /** Default gait matching the legacy hardcoded numbers. */
  export const DEFAULT_GAIT: GaitParams = { freq: 0.3, amp: 0.5 };

  /**
   * Leg rotation.x for one pivot. `t` is a CONTINUOUS tick-equivalent clock
   * (not the quantized integer mob.age). `phase` is 0 or PI per leg.
   */
  export function legSwing(t: number, phase: number, gait: GaitParams): number {
    return Math.sin(t * gait.freq + phase) * gait.amp;
  }
  ```
- [ ] **(UNIT)** Add the at-rest easing as a pure function (extraction of `mob-renderer.ts:391`, `pivot.rotation.x *= 0.8`):
  ```ts
  /** Ease a resting pivot angle toward 0. Multiplier 0.8 matches legacy. */
  export function easeToRest(current: number, factor = 0.8): number {
    return current * factor;
  }
  ```
- [ ] **(UNIT)** Add idle-bob and head-look pure channels (new behaviour; disjoint pivots so they compose additively):
  ```ts
  /** Vertical idle bob (body y offset, blocks). Small, slow, continuous. */
  export function idleBob(t: number, amp = 0.02, freq = 0.12): number {
    return Math.sin(t * freq) * amp;
  }

  /** Tail/ear sway angle (rad). Faster, low amplitude. */
  export function tailSway(t: number, amp = 0.25, freq = 0.5): number {
    return Math.sin(t * freq) * amp;
  }

  /**
   * Head pitch toward a target relative height. `dyEyes` is (targetY - headY).
   * Clamped so the head never over-rotates. Returns rotation.x (rad).
   */
  export function headPitch(dyEyes: number, clamp = 0.6): number {
    const p = Math.atan2(dyEyes, 1);
    return Math.max(-clamp, Math.min(clamp, p));
  }
  ```
- [ ] **(UNIT)** Add the hit-flash predicate (drives the overlay in Task 7). `lastDamageTick` defaults to `NEVER_DAMAGED_TICK` (`entity.ts:35,86`) so the subtraction is always huge for never-damaged mobs:
  ```ts
  /**
   * True iff the mob took damage within `graceTicks` of `currentTick`.
   * Pure predicate — no Babylon, no Mob import (pass the two integers).
   */
  export function recentlyDamaged(
    lastDamageTick: number,
    currentTick: number,
    graceTicks = 4,
  ): boolean {
    const dt = currentTick - lastDamageTick;
    return dt >= 0 && dt < graceTicks;
  }
  ```
- [ ] **(UNIT)** Add the death-grace state machine as a tiny pure helper (used in Task 8). It returns a 0→1 progress and an `expired` flag from elapsed ms:
  ```ts
  /** Total ms a dying mob lingers before disposal. */
  export const DEATH_GRACE_MS = 450;

  export interface DeathGraceState {
    /** 0..1 tween progress. */
    progress: number;
    /** True once the tween has fully elapsed (caller should dispose). */
    expired: boolean;
  }

  /** Pure: compute death-grace progress from elapsed ms. */
  export function deathGrace(elapsedMs: number, totalMs = DEATH_GRACE_MS): DeathGraceState {
    const progress = Math.min(1, Math.max(0, elapsedMs / totalMs));
    return { progress, expired: elapsedMs >= totalMs };
  }

  /** Visual scale for a dying mob (shrinks to 0 over the tween). */
  export function deathScale(progress: number): number {
    return 1 - progress;
  }
  ```
- [ ] **(UNIT)** Add the per-individual vertex-color tint as a pure deterministic hash (no `Math.random`; same mob id → same tint forever). Returns an RGB multiplier near white so `texture × tint` stays subtle:
  ```ts
  /** Deterministic per-individual tint multiplier (RGB each ~0.85..1.0). */
  export function tintFor(mobId: number): [number, number, number] {
    // Cheap integer hash → 3 channels.
    let h = (mobId * 2654435761) >>> 0;
    const chan = () => {
      h = (h ^ (h >>> 15)) >>> 0;
      h = (h * 2246822519) >>> 0;
      return 0.85 + ((h & 0xff) / 255) * 0.15; // 0.85..1.0
    };
    return [chan(), chan(), chan()];
  }
  ```
- [ ] **(UNIT)** Create `src/rendering/mob-animation.test.ts`. Cover: `legSwing(0, 0, DEFAULT_GAIT) === 0`; `legSwing` at `t = Math.PI/2/0.3` ≈ amp; phase `PI` is the negation of phase `0`; `easeToRest(1) === 0.8`; `recentlyDamaged(10, 12, 4) === true`, `recentlyDamaged(10, 20, 4) === false`, `recentlyDamaged(NEVER_DAMAGED_TICK, 0, 4) === false`; `deathGrace(0).progress === 0`, `deathGrace(450).expired === true`, `deathScale(1) === 0`; `tintFor(7)` deterministic across calls and each channel in `[0.85, 1.0]`; `headPitch` clamps. Example:
  ```ts
  import { describe, it, expect } from "vitest";
  import {
    legSwing, easeToRest, recentlyDamaged, deathGrace, deathScale, tintFor,
    DEFAULT_GAIT,
  } from "./mob-animation";

  describe("legSwing", () => {
    it("is 0 at t=0, phase=0", () => {
      expect(legSwing(0, 0, DEFAULT_GAIT)).toBeCloseTo(0);
    });
    it("phase PI negates phase 0", () => {
      expect(legSwing(1.7, Math.PI, DEFAULT_GAIT))
        .toBeCloseTo(-legSwing(1.7, 0, DEFAULT_GAIT));
    });
  });

  describe("recentlyDamaged", () => {
    it("true inside grace window", () => expect(recentlyDamaged(10, 12, 4)).toBe(true));
    it("false outside window", () => expect(recentlyDamaged(10, 20, 4)).toBe(false));
  });
  ```
- [ ] **(UNIT)** Verify: `corepack pnpm vitest run src/rendering/mob-animation.test.ts`. Expected: all tests pass (new file, isolated).
- [ ] **(UNIT)** Verify: `corepack pnpm typecheck`. Expected: no type errors.
- [ ] Commit: `feat(mobs): pure mob-animation channel module + state machines (Phase 3)`

---

## Task 2: Thread continuous deltaTime/currentTick into sync (fix tick-quantized age) (UNIT)

Make `sync()` accept the continuous wall-clock and tick — both OPTIONAL — so animation stops stepping at 20 Hz while the test path (no args) keeps today's exact behaviour and synchronous disposal.

**Files:**
- Modify: `src/rendering/mob-renderer.ts` (signature `360`; leg-anim block `380-393`; record type `241-247`)
- Modify: `src/main.ts` (sync call `966`)
- Protect: `src/rendering/mob-renderer.test.ts` (no edits — must stay green)

Steps:

- [ ] **(UNIT)** Add a per-record continuous visual clock to `MobRecord`. Before (`mob-renderer.ts:241-247`):
  ```ts
  interface MobRecord {
    root: TransformNode;
    /** All part meshes, in order, for shadow sink management. */
    partMeshes: Mesh[];
    /** Leg pivot nodes, in part order; length equals the number of leg parts. */
    legPivots: TransformNode[];
  }
  ```
  After:
  ```ts
  interface MobRecord {
    root: TransformNode;
    /** All part meshes, in order, for shadow sink management. */
    partMeshes: Mesh[];
    /** Leg pivot nodes, in part order; length equals the number of leg parts. */
    legPivots: TransformNode[];
    /** Continuous tick-equivalent clock (advanced by real deltaTime). */
    visualClock: number;
  }
  ```
- [ ] **(UNIT)** Initialize `visualClock: 0` where the record is constructed (`mob-renderer.ts:372`):
  Before: `record = { root, partMeshes, legPivots };`
  After: `record = { root, partMeshes, legPivots, visualClock: 0 };`
- [ ] **(UNIT)** Change the `sync` signature (`mob-renderer.ts:360`). Add a `lastNowMs` field to track frame delta. Before:
  ```ts
  sync(mobs: Mob[]): void {
    const seen = new Set<number>();
  ```
  After:
  ```ts
  sync(mobs: Mob[], nowMs?: number, currentTick?: number): void {
    const seen = new Set<number>();
    // Continuous frame delta in tick-equivalent units. When nowMs is undefined
    // (the test path) dt is 0 → animation falls back to tick-quantized mob.age,
    // preserving the exact legacy behaviour the renderer test pins.
    let dtTicks = 0;
    if (nowMs !== undefined) {
      const prev = this.lastNowMs ?? nowMs;
      dtTicks = ((nowMs - prev) / 1000) * TICKS_PER_SECOND;
      this.lastNowMs = nowMs;
    }
  ```
- [ ] **(UNIT)** Add the `lastNowMs` field + `TICKS_PER_SECOND` import. Add near the materials map declaration (`mob-renderer.ts:262`):
  ```ts
  /** Last wall-clock ms seen by sync(); undefined until the first live frame. */
  private lastNowMs: number | undefined = undefined;
  ```
  And add the import after line 28:
  ```ts
  import { TICKS_PER_SECOND } from "../rules/mc-1.20";
  ```
- [ ] **(UNIT)** Advance each record's `visualClock` and pick the animation time. Replace the leg-animation block. Before (`mob-renderer.ts:380-393`):
  ```ts
      // Animate legs.
      const speed = Math.hypot(mob.velocity.x, mob.velocity.z);
      if (speed > 0.02) {
        record.legPivots.forEach((pivot, idx) => {
          // Alternate phase: even-indexed legs swing forward, odd swing backward.
          const phase = idx % 2 === 0 ? 0 : Math.PI;
          pivot.rotation.x = Math.sin(mob.age * 0.3 + phase) * 0.5;
        });
      } else {
        // Ease legs back to rest position.
        for (const pivot of record.legPivots) {
          pivot.rotation.x *= 0.8;
        }
      }
  ```
  After:
  ```ts
      // Continuous animation clock: advance by real delta when available,
      // else fall back to the tick-quantized mob.age (test path).
      record.visualClock += dtTicks;
      const t = nowMs !== undefined ? record.visualClock : mob.age;

      // Animate legs (channel math lives in the pure mob-animation module).
      const speed = Math.hypot(mob.velocity.x, mob.velocity.z);
      if (speed > 0.02) {
        record.legPivots.forEach((pivot, idx) => {
          const phase = idx % 2 === 0 ? 0 : Math.PI;
          pivot.rotation.x = legSwing(t, phase, DEFAULT_GAIT);
        });
      } else {
        for (const pivot of record.legPivots) {
          pivot.rotation.x = easeToRest(pivot.rotation.x);
        }
      }
  ```
- [ ] **(UNIT)** Add the import of the pure helpers after the `TICKS_PER_SECOND` import:
  ```ts
  import { legSwing, easeToRest, DEFAULT_GAIT } from "./mob-animation";
  ```
- [ ] **(LIVE-QA wiring, UNIT-safe)** Update the live call site. Before (`main.ts:966`):
  ```ts
  mobRenderer.sync(mobDriver.manager.all());
  ```
  After:
  ```ts
  mobRenderer.sync(mobDriver.manager.all(), performance.now(), clock.totalTicks);
  ```
  Note: `clock.totalTicks` is used (NOT the `currentTick` local at `main.ts:900`, which is scoped inside the fixed-tick `while` loop and not visible at line 966).
- [ ] **(UNIT)** Verify the must-protect test is still green: `corepack pnpm vitest run src/rendering/mob-renderer.test.ts`. Expected: all existing tests pass — the test calls `sync(mobs)` / `sync([])` with no `nowMs`, so `dtTicks === 0`, `t === mob.age`, and despawn disposal stays synchronous.
- [ ] **(UNIT)** Verify: `corepack pnpm typecheck`. Expected: clean.
- [ ] Commit: `feat(mobs): continuous deltaTime into sync, fixing tick-quantized gait (Phase 3)`

---

## Task 3: Extend PartDef/ModelDef schema (pivotRole + gait params + faceUV) (UNIT)

Generalize the model schema so new channels and per-face textures are declarative data, not hardcoded special cases.

**Files:**
- Modify: `src/rendering/mob-renderer.ts` (`PartDef` `51-68`, `ModelDef` `71-73`, `MODELS` `100-234`, `buildModel` `299-349`)

Steps:

- [ ] **(UNIT)** Add a `PivotRole` type + extend `PartDef`. Before (`mob-renderer.ts:50-68`):
  ```ts
  /** One part of a mob model: a box with size, local offset, optional color, optional leg flag. */
  interface PartDef {
    w: number;
    h: number;
    d: number;
    x: number;
    y: number;
    z: number;
    /** Hex color override; if omitted uses the mob's base color. */
    color?: string;
    /** ... */
    isLeg?: true;
  }
  ```
  After:
  ```ts
  /** Pivot role: which animation channel drives this part. */
  type PivotRole = "leg" | "head" | "tail" | "ear";

  /** Logical role used to look up the atlas UV region for a part. */
  type PartRole =
    | "body" | "head" | "leg" | "snout" | "horn" | "beak" | "arm" | "tail" | "ear";

  /** One part of a mob model: a box with size, local offset, optional color/role/pivot. */
  interface PartDef {
    w: number;
    h: number;
    d: number;
    x: number;
    y: number;
    z: number;
    /** Hex color override; if omitted uses the mob's base color. */
    color?: string;
    /** DEPRECATED alias for pivotRole:"leg"; still honoured. */
    isLeg?: true;
    /** Which animation channel (if any) owns this part's pivot. */
    pivotRole?: PivotRole;
    /** Logical role → selects the atlas UV region (Task 5). Defaults to "body". */
    role?: PartRole;
  }
  ```
- [ ] **(UNIT)** Extend `ModelDef` with per-species gait params. Before (`mob-renderer.ts:71-73`):
  ```ts
  interface ModelDef {
    parts: PartDef[];
  }
  ```
  After:
  ```ts
  interface ModelDef {
    parts: PartDef[];
    /** Per-species gait tuning; defaults to DEFAULT_GAIT when omitted. */
    gait?: GaitParams;
  }
  ```
- [ ] **(UNIT)** Import `GaitParams` (extend the Task 2 import):
  ```ts
  import { legSwing, easeToRest, DEFAULT_GAIT, type GaitParams } from "./mob-animation";
  ```
- [ ] **(UNIT)** Normalize `isLeg` → `pivotRole` inside `buildModel`. Before (`mob-renderer.ts:305-309`):
  ```ts
    modelDef.parts.forEach((part, i) => {
      const color = part.color ?? baseColor;
      const mat = this.materialFor(color);

      if (part.isLeg) {
  ```
  After:
  ```ts
    modelDef.parts.forEach((part, i) => {
      const color = part.color ?? baseColor;
      const mat = this.materialFor(color);

      const role: PivotRole | undefined =
        part.pivotRole ?? (part.isLeg ? "leg" : undefined);

      if (role === "leg") {
  ```
  (The `quadLegs` helper at `84-97` already emits `isLeg: true`, so it keeps working unchanged.)
- [ ] **(UNIT)** Annotate gait on the heavier quadrupeds in `MODELS` (declarative, not behavioural-yet). Example — add `gait` to `cow` (`mob-renderer.ts:107-121`) keeping `parts` intact:
  ```ts
  cow: {
    gait: { freq: 0.28, amp: 0.45 },
    parts: [
      // ... unchanged parts ...
    ],
  },
  ```
  Leave species without an explicit `gait` to fall back to `DEFAULT_GAIT`.
- [ ] **(UNIT)** Verify: `corepack pnpm vitest run src/rendering/mob-renderer.test.ts`. Expected: green (schema additions are optional fields; `getChildMeshes` count is computed live by the test, so any new parts are absorbed automatically).
- [ ] **(UNIT)** Verify: `corepack pnpm typecheck`. Expected: clean.
- [ ] Commit: `feat(mobs): extend PartDef/ModelDef schema with pivotRole + gait + role (Phase 3)`

---

## Task 4: Wire multi-channel animation onto pivots (UNIT-structural + LIVE-QA feel)

Replace the single leg-swing with additively-composed channels (gait + head look + idle bob + tail/ear) on disjoint pivots, with zero per-frame allocation.

**Files:**
- Modify: `src/rendering/mob-renderer.ts` (`MobRecord` `241-247`; `buildModel` `299-349`; sync animation block from Task 2)

Steps:

- [ ] **(UNIT)** Extend `MobRecord` with the new pivot arrays (mirrors the `legPivots` pattern). Add after `legPivots` and `visualClock`:
  ```ts
    /** Head pivot (look-at + bob), or null if the species has no head pivot. */
    headPivot: TransformNode | null;
    /** Tail/ear pivots driven by the sway channel. */
    swayPivots: TransformNode[];
  ```
- [ ] **(UNIT)** In `buildModel`, branch on `role` to create head/tail/ear pivots the same way legs are created (pivot TransformNode at `(x,y,z)`, box child offset appropriately). Return them alongside `partMeshes`/`legPivots`. Keep the existing leg branch unchanged; add sibling branches for `"head"`, `"tail"`, `"ear"`. Update the return type:
  ```ts
  private buildModel(mob: Mob, root: TransformNode): {
    partMeshes: Mesh[];
    legPivots: TransformNode[];
    headPivot: TransformNode | null;
    swayPivots: TransformNode[];
  } {
  ```
- [ ] **(UNIT)** Store the new pivots when constructing the record (`mob-renderer.ts:371-373`):
  ```ts
        const { partMeshes, legPivots, headPivot, swayPivots } = this.buildModel(mob, root);
        record = { root, partMeshes, legPivots, headPivot, swayPivots, visualClock: 0 };
  ```
- [ ] **(UNIT)** Compose the channels in the sync animation block (extends Task 2's block). Use `idleBob`, `tailSway`, `headPitch` from the pure module. CRITICAL: each channel writes a DISJOINT pivot (legs vs head vs sway), so there is no Euler overwrite. Idle bob is applied to `record.root` y as an offset added to `mob.feet.y` (so it doesn't fight the despawn position-set). Allocation-free: write `.rotation.x` / `.position.y` in place, no `new`:
  ```ts
      // Head look + idle: head pitch tracks a fixed look-down bias; bob nudges root y.
      if (record.headPivot !== null) {
        record.headPivot.rotation.x = headPitch(0.1) * 0.5; // gentle ambient look
      }
      for (const pivot of record.swayPivots) {
        pivot.rotation.z = tailSway(t);
      }
      // Idle bob is added on top of the feet position already set above.
      record.root.position.y = mob.feet.y + idleBob(t);
  ```
- [ ] **(UNIT)** Import the additional channels (extend the Task 2 import):
  ```ts
  import {
    legSwing, easeToRest, idleBob, tailSway, headPitch,
    DEFAULT_GAIT, type GaitParams,
  } from "./mob-animation";
  ```
- [ ] **(UNIT)** Use the per-species gait in the leg loop (replaces the literal `DEFAULT_GAIT`):
  ```ts
        const gait = MODELS[mob.type].gait ?? DEFAULT_GAIT;
        record.legPivots.forEach((pivot, idx) => {
          const phase = idx % 2 === 0 ? 0 : Math.PI;
          pivot.rotation.x = legSwing(t, phase, gait);
        });
  ```
- [ ] **(UNIT)** Add at least one `pivotRole: "tail"` or `"ear"` part to a species in `MODELS` so the sway channel has something to drive (e.g. a small cow tail box at the rear). This is declarative data; the renderer test absorbs the extra mesh automatically.
- [ ] **(UNIT)** Verify: `corepack pnpm vitest run src/rendering/mob-renderer.test.ts`. Expected: green — new pivots are children of root (counted by `getChildMeshes(false)`), shadow-sink parity still holds because new boxes go through the same `addShadowCaster` path.
- [ ] **(UNIT)** Verify: `corepack pnpm typecheck`. Expected: clean.
- [ ] **(LIVE-QA)** Run the app (`corepack pnpm dev`) and watch a cow/pig/zombie: legs alternate smoothly (no 20 Hz stepping), body bobs subtly when idle, tail/ear sways. Flag if motion is jittery or a channel overwrites another.
- [ ] Commit: `feat(mobs): multi-channel additive rig (gait/head/idle-bob/tail-ear) (Phase 3)`

---

## Task 5: Procedural mob atlas + per-part faceUV textures (UNIT atlas + LIVE-QA look)

Give parts real pixel-art faces from a SEPARATE procedural atlas, addressed per box-face, while preserving same-type material sharing by re-keying the cache.

**Files:**
- Create: `src/rendering/mob-atlas.ts`
- Create (test): `src/rendering/mob-atlas.test.ts`
- Modify: `src/rendering/mob-renderer.ts` (`materials` map `262`, `materialFor` `282-291`, CreateBox calls `317-327` & `333-345`, imports `20-25`)

Steps:

- [ ] **(UNIT)** Create `src/rendering/mob-atlas.ts` following the pure pattern of `atlas.ts:195-294` (no Babylon import). Export an atlas size, a generator, and a UV-region table:
  ```ts
  /** Mob atlas is a small RGBA grid; NEAREST + CLAMP, no mips (pixel art). */
  export const MOB_ATLAS_PX = 256;
  export const MOB_TILE_PX = 32;
  export const MOB_GRID = MOB_ATLAS_PX / MOB_TILE_PX; // 8

  /** Pure RGBA generator — deterministic, no Math.random, no Babylon. */
  export function generateMobAtlasRGBA(): Uint8Array {
    const out = new Uint8Array(MOB_ATLAS_PX * MOB_ATLAS_PX * 4);
    // ... fill per (species,role) tile with a base color + deterministic detail,
    // plus a 2px edge dilation gutter (same idea as atlas.ts dilation) ...
    return out;
  }

  /** A UV sub-rect in [0,1], inset by half a texel to prevent edge bleed. */
  export interface UVRect { u0: number; v0: number; u1: number; v1: number; }

  /** UV region for a (species, role) pair, with half-texel inset already applied. */
  export function uvRegion(species: string, role: string): UVRect { /* ... */ }
  ```
- [ ] **(UNIT)** Create `src/rendering/mob-atlas.test.ts`. Assert: `generateMobAtlasRGBA().length === MOB_ATLAS_PX*MOB_ATLAS_PX*4`; alpha bytes are all `255`; output is byte-identical across two calls (deterministic); every `uvRegion(...)` returns coords within `[0,1]` and `u0<u1`, `v0<v1`; the half-texel inset is strictly inside the raw cell. No `Scene` needed.
- [ ] **(UNIT)** Add a faceUV builder to `mob-atlas.ts` that maps a single `UVRect` onto all 6 box faces. DOCUMENT the Babylon CreateBox face order in a comment (`0=+Z back, 1=-Z front, 2=+X right, 3=-X left, 4=+Y top, 5=-Y bottom`) so anatomical faces (e.g. a head's "face") land on the right index:
  ```ts
  // NOTE: returns plain {x,y,z,w} tuples; mob-renderer converts to Vector4
  // to keep this module Babylon-free.
  export function faceUVForRect(r: UVRect): { x: number; y: number; z: number; w: number }[] {
    const f = { x: r.u0, y: r.v0, z: r.u1, w: r.v1 };
    return [f, f, f, f, f, f]; // 6 faces; refine per-face later if QA wants distinct faces
  }
  ```
- [ ] **(UNIT)** Re-key the material cache from hex-color to `${species}:${role}` so two species sharing a hex string but needing different textures get distinct materials, while two mobs of the SAME species+role still share one material (preserves the `toBe` reference-equality test at `mob-renderer.test.ts:145`). Before (`mob-renderer.ts:262` + `282-291`):
  ```ts
  private readonly materials = new Map<string, StandardMaterial>();
  // ...
  private materialFor(hexColor: string): StandardMaterial {
    const existing = this.materials.get(hexColor);
    if (existing !== undefined) return existing;

    const mat = new StandardMaterial(`mob-mat-${hexColor}`, this.scene);
    mat.diffuseColor = Color3.FromHexString(hexColor);
    mat.specularColor = new Color3(0, 0, 0);
    this.materials.set(hexColor, mat);
    return mat;
  }
  ```
  After:
  ```ts
  private readonly materials = new Map<string, StandardMaterial>();
  /** Shared mob-atlas texture, created lazily once. */
  private mobAtlasTex: RawTexture | null = null;
  // ...
  /** Cache key: `${species}:${role}`. Same key → SAME shared material instance. */
  private materialFor(key: string, hexColor: string): StandardMaterial {
    const existing = this.materials.get(key);
    if (existing !== undefined) return existing;

    if (this.mobAtlasTex === null) {
      this.mobAtlasTex = new RawTexture(
        generateMobAtlasRGBA(), MOB_ATLAS_PX, MOB_ATLAS_PX,
        5 /* TEXTUREFORMAT_RGBA */, this.scene,
        /* generateMipMaps */ false, /* invertY */ false,
        Texture.NEAREST_SAMPLINGMODE,
      );
      this.mobAtlasTex.wrapU = Texture.CLAMP_ADDRESSMODE;
      this.mobAtlasTex.wrapV = Texture.CLAMP_ADDRESSMODE;
      this.mobAtlasTex.name = "mob-atlas";
    }

    const mat = new StandardMaterial(`mob-mat-${key}`, this.scene);
    mat.diffuseColor = new Color3(1, 1, 1);   // white so texture isn't tinted
    mat.ambientColor = new Color3(1, 1, 1);   // match terrain ambient floor
    mat.specularColor = new Color3(0, 0, 0);
    mat.diffuseTexture = this.mobAtlasTex;
    void hexColor; // hex retained only for fallback / vertex-color base (Task 6)
    this.materials.set(key, mat);
    return mat;
  }
  ```
- [ ] **(UNIT)** Add the imports (`mob-renderer.ts:20-25`):
  ```ts
  import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
  import { Texture } from "@babylonjs/core/Materials/Textures/texture";
  import { Vector4 } from "@babylonjs/core/Maths/math.vector";
  import {
    generateMobAtlasRGBA, uvRegion, faceUVForRect,
    MOB_ATLAS_PX,
  } from "./mob-atlas";
  ```
- [ ] **(UNIT)** Update both `materialFor` call sites + both `CreateBox` calls. In `buildModel` (`mob-renderer.ts:306-307`) build the key + faceUV:
  ```ts
      const partRole = part.role ?? "body";
      const matKey = `${mob.type}:${partRole}`;
      const mat = this.materialFor(matKey, part.color ?? baseColor);
      const faceUV = faceUVForRect(uvRegion(mob.type, partRole))
        .map((f) => new Vector4(f.x, f.y, f.z, f.w));
  ```
  Then pass `faceUV` into BOTH `CreateBox` option objects. Before (leg, `317-321`):
  ```ts
        const box = CreateBox(
          `mob_${mob.id}_part_${i}`,
          { width: part.w, height: part.h, depth: part.d },
          this.scene,
        );
  ```
  After:
  ```ts
        const box = CreateBox(
          `mob_${mob.id}_part_${i}`,
          { width: part.w, height: part.h, depth: part.d, faceUV },
          this.scene,
        );
  ```
  Apply the identical `faceUV` addition to the non-leg `CreateBox` at `333-337`. **Do NOT set `wrap: true`** — it conflicts with `faceUV`.
- [ ] **(UNIT)** Dispose the shared atlas texture in `dispose()` (`mob-renderer.ts:427-438`). Add after the material loop:
  ```ts
    this.mobAtlasTex?.dispose();
    this.mobAtlasTex = null;
  ```
- [ ] **(UNIT)** Verify atlas unit tests: `corepack pnpm vitest run src/rendering/mob-atlas.test.ts`. Expected: green.
- [ ] **(UNIT)** Verify the must-protect renderer test: `corepack pnpm vitest run src/rendering/mob-renderer.test.ts`. Expected: green — two zombies still resolve `${"zombie"}:body` to the SAME material instance, so `expect(mat1).toBe(mat2)` (`:145`) holds.
- [ ] **(UNIT)** Verify: `corepack pnpm typecheck`. Expected: clean.
- [ ] **(LIVE-QA)** Run the app; confirm mobs show pixel-art faces (e.g. cow head face, pig snout) with crisp NEAREST sampling and no edge bleed at part seams. Flag any UV face mis-mapping (most likely the head "face" landing on the wrong box index).
- [ ] Commit: `feat(mobs): procedural mob atlas + per-part faceUV textures, material sharing preserved (Phase 3)`

---

## Task 6: Variety — visual-only baby scale + per-individual vertex-color tint (UNIT)

Add per-individual visual distinction without per-instance materials and without touching the hitbox.

**Files:**
- Modify: `src/rendering/mob-renderer.ts` (sync transform block `376-378`; buildModel mesh creation)
- Reference (read-only): `src/mobs/entity.ts` (`extra` `73`, `aabb()` `95-106`); `src/mobs/persistence.ts` (`extra` round-trip `93`,`119`)

Steps:

- [ ] **(UNIT)** Apply visual-only baby scale from `mob.extra["babyScale"]` to the render root. Before (`mob-renderer.ts:376-378`):
  ```ts
      // Update root transform: position at feet, rotate by yaw.
      record.root.position.set(mob.feet.x, mob.feet.y, mob.feet.z);
      record.root.rotation.y = mob.yaw;
  ```
  After:
  ```ts
      // Update root transform: position at feet, rotate by yaw.
      record.root.position.set(mob.feet.x, mob.feet.y, mob.feet.z);
      record.root.rotation.y = mob.yaw;
      // Visual-only baby scale: shrinks the render root ONLY. aabb() reads
      // MOB_STATS directly (entity.ts:95-106) so the hitbox stays adult-sized.
      const babyScale = mob.extra["babyScale"] ?? 1.0;
      record.root.scaling.setAll(babyScale);
  ```
  Note: idle-bob (Task 4) writes `record.root.position.y`; baby scale writes `record.root.scaling` — disjoint, no conflict. (No persistence change needed; `extra` already round-trips per `persistence.ts:93,119`.)
- [ ] **(UNIT)** Apply per-individual vertex-color tint at mesh-build time using the pure `tintFor(mob.id)` from Task 1. Vertex colors multiply the texture (`texture × white = unchanged`), so same-type material sharing is untouched. In `buildModel`, after each `box` is created and before/after `box.material = mat;`, add a helper call:
  ```ts
      this.applyTint(box, mob.id);
  ```
  And add the private method (allocation-aware: builds the color buffer once per box at creation, not per frame):
  ```ts
  /** Paint a deterministic per-individual RGBA vertex-color buffer on a box. */
  private applyTint(box: Mesh, mobId: number): void {
    const [r, g, b] = tintFor(mobId);
    const positions = box.getVerticesData("position"); // 24 verts for a box
    if (positions === null) return;
    const vertexCount = positions.length / 3;
    const colors = new Float32Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i++) {
      colors[i * 4 + 0] = r;
      colors[i * 4 + 1] = g;
      colors[i * 4 + 2] = b;
      colors[i * 4 + 3] = 1;
    }
    box.setVerticesData(VertexBuffer.ColorKind, colors);
    box.useVertexColors = true;
  }
  ```
- [ ] **(UNIT)** Add imports for `tintFor` (extend the Task 4 import) and `VertexBuffer`:
  ```ts
  import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
  // ... and add tintFor to the mob-animation import list
  ```
- [ ] **(UNIT)** Verify: `corepack pnpm vitest run src/rendering/mob-renderer.test.ts`. Expected: green — material instances are still shared (vertex colors live on the MESH, not the material); `expect(mat1).toBe(mat2)` (`:145`) unaffected. Baby scale defaults to 1.0 for every test mob.
- [ ] **(UNIT)** Verify: `corepack pnpm typecheck`. Expected: clean.
- [ ] **(LIVE-QA)** Run the app; confirm individuals of the same species have subtly different shades; a baby (set `extra.babyScale` via a temporary spawn hook or save edit) renders smaller while still being hittable at full size. Flag if tint is too strong (should be subtle).
- [ ] Commit: `feat(mobs): visual-only baby scale + per-individual vertex-color tint (Phase 3)`

---

## Task 7: Hit-flash on lastDamageTick without breaking material sharing (UNIT-state + LIVE-QA)

Flash a mob red briefly when recently damaged, without per-instance materials and without mutating the shared cached material.

**Files:**
- Modify: `src/rendering/mob-renderer.ts` (sync animation block; uses `currentTick` arg from Task 2)
- Reference (read-only): `src/mobs/entity.ts` (`lastDamageTick` `63,122-126`, `NEVER_DAMAGED_TICK` `35`)

Steps:

- [ ] **(UNIT)** Create ONE shared flash material lazily (a single emissive-red overlay material reused by every flashing mob — NOT per instance, NOT stored in the per-color `materials` map). Add a field + getter:
  ```ts
  /** Single shared red-flash material, created on first flash. */
  private flashMat: StandardMaterial | null = null;

  private flashMaterial(): StandardMaterial {
    if (this.flashMat === null) {
      const m = new StandardMaterial("mob-flash", this.scene);
      m.diffuseColor = new Color3(1, 0, 0);
      m.emissiveColor = new Color3(0.6, 0, 0);
      m.specularColor = new Color3(0, 0, 0);
      this.flashMat = m;
    }
    return this.flashMat;
  }
  ```
- [ ] **(UNIT)** Track each mesh's normal material on `MobRecord` so the swap can be reverted (capture once at build time). Add to `MobRecord`:
  ```ts
    /** Each part mesh's normal (non-flash) material, parallel to partMeshes. */
    baseMaterials: StandardMaterial[];
  ```
  Populate it in `buildModel` (push `mat` alongside each `partMeshes.push(box)`).
- [ ] **(UNIT)** In the sync animation block, swap to flash material while `recentlyDamaged`, revert otherwise. Uses the `currentTick` arg (undefined on the test path → no flash, no swap):
  ```ts
      // Hit flash: temporary swap to the SHARED flash material (reverts to base).
      const flashing =
        currentTick !== undefined &&
        recentlyDamaged(mob.lastDamageTick, currentTick);
      if (flashing) {
        const fm = this.flashMaterial();
        for (const mesh of record.partMeshes) mesh.material = fm;
      } else {
        record.partMeshes.forEach((mesh, idx) => {
          mesh.material = record.baseMaterials[idx]!;
        });
      }
  ```
  This never mutates a shared cached material (so it can't tint other mobs of the same color) and creates no per-instance material.
- [ ] **(UNIT)** Import `recentlyDamaged` (extend the mob-animation import list).
- [ ] **(UNIT)** Dispose the flash material in `dispose()`:
  ```ts
    this.flashMat?.dispose();
    this.flashMat = null;
  ```
- [ ] **(UNIT)** Verify the must-protect test: `corepack pnpm vitest run src/rendering/mob-renderer.test.ts`. Expected: green — the test never passes `currentTick`, so `flashing` is always false, the base material is reassigned to itself, and `expect(mat1).toBe(mat2)` (`:145`) still holds (the body part's material is the shared instance both before and after the no-op revert).
- [ ] **(UNIT)** Optionally append a NEW unit test to `mob-renderer.test.ts` (does not alter existing assertions): after `sync([mob])` with no `currentTick`, the body mesh `.material` equals the shared cached material (proves no flash on the test path).
- [ ] **(UNIT)** Verify: `corepack pnpm typecheck`. Expected: clean.
- [ ] **(LIVE-QA)** Run the app; hit a mob and confirm a brief red flash (~0.2 s) that clears, with no lingering tint on un-hit mobs of the same species. Flag if the flash bleeds onto neighbours (would indicate accidental shared-material mutation).
- [ ] Commit: `feat(mobs): hit-flash via shared flash-material swap (sharing-safe) (Phase 3)`

---

## Task 8: Death-grace tween (synchronous-disposal-safe) (UNIT-state + LIVE-QA)

Add a renderer-only "dying" tween that shrinks/fades a despawned mob over ~0.45 s — but ONLY when a live time delta is supplied. The no-time-arg test path disposes immediately, exactly as today.

**Files:**
- Modify: `src/rendering/mob-renderer.ts` (despawn loop `397-409`; new `dyingRecords` map; uses `nowMs` from Task 2)

Steps:

- [ ] **(UNIT)** Add a `dyingRecords` map next to `records` (`mob-renderer.ts:260`):
  ```ts
  /** Records mid death-grace tween, keyed by mob id; disposed when the tween ends. */
  private readonly dyingRecords = new Map<number, { record: MobRecord; startMs: number }>();
  ```
- [ ] **(UNIT)** Gate the despawn path on `nowMs`. Before (`mob-renderer.ts:396-409`):
  ```ts
      // Despawn: remove mobs that are no longer present.
      for (const [id, record] of this.records) {
        if (seen.has(id)) continue;

        // Remove every part mesh from the shadow sink BEFORE disposing.
        for (const mesh of record.partMeshes) {
          this.shadowSink?.removeShadowCaster(mesh);
        }

        // Dispose root with all children (disposeChildren=true, doNotRecurse=false).
        record.root.dispose(false, true);

        this.records.delete(id);
      }
  ```
  After:
  ```ts
      // Despawn: remove mobs that are no longer present.
      for (const [id, record] of this.records) {
        if (seen.has(id)) continue;

        if (nowMs === undefined) {
          // TEST PATH (no time delta): dispose IMMEDIATELY, exactly as before.
          this.disposeRecord(record);
        } else {
          // LIVE PATH: start a death-grace tween; dispose when it expires.
          this.dyingRecords.set(id, { record, startMs: nowMs });
        }
        this.records.delete(id);
      }

      // Advance any in-flight death-grace tweens.
      if (nowMs !== undefined) {
        for (const [id, dying] of this.dyingRecords) {
          const { progress, expired } = deathGrace(nowMs - dying.startMs);
          if (expired) {
            this.disposeRecord(dying.record);
            this.dyingRecords.delete(id);
          } else {
            dying.record.root.scaling.setAll(deathScale(progress));
          }
        }
      }
  ```
- [ ] **(UNIT)** Extract the shadow-sink-removal + dispose into a private `disposeRecord` so both the test path and the tween path (and `dispose()`) share ONE implementation that keeps shadow-sink parity:
  ```ts
  /** Remove a record's meshes from the shadow sink, then dispose its root subtree. */
  private disposeRecord(record: MobRecord): void {
    for (const mesh of record.partMeshes) {
      this.shadowSink?.removeShadowCaster(mesh);
    }
    record.root.dispose(false, true);
  }
  ```
  Refactor the existing `dispose()` loop (`mob-renderer.ts:428-433`) to call `disposeRecord` too, AND dispose any in-flight `dyingRecords`:
  ```ts
  dispose(): void {
    for (const record of this.records.values()) this.disposeRecord(record);
    this.records.clear();
    for (const { record } of this.dyingRecords.values()) this.disposeRecord(record);
    this.dyingRecords.clear();
    // ... existing material + atlas + flash disposal ...
  }
  ```
- [ ] **(UNIT)** Import `deathGrace`, `deathScale` (extend the mob-animation import list).
- [ ] **(UNIT)** Verify the must-protect test: `corepack pnpm vitest run src/rendering/mob-renderer.test.ts`. Expected: green — `sync([])` at `mob-renderer.test.ts:228` passes NO `nowMs`, hits the `undefined` branch, calls `disposeRecord` synchronously → `getMeshCount() === 0` (`:231`) and `mesh.isDisposed() === true` (`:236`) immediately. The despawn-one-mob test (`:189`) and `dispose()` test (`:252`) also use the no-time path → unchanged.
- [ ] **(UNIT)** Confirm `getMeshCount()` semantics: it still returns `this.records.size` (`mob-renderer.ts:417-419`). Dying mobs live in `dyingRecords`, NOT `records`, so they are correctly excluded — `sync([])` drops the count to 0 the same frame even on the live path. Leave `getMeshCount` unchanged.
- [ ] **(UNIT)** Verify: `corepack pnpm typecheck`. Expected: clean.
- [ ] **(LIVE-QA)** Run the app; kill a mob and confirm it shrinks/fades over ~0.45 s before vanishing (not an instant pop). Flag if it disappears instantly (means the live path isn't passing `nowMs`) or lingers forever (tween never expires).
- [ ] Commit: `feat(mobs): renderer-only death-grace tween, synchronous-disposal-safe (Phase 3)`

---

## Task 9: Perf (doNotSyncBoundingInfo + single root culler) + regression gate (UNIT + LIVE-QA)

Cut per-frame bounding-info cost on animated parts and gate the whole phase behind the full suite + live QA.

**Files:**
- Modify: `src/rendering/mob-renderer.ts` (`buildModel` mesh creation)

Steps:

- [ ] **(UNIT)** Set `doNotSyncBoundingInfo = true` on every part box at creation (animated parts don't need per-frame world-bounds recompute; culling is driven off the root). Add immediately after each `box = CreateBox(...)` and BEFORE `addShadowCaster` (the analysis notes it must be set before the mesh enters the shadow generator):
  ```ts
      box.doNotSyncBoundingInfo = true;
  ```
  Apply to BOTH the leg-branch box (`mob-renderer.ts:317`) and the non-leg box (`333`).
- [ ] **(UNIT)** Keep the root as the single cull/hitbox reference — no per-part culling fields added (the root TransformNode already drives child visibility). No code change beyond a clarifying comment; document that adding a root-level culler is the future LOD hook.
- [ ] **(UNIT)** Verify the must-protect test: `corepack pnpm vitest run src/rendering/mob-renderer.test.ts`. Expected: green — `doNotSyncBoundingInfo` doesn't affect `getChildMeshes`, shadow-sink parity, or disposal.
- [ ] **(UNIT)** Full suite regression gate: `corepack pnpm test`. Expected: the full suite (incl. `entity.test.ts`, `mob-stats.test.ts`, `persistence.test.ts`, `mob-driver.test.ts`) is green. None of these were modified; baby scale defaults to 1.0 in `extra`, so `aabb()` (`entity.ts:95-106`) is unchanged.
- [ ] **(UNIT)** Verify: `corepack pnpm typecheck`. Expected: clean.
- [ ] **(LIVE-QA)** Run the app with the max ~20-mob cap on screen; confirm FPS holds at target and shadows still render on mobs. Flag any shadow flicker (would indicate `doNotSyncBoundingInfo` set after shadow-gen registration).
- [ ] Commit: `perf(mobs): doNotSyncBoundingInfo on parts + phase-3 regression gate (Phase 3)`

---

## Out of scope (explicitly deferred to Phase 4 / backlog)

These are NOT part of Phase 3 and must not be implemented here:

- **Mob knockback impulse** (velocity impulse off `lastDamageTick` in `attackMob`/`detonateCreeper`) — Phase 4 combat.
- **Player knockback** — deferred (player recomputes velocity from input each tick; needs a new impulse channel).
- **Invulnerability / i-frames** — Phase 4 combat.
- **Armor / equipment** (the separate `Equipment` holder, armor reduction math) — Phase 4.
- **Ranged / bow / arrow projectile** — Phase 5.
- **Potions / status effects** — Phase 5.
- **Real per-instance baby hitboxes** (threading `extra.babyScale` through `aabb()` / physics) — backlog; Phase 3 ships visual-only babies with the adult hitbox.
- **Mob instancing / skinning / `MergeMeshes` LOD** — profile-gated backlog (trigger on measured `drawCalls`, not mob count).
- **PBR/IBL mob-material port** — gated behind `USE_PBR_TERRAIN` (Section 2 Phase 2).
