# Voxel Survival Game — Playability Redesign Spec

**Date:** 2026-06-15
**Scope:** Targeted re-architecture of three weak subsystems — Rendering, Mobs, and Interaction/Combat/Equipment.
**Status:** Design approved per-section by the user; pending full-spec review before implementation planning.

---

## 1. Context & goal

The codebase is **not** a patched-together mess to rebuild. It is ~16,000 lines of production TypeScript across cleanly separated subsystems (world, chunk, meshing, rendering, mobs, inventory, crafting, survival, save, ui) with **885 passing unit tests**, on Babylon.js 8 + Vite + strict TS. The meshing is greedy (correct), mobs are already multi-part articulated, and there is a full crafting/survival/day-night/save stack.

The problem is a gap between **"tests pass"** and **"the game looks and plays well."** Everything is verified headless (NullEngine / headless browser), which renders no pixels and never exercises the item-use input path — so three real defects slipped through:

1. **Rendering** reads as washed-out blue-grey graph paper up close.
2. **Mobs** are articulated but flat-colored, near-identical, and share one animation — monotonous.
3. **Hotbar items can't be used** — non-block items are a silent no-op.

The decision (with the user) is a **targeted re-architecture of these three layers**, not a ground-up rewrite that would discard ~27k tested LOC, and not more band-aids.

### Locked decisions
- **Art direction:** Refined Textured (Golden-Hour); spawn into golden hour.
- **Mobs:** Textured + Expressive & Varied.
- **Interaction:** Core loop + combat + equipment (armor, ranged/bow, potions).
- **Sequencing philosophy:** ship the safe, high-impact "v1" of each layer on the current `StandardMaterial` pipeline; gate the heavy/risky upgrades (PBR+IBL, mob instancing, player-knockback) behind flags / a backlog with explicit triggers.

### Constraints (apply to every section)
- Babylon.js 8, TypeScript strict, Vite, pnpm via Corepack.
- Target **60fps @ 1080p**; keep COOP/COEP isolation.
- Keep the 885-test suite green **except** the small set of "design-lock" tests that deliberately encode the *old* look/behavior — those are updated intentionally and called out per section.
- Prefer **zero new assets** for v1 where possible.
- **Visual/interaction changes require live screenshot/▶-run QA** — the headless suite cannot catch them. This is the process gap that hid all three defects; closing it is part of the work.

### Method note (how these decisions were validated)
Each section's architecture was cross-checked by independent multi-model panels (the Fusion skill, General mode, sequential calls) and an Opus design workflow, with repo-reading panelists verifying claims against the actual source and the test suite. Per-section audit trails are summarized in §6.

---

## 2. Section 1 — Rendering: in-place "golden-hour" cure (PBR deferred behind a flag)

### 2.1 Architecture
**Unchanged core, surgically corrected.** Keep the greedy mesher, the `StandardMaterial` + `AtlasMaterialPlugin` terrain path, the two-light + CSM setup, and the single `DefaultRenderingPipeline` post pass. **Do not** adopt PBRMaterial or NodeMaterial for v1 — both flashy rewrites were refuted against Babylon 8 source (PBR forces a palette re-tune + mob port + unconfirmed 60fps; NodeMaterial's reflection-as-IBL and in-material grade are wrong under the post-process pipeline).

### 2.2 Root causes (verified against source)
- **The grid** = three intentional fragment-shader darkening passes near block edges in `terrain-material.ts` (seam ~20% + AO band ~22% + a hard outline 50% within ~3% of block-UV width), stacking to ~31% darkening at every edge. Pure shader; not a UV/mip bug.
- **The cold/washed color** = (a) `applySky()` **overwrites `scene.clearColor`/`fogColor` every frame** from the noon sky keyframe (a saturated cool blue), so warming constants in `main.ts` does nothing; (b) cool ambient floor; (c) ACES at exposure/contrast 1.0 with **no color grading**; (d) a low-chroma cool/olive palette (atlas texel noise is achromatic → palette base color is the sole hue source).
- **"Material not ready"** is a **diagnostic measurement bug**: `isReady()` is called with no mesh arg, which `PushMaterial` always answers `false` to. The material is fine.
- **`useSRGBBuffer` is harmful here** (do not enable): the post-process linearizes the lit color before ACES, so flipping the atlas to an sRGB buffer double-linearizes/over-darkens midtones. The conclusion is unanimous; the exact mechanism is "double-decode of a gamma-space-lit frame."

### 2.3 Change list (v1)
| Area | File(s) | Change |
|---|---|---|
| Remove grid | `src/rendering/terrain-material.ts` | Delete the hard outline pass; collapse the seam + AO passes into **one** gentle contact-AO (≤8–10% darken over a soft band). Keep `vFaceShade`. |
| Warm palette | `src/rendering/palette.ts` | Warm + slightly saturate base colors, **tuned against rendered output (gamma space)** — will not equal exact DESIGN.md hex (that's what PBR buys). Palette tests only check `[0,1]` ranges → safe. |
| Golden-hour light | `src/main.ts`, `src/time/sky.ts`, `src/game/daynight.ts` | Warm key (~5200K) + cool hemisphere sky fill (~7500K) with warm ground bounce; warm the daytime sky keyframe(s) and decouple/warm fog; sun toward ~25° elevation / ~135° azimuth; warm the ambient floor (keep material `ambientColor=(1,1,1)`). |
| Golden-hour spawn | `src/time/sky.ts`, `src/main.ts` (spawn tod) | Spawn into a **bright golden-hour time-of-day** (before `SUNSET_START`, where sun intensity ≈ 1.0); add a dedicated bright-warm keyframe. This delivers warmth + a low raking sun **without** breaking noon sun geometry. |
| Grade | `src/rendering/post-fx.ts` | On the existing pipeline: enable `ColorCurves` (warm global tint, cooler shadows) + `contrast ≈ 1.10` + `exposure ≈ 1.05–1.10`. Keep ACES. No new render pass. |
| Readiness diagnostic | `src/main.ts`, `src/rendering/world-renderer.ts` | Add `getFirstOpaqueMesh()`; pass a real mesh to `isReady()` (or read `subMesh.effect.isReady()`). |
| (Do NOT) | — | Do **not** enable `useSRGBBuffer` on the atlas. |

### 2.4 Phase 2 — flag-gated, NOT in v1
A `USE_PBR_TERRAIN` flag (default **off**) swapping terrain to `PBRMaterial` + a baked **kloofendal** golden-hour `.env` for true IBL and exact-spec color. The flag **must also** gate atlas sRGB handling and a mob-material port for lighting consistency. **Benchmark 60fps before enabling** — PBR fragment + IBL + CSM is the only real perf risk in the whole redesign. Asset: download CC0 kloofendal HDRI, bake to a prefiltered `.env`, self-host (preserve COOP/COEP). Every asset path try/catch-guarded → degrade to v1 procedural golden hour on failure.

### 2.5 Design-lock tests to update (intentional)
- `terrain-material.test.ts` — asserts the shader still contains `smoothstep` / `_seam` / `mix(0.80`; update to assert the outline term is gone and AO darkening ≤ ~12%.
- `sky.test.ts` — noon "b > r" and sun "y > 0.5" assertions conflict with golden-hour spawn/warm sky; update to the new targets.
- `daynight.test.ts` — exact-`clearColor` assertion; update to the new keyframe.
- Update `DESIGN.md` with the new target values so the "must not drift from DESIGN.md" tests anchor to reality.

### 2.6 Perf / assets / open decision
Perf: net-flat or **cheaper** (deletes shader ALU, adds sub-0.1ms grade math to an existing pass). Assets: **zero** for v1. Open decision (resolve during build via A/B screenshots): ACES vs `KHR_PBR_NEUTRAL` tone mapping.

---

## 3. Section 2 — Mobs: Textured + Expressive & Varied

### 3.1 Architecture
**A (extend in place) + B-lite (declarative schema) now; C (instancing/skinning) deferred.** The mob cap is **20** (10 hostile + 10 passive) → worst case ~140 cheap box draw calls, comfortably within budget (terrain + shadows dominate). Thin-instancing is therefore unjustified **and** actively fights the art direction (it shares one geometry/material → kills per-part textures, no skeleton). Keep C as a **profile-gated** escape hatch (trigger on measured `drawCalls`, not mob count); per-mob `MergeMeshes` is the cheaper first lever (loses per-part animation → distant/LOD only).

### 3.2 Change list
| Area | File(s) | Change |
|---|---|---|
| Schema (B-lite) | `src/rendering/mob-renderer.ts` | Extend `PartDef`/`ModelDef`/`MODELS` (already ~90% a schema) with `pivotRole` (`leg`/`head`/`tail`/`ear`), per-face atlas regions, and per-species gait params — instead of hardcoding new special cases. |
| Per-part textures | `src/rendering/mob-renderer.ts` + new mob atlas | Use `CreateBox({ faceUV: Vector4[6] })` + a plain `StandardMaterial.diffuseTexture` on a **separate small mob atlas**. **Not** the terrain `AtlasMaterialPlugin`. Sampling: **NEAREST + generous gutters + half-texel UV inset + CLAMP addressing** (matches pixel-art blocks, zero bleed). Add mips only if QA shows minification shimmer. |
| Animation | `src/rendering/mob-renderer.ts` (render sync) | Procedural **multi-channel** rig (gait / head look-at / idle bob / tail-ear / hit / death) on `TransformNode` pivots, composed **additively as quaternions** (channels own disjoint pivots; no Euler overwrite). **Zero allocation** per frame (`TmpVectors`, `*ToRef`, in-place). Feed a continuous **`deltaTime`** into sync — the current `mob.age` clock is tick-quantized (≈20/s) and renders at 60fps → stepped motion. Babylon's keyframe `Animation` only for **discrete one-shots** (hit flash, death clip). |
| Variety | `src/rendering/mob-renderer.ts`, `src/mobs/entity.ts` (`extra`) | **v1: visual-only baby** (scale render root; hitbox stays from `MOB_STATS`). Real per-instance baby hitbox = follow-up, threading `extra.babyScale` (default 1.0, persisted) through `aabb()`/physics. Per-individual variation via **vertex-color tint** (`useVertexColors`; texture × white = unchanged) and/or `faceUV` atlas-region offset — **never** per-instance materials. |
| Combat feedback | `src/game/mob-driver.ts`, `src/rendering/mob-renderer.ts` | **Knockback** = velocity impulse in the logic layer (`attackMob`/`detonateCreeper`, off existing `lastDamageTick`). **Hit flash** without breaking the shared-material test → temporary per-mesh swap to a shared "flash" material (or additive overlay). **Death** = renderer-only "dying" grace tween that keeps disposal **synchronous in the no-time-arg test path**. |
| Perf | `src/rendering/mob-renderer.ts` | `doNotSyncBoundingInfo = true` on animated parts; single root hitbox/culler. |

### 3.3 Design-lock tests to protect
- `mob-renderer.test.ts` — **the one to watch**: material sharing (two same-type mobs share `meshes[0].material`), shadow-sink add/remove parity, disposal/`getMeshCount` after `sync([])`. Mechanisms above keep it green: no per-instance materials; flash via swap/overlay; death tween only runs with a time delta (test path passes none → synchronous disposal).
- `entity.test.ts` / `mob-stats.test.ts` — pin `aabb()` == `MOB_STATS`; safe because baby scale defaults to 1.0 and lives in `extra`.
- `persistence.test.ts` — proves `extra` round-trips exactly (where variant state lives). Do not add top-level `Mob` fields or constructor args.

---

## 4. Section 3 — Interaction / Combat / Equipment

### 4.1 Architecture
**A (incremental wiring) structured as B (data-driven item-behavior dispatch); defer C (event bus).** Single actor + small verb set → an event pipeline is over-engineering.

### 4.2 Core fix + latent bugs
- **The no-op bug**: `placeBlock` rejects `itemId >= BLOCK_COUNT` (=29). **Do not change that guard** (3 `edit.test.ts` cases depend on it). Route by item kind **upstream** in the right-click handler, *before* falling through to place. Implement a **pure** `resolveUse(itemDef, ctx) → action` (unit-testable); keep Babylon-coupled effects thin in the glue layer.
- **Precedence (code-grounded):** interact-with-block (table/bed/future furnace) → **eat-if-food-and-hungry** → place-if-placeable → use-other. (Optionally move table/bed special-cases into a block-registry `onRightClick` capability; sneak bypasses block interaction.)
- **Latent bug 1:** `eat()` exists but is never called and the click handler doesn't import the item registry → wire it.
- **Latent bug 2:** the starter "tools" are **fake** — block ids (`OAK_LOG`, `STONE`) carrying durability, not real `Items.*` tools. Replace with real tool items + add food. Route the starter loadout through one `makeDefaultInventory()` factory to localize test churn.

### 4.3 Subsystems
| Subsystem | Decision |
|---|---|
| Tools matter | `breakTicks(blockId, heldDef)` from tier × hardness, accumulated on the **fixed 20 Hz tick** (deterministic + testable via injected clock); durability decrements **on break only** (don't double-charge vs the current per-click wear); `Infinity` hardness → never breaks. `attackDamageFor(held)` for melee (keep `attackMob` signature **defaulted** so `mob-driver.test.ts` stays green). |
| Combat | Invulnerability frames (so mobs don't melt the player at 20 Hz). **Mob knockback now** (mobs have `velocity`); **player knockback deferred** (player body recomputes velocity from input each tick — needs a new impulse channel). Hit/death feedback shared with the mob section. |
| Equipment | **Separate `Equipment` holder** (4 armor slots + optional off-hand) on `Player` — **NOT** a widened 36→40 inventory (widening breaks `inventory.test.ts` `SLOTS===36` + the persistence loop). Armor reduction: additive points × 4% capped at 80%; MC order **armor → resistance → clamp**; results round to **integer half-hearts** (the health economy is integer). Armor durability on hit. Off-hand deferrable. |
| Ranged | **Kinematic** arrow entity (never a physics body), per-tick **swept DDA vs voxels + AABB vs mobs** (no tunneling), pooled/recycled, capped count. Bow charge needs `mouseup` + a charge timer (input layer is `mousedown`-only today). Hitscan (reuse `raycastVoxel` + `pickMob`) is an acceptable v1 shortcut; ballistic-with-charge is the target. |
| Potions / status effects | Greenfield `effects.ts`: a list on the player `{type, amplifier, ticksRemaining}` ticked alongside `tickSurvival`; same-type higher-amplifier replaces, equal refreshes duration; reverse-iterate to expire. **Must not double-heal** with natural regen — compose carefully with the 13 existing regen/starve tests. |

### 4.4 New modules (each with a `*.test.ts`)
`interaction/use-item.ts` (pure `resolveUse` routing matrix), `interaction/mining.ts` (`breakTicks` per tier×hardness), `inventory/equipment.ts` (armor/off-hand slots), `combat/armor.ts` (reduction math + clamping), `combat/knockback.ts` (impulse, pure), `effects/status.ts` (stack/refresh/expiry), `projectile/arrow.ts` (charge→velocity, per-tick step, block-vs-mob hit precedence).

### 4.5 Tests at risk
`mob-driver.test.ts` `attackMob` (keep a defaulted signature), `inventory.test.ts` (don't widen — use the separate holder), `save/serialize.test.ts` + `game/persistence.test.ts` (additive `equipment`/`effects` + a `SAVE_VERSION` migration). `edit`/`items`/`stats`/`stack`/`entity` largely safe (fix lives in the handler, not `placeBlock`/`stats`).

---

## 5. Cross-cutting

- **Live-render QA is mandatory** for every visual/interaction change — the headless suite renders no pixels and never exercised the item-use path; that is exactly why these defects shipped "green." Add a screenshot/▶-run check to the workflow.
- **Save migration:** bump `SAVE_VERSION` for `equipment`, `effects`, and `extra.babyScale` (additive, default empty); the migration infra already exists.
- **Suggested phase order** (each phase ships independently and keeps tests green):
  1. **Rendering v1 cure** — fastest, highest visible impact, near-zero perf risk.
  2. **Interaction core** — `resolveUse` + eat food + tools-matter + fix the fake starter tools.
  3. **Mob textures + multi-channel rig** (+ vertex-color variety, hit/death feedback).
  4. **Combat + equipment** — melee damage, i-frames, mob knockback, armor + reduction.
  5. **Ranged + potions** — bow/arrow projectile, status-effect system.
  6. **Later / flag-gated:** PBR+IBL terrain (`USE_PBR_TERRAIN`), real baby hitboxes, mob instancing (if a profile demands it), player knockback, off-hand, tone-mapping A/B.
- **Out of scope (deferred):** PBR+IBL, mob skinning/instancing, player-knockback, off-hand, full event pipeline (C).

---

## 6. Audit trail (validation method)

- **Recon:** 3 read-only Explore agents (structure, rendering, mobs/inventory) + 1 live-run agent (885 tests green, build OK; captured spawn screenshots; confirmed the item-use bug).
- **Rendering:** a 13-agent Opus design workflow (understand → diagnose → 3 design approaches → adversarial verify → synthesize), then the **Fusion** skill (4 effective: MiniMax, DeepSeek + 2 repo-reading Opus). Verdict: minimal in-place cure now, PBR flag-gated, NodeMaterial rejected. Key cross-checks: `useSRGBBuffer` refuted; `applySky` per-frame override found; tests encode the old look.
- **Mobs:** Fusion General mode, **sequential**, 6 effective (MiniMax, MiMo, DeepSeek, Qwen, Kimi via API + 1 repo-reading Opus). Verdict: A + B-lite now, defer C. Key cross-check: mob cap = 20 → no instancing (and instancing fights per-part textures).
- **Interaction:** Fusion General mode, **sequential**, 6 effective (same panel). Verdict: A-wired-as-B, defer C. Key cross-checks: fix routing in the handler not the `placeBlock` guard; `eat()` unwired; **fake starter tools**; player has no impulse channel; integer-half-heart economy; exact test-breakage map.
- **Note on the panel:** agentic/code models (Qwen, Kimi) required a no-tools prompt variant (they otherwise emit tool-call syntax through the API gateway and truncate); the framing change is accurate, not conclusion-steering. Per user rule, Fusion General mode is always run with **sequential** panelist calls.

---

## 7. Open questions for the reviewer
1. Tone mapping: settle ACES vs `KHR_PBR_NEUTRAL` now, or A/B during the rendering build? (Default: A/B during build.)
2. Phase 2 PBR+IBL: confirm appetite for a benchmarked, flag-gated follow-up (≈3–5 days) before it's started — or leave it purely in the backlog.
3. Off-hand slot: in scope for the equipment phase, or deferred? (Default: deferred.)
4. Real (per-instance) baby hitboxes: in scope, or visual-only babies for now? (Default: visual-only now.)
