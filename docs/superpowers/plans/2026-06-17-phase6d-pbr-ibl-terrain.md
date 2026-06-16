# Phase 6d — Flag-gated PBR + IBL Terrain: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the FINAL deferred §5 Phase-6 backlog item (`docs/superpowers/specs/2026-06-15-voxel-redesign-design.md` §2.4) — a `USE_PBR_TERRAIN` flag (default **false**) that, when ON, swaps the terrain to a Babylon `PBRMaterial` path (reusing the existing albedo atlas + tile-lookup shader, metallic ≈ 0, sensible roughness) AND wires a PROCEDURAL image-based-lighting (IBL) environment texture into `scene.environmentTexture` / `scene.environmentIntensity`, reconciled with the existing sun/hemi lights + CSM shadows + Phase-6c ACES tone modes so it neither blows out nor goes flat. **When the flag is OFF the existing `StandardMaterial` + `AtlasMaterialPlugin` golden-hour path is byte-identical** — no `scene.environmentTexture`, no PBR material, no new shader, all existing rendering tests (`terrain-material.test.ts`, `post-fx.test.ts`, `daynight.test.ts`, `sky.test.ts`) stay green with zero edits to their pinned assertions. This is the LAST sub-phase: nothing beyond PBR+IBL terrain. **NO `SAVE_VERSION` interaction** — this is rendering-only; `SAVE_VERSION` stays at 8 (confirmed `src/save/migration.ts` L14) and is not read or written by any task here.

**Architecture:** A single `export const USE_PBR_TERRAIN = false;` in `src/rendering/terrain-material.ts` (mirroring the existing `USE_ATLAS = true` at L41) is the master gate. The work is a clean **dual path that shares the atlas texture**:

- *Material path.* `createTerrainMaterials(scene)` keeps its exact signature (`(scene: Scene) => TerrainMaterials` at L252) and its existing `StandardMaterial` body **unchanged** when the flag is OFF. When ON, it delegates to a new private `createPbrTerrainMaterials(scene, atlasTex)` that builds a `PBRMaterial` pair (opaque + transparent) sharing the SAME `RawTexture` atlas the StandardMaterial path builds, attaches a new `PbrAtlasMaterialPlugin` (extends `MaterialPluginBase`, priority 200, same `getAttributes`/`getSamplers`/`bindForSubMesh`/`getActiveTextures`/`hasTexture` overrides as `AtlasMaterialPlugin`) that injects the atlas lookup at PBR's `CUSTOM_FRAGMENT_UPDATE_ALBEDO` injection point (verified present via `node_modules/@babylonjs/core/Shaders/ShadersInclude/pbrBlockAlbedoOpacity.js`) and re-applies `vFaceShade` + the gentle contact-AO into `surfaceAlbedo`. `PBRMaterial` is configured `metallic = 0.0`, `roughness = PBR_TERRAIN_ROUGHNESS` (a single named uniform value — v1 is UNIFORM roughness, NOT per-type; per-type is an explicit open question), `backFaceCulling` matching the StandardMaterial pair (opaque true / transparent false), transparent `alpha = TRANSPARENT_ALPHA` via `transparencyMode = MATERIAL_ALPHABLEND`. The two PBR materials are still exactly two SHARED instances (never per-mesh). `chunk-mesh.ts` is **untouched** — the per-vertex `tileIndex` + `faceShade` attributes it already sets are read identically by either plugin; `world-renderer.ts` is **untouched** — it consumes the opaque/transparent pair via the `TerrainMaterials` interface regardless of concrete material class.

- *IBL path.* A new PURE, Babylon-free module `src/rendering/environment-cubemap.ts` exports `generateGradientCubeRGBA(size: number): Uint8Array` — a deterministic 6-face cubemap (warm amber +X, cool blue −X, bright sky +Y, dark warm floor −Y, gradient ±Z), hash + smoothstep, no RNG, fully NullEngine-safe and unit-testable. A guarded `createEnvironmentCubemap(scene): CubeTexture | null` wraps that data in a `RawCubeTexture` inside a try/catch so a NullEngine / low-end GPU failure degrades to `null` and **cannot black-out boot**. `main.ts` constructs the env texture ONCE at boot **only when `USE_PBR_TERRAIN` is true** (so the OFF path never touches `scene.environmentTexture`). `applySky` gains an OPTIONAL third arg `env?: { texture: BaseTexture; intensity: number }`; when provided it sets `scene.environmentTexture` + `scene.environmentIntensity`; when omitted (the default OFF path and every existing test caller) the function body is byte-identical. The per-frame env intensity is derived from the existing `sunLightIntensityAt(tod)` curve scaled by a new persisted `Prefs.pbrIntensity` (0..1, default 0.5) so IBL dims at night and never double-brightens midnight; it is clamped to `[0, 1]`.

- *Tone-mapping reconciliation.* No new tone mode and NO change to `TONE_MODES` (the Phase-6c `goldenHour`/`neutral` frozen grades stay byte-identical). The Phase-6c ACES `ImageProcessingPostProcess` already sits downstream of the whole scene, so PBR+IBL output feeds the same constant ACES + grade pass. The only reconciliation is the `environmentIntensity` ceiling (≤ `pbrIntensity` ≤ 0.5 by default) chosen so noon-with-IBL lands near today's noon energy rather than blown out — a value tuned in the live-QA gate, not asserted in a unit test.

**Deep-import gotcha (load-bearing — see per-task Must-protect):** Babylon's tree-shaken deep imports mean a class is only registered with the scene when its module is imported for its side effects. `PBRMaterial` self-registers via `RegisterClass("BABYLON.PBRMaterial", …)` (confirmed `node_modules/@babylonjs/core/Materials/PBR/pbrMaterial.js` L714) so importing the class is sufficient; the `MaterialPluginBase` augmentation requires the existing `import "@babylonjs/core/Materials/materialPluginManager";` side-effect (already present in `terrain-material.test.ts` L13). IBL via `scene.environmentTexture` + a `RawCubeTexture` needs no extra side-effect registration, but ALL IBL/eye-candy construction is wrapped in try/catch and the OFF path is the boot default, so a missing-registration runtime throw can never black out boot. After ANY task that can run with the flag ON, re-verify `corepack pnpm build` succeeds (boot bundle compiles).

**Tech Stack:** Babylon.js 8 (`@babylonjs/core ^8.0.0`; `PBRMaterial`, `MaterialPluginBase`, `RawCubeTexture` all present in v8 — verified on disk), TypeScript (strict: `noUnusedLocals`/`noUnusedParameters`/`exactOptionalPropertyTypes`), Vite, Vitest (NullEngine for pure + Babylon-headless shader-plugin construction; live-QA for visual/feel), pnpm via Corepack (`corepack pnpm …`).

---

## Verifiability honesty (read before starting)

What is genuinely UNIT-testable under NullEngine (no GPU):

- The flag default is `false` and the OFF path returns the existing `StandardMaterial` pair (class identity check).
- With the flag forced ON in a test, `createTerrainMaterials` returns a `PBRMaterial` pair **without throwing** under NullEngine, sharing one atlas texture, with `metallic === 0`, `roughness === PBR_TERRAIN_ROUGHNESS`, correct backface culling + transparent alpha, and the plugin injecting at `CUSTOM_FRAGMENT_UPDATE_ALBEDO` (shader-source string assertions, the same technique `terrain-material.test.ts` already uses).
- `generateGradientCubeRGBA` is PURE: deterministic bytes, correct length (`6 * size * size * 4`), all channels in `[0,255]`.
- `applySky(targets, clock, env)` sets `scene.environmentTexture` / `scene.environmentIntensity` when `env` is passed and leaves them untouched (null) when omitted; intensity is clamped to `[0,1]`.
- `Prefs.pbrIntensity` clamps/round-trips/defaults like every other pref.

What is REAL-GPU LIVE-QA ONLY (NOT unit-testable — do not pretend otherwise):

- Whether the OFF path is **pixel-identical** to the shipped golden-hour reference (byte-identity is a screenshot diff, not a NullEngine assertion).
- Whether the ON path **looks good**: stone reads matte not metallic, grass not shiny, wood keeps warmth, water gets a sensible sheen.
- Whether IBL **augments** sun/hemi without blowing out (noon) or going flat (dusk), and behaves at midnight.
- Whether CSM shadows stay crisp and acne-free under PBR.

These live in the final **Task 7 — Live-QA gate**, which ships nothing and asserts nothing in code.

---

## File Structure

| Path | Action | Purpose |
|---|---|---|
| `src/rendering/terrain-material.ts` | **Modify** (add `USE_PBR_TERRAIN` const + `PBR_TERRAIN_ROUGHNESS` const; add `PbrAtlasMaterialPlugin`; branch in `createTerrainMaterials`) | Master flag; PBR plugin + PBR material pair sharing the atlas. OFF path body unchanged. |
| `src/rendering/terrain-material.test.ts` | **Modify** (append a `describe` block; existing atlas-path pins untouched) | Flag default false; OFF returns StandardMaterial; ON returns PBRMaterial without throwing + MR params + ALBEDO injection. |
| `src/rendering/environment-cubemap.ts` | **Create** | PURE `generateGradientCubeRGBA(size)` + guarded `createEnvironmentCubemap(scene)`. |
| `src/rendering/environment-cubemap.test.ts` | **Create** | Pure cubemap determinism/size/range; guarded Babylon construct does-not-throw under NullEngine. |
| `src/game/daynight.ts` | **Modify** (`applySky` gains optional `env` 3rd arg; add `sunLightIntensityAt` is already imported) | Wire `scene.environmentTexture`/`environmentIntensity` only when `env` is provided; OFF path byte-identical. |
| `src/game/daynight.test.ts` | **Modify** (append; existing clearColor/sun/hemi pins untouched) | env arg sets/clamps env props; omitted arg leaves them null. |
| `src/game/preferences.ts` | **Modify** (`Prefs` + `DEFAULT_PREFS` + `clampPrefs` + `parsePrefs`) | Add persisted `pbrIntensity: number` (0..1, default 0.5). |
| `src/game/preferences.test.ts` | **Modify** (append) | default; clamp out-of-range; missing-field tolerance; round-trip. |
| `src/main.ts` | **Modify** (boot env construction behind flag; pass `env` into the per-frame `applySky` call) | Construct env cubemap once when flag ON; thread it through `applySky`. OFF path unchanged. |
| `DESIGN.md` | **Modify** (doc-only: add a "PBR+IBL terrain (flag-gated, default OFF)" note) | Record the flag + procedural-IBL default so the design-lock anchor matches reality. |

**Files explicitly NOT touched:** `src/rendering/chunk-mesh.ts` (vertex attrs already correct for both plugins), `src/rendering/world-renderer.ts` (consumes the `TerrainMaterials` pair abstractly), `src/rendering/atlas.ts` (atlas reused as-is), `src/rendering/post-fx.ts` + `TONE_MODES` (no tone-mode change), every `src/save/*` file (`SAVE_VERSION` stays 8 — rendering only).

---

### Task 1: Introduce the `USE_PBR_TERRAIN` flag (default false) and PROVE the default path is unchanged (tests FIRST)

Add the master flag and the uniform-roughness constant. Do NOT add the PBR material yet — this task only introduces the gate, defaults it OFF, and locks in a regression test that the OFF path still returns a `StandardMaterial` pair (so every subsequent task can be checked against "flag OFF ⇒ byte-identical"). Nothing in the runtime behavior changes; the flag is declared and unread.

**Files:**
- Modify: `src/rendering/terrain-material.ts` (add two `export const`s near `USE_ATLAS` L41)
- Modify: `src/rendering/terrain-material.test.ts` (append a new `describe`; existing atlas-path pins byte-identical)

**Must-protect:**
- `USE_ATLAS = true` (L41) is unchanged and independent. `USE_PBR_TERRAIN` is a SEPARATE flag; the PBR path requires `USE_ATLAS === true` (it reuses the atlas), but this task does not couple them in code yet.
- All existing `terrain-material.test.ts` assertions (the atlas-path `describe`, L30–192) MUST stay green untouched — the OFF default means `createTerrainMaterials` still runs the exact StandardMaterial body.
- `createTerrainMaterials(scene)` keeps its signature `(scene: Scene) => TerrainMaterials` exactly (L252). No new args, no ABI change between flag states (`exactOptionalPropertyTypes` discipline).
- `PBR_TERRAIN_ROUGHNESS` is a NAMED const (no bare `0.7` magic later). v1 is UNIFORM roughness.

Steps:

- [ ] **(CODE)** Add the flag + roughness constant to `src/rendering/terrain-material.ts`, immediately after `export const USE_ATLAS = true;` (L41). Insert:
  ```ts
  /** Flip to `false` to fall back to the old vertex-color path. */
  export const USE_ATLAS = true;

  /**
   * Phase 6d master flag (default OFF). When `false`, terrain uses the existing
   * StandardMaterial + AtlasMaterialPlugin golden-hour path and the scene has NO
   * environment texture — BYTE-IDENTICAL to the shipped look. When `true`,
   * createTerrainMaterials returns a PBRMaterial pair (metallic 0, uniform
   * roughness) reusing the SAME albedo atlas, and main.ts wires a procedural IBL
   * cubemap into scene.environmentTexture. Requires USE_ATLAS === true (the PBR
   * path reuses the atlas). Rendering-only: NO SAVE_VERSION interaction.
   */
  export const USE_PBR_TERRAIN = false;

  /**
   * Uniform GGX roughness for the PBR terrain path (Phase 6d, v1). Tuned toward
   * the matte Minecraft voxel look (no shiny stone). Metallic is fixed at 0 (all
   * terrain is non-metal). Per-type roughness is an explicit follow-up, not v1.
   */
  export const PBR_TERRAIN_ROUGHNESS = 0.78;
  ```
- [ ] **(CODE, UNIT)** Append a flag-default + OFF-path regression `describe` to `src/rendering/terrain-material.test.ts`. Add the import to the existing import group and the block at the END of the file (do NOT edit the atlas-path describe):
  ```ts
  import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
  import { USE_PBR_TERRAIN, PBR_TERRAIN_ROUGHNESS } from "./terrain-material";

  describe("USE_PBR_TERRAIN flag (Phase 6d)", () => {
    it("defaults to false (shipped path is StandardMaterial, no PBR)", () => {
      expect(USE_PBR_TERRAIN).toBe(false);
    });

    it("PBR_TERRAIN_ROUGHNESS is a sensible matte value in (0,1]", () => {
      expect(PBR_TERRAIN_ROUGHNESS).toBeGreaterThan(0);
      expect(PBR_TERRAIN_ROUGHNESS).toBeLessThanOrEqual(1);
    });

    it("with the flag OFF, createTerrainMaterials returns StandardMaterials", () => {
      // The default flag is OFF, so the existing StandardMaterial body runs.
      const mats = createTerrainMaterials(scene);
      expect(mats.opaque).toBeInstanceOf(StandardMaterial);
      expect(mats.transparent).toBeInstanceOf(StandardMaterial);
    });
  });
  ```
  (`createTerrainMaterials`, `scene`, `describe`/`it`/`expect` are already imported/in scope at the top of the file. The `import type { StandardMaterial }` at L10 is a TYPE-only import; add the VALUE import shown above — TS allows both a type and value import of the same name, but to avoid a duplicate-identifier error, change L10's `import type { StandardMaterial }` to a plain `import { StandardMaterial }` and drop the `type` keyword, OR add only the value import and remove the type-only line. Pick one; the value import covers both uses.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/rendering/terrain-material.test.ts` → all green (every existing atlas-path assertion + the 3 new flag assertions).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors (no unused import; `StandardMaterial` is now used as a value).
- [ ] **(VERIFY, BUILD)** `corepack pnpm build` → succeeds (flag is declared, unread — boot bundle unchanged).
- [ ] **Commit:** `feat(render): add USE_PBR_TERRAIN flag (default off) + uniform roughness const`

---

### Task 2: `PbrAtlasMaterialPlugin` + flag-gated PBR material pair (tests FIRST)

Build the PBR material path: a new `MaterialPluginBase` subclass that injects the atlas lookup at PBR's `CUSTOM_FRAGMENT_UPDATE_ALBEDO`, and a private factory that returns a shared `PBRMaterial` opaque/transparent pair (metallic 0, uniform roughness) reusing the SAME atlas `RawTexture`. Branch `createTerrainMaterials` on the flag. With the flag OFF (the default), this code is unreachable and the StandardMaterial body runs untouched.

**Files:**
- Modify: `src/rendering/terrain-material.ts` (add imports; add `PbrAtlasMaterialPlugin`; add `createPbrTerrainMaterials`; branch `createTerrainMaterials`)
- Modify: `src/rendering/terrain-material.test.ts` (append a flag-ON `describe` that forces the PBR path via a test-only factory)

**Must-protect:**
- The OFF path (flag false) is the DEFAULT and runs the existing StandardMaterial body verbatim — Task 1's "OFF returns StandardMaterial" test and every original atlas-path test stay green.
- DEEP-IMPORT GOTCHA: import `PBRMaterial` from `@babylonjs/core/Materials/PBR/pbrMaterial` (its module self-registers via `RegisterClass`). The `materialPluginManager` side-effect import is already pulled in by the test (L13) and by Babylon's material core; the plugin attaches the same way `AtlasMaterialPlugin` does. Do NOT rely on the `@babylonjs/core` barrel.
- PBR path must produce exactly TWO shared instances (opaque + transparent) sharing ONE atlas `RawTexture` — never per-mesh, never a second atlas (memory + the `getActiveTextures` test).
- Transparent PBR uses `transparencyMode = PBRMaterial.MATERIAL_ALPHABLEND` + `alpha = TRANSPARENT_ALPHA` (0.7) + `backFaceCulling = false`; opaque uses `backFaceCulling = true`. Mirrors the StandardMaterial pair so water/glass/leaves still render both sides.
- `metallic = 0`, `roughness = PBR_TERRAIN_ROUGHNESS` set explicitly (number, never `undefined` — `exactOptionalPropertyTypes`).
- The plugin's `getAttributes` registers `tileIndex` + `faceShade` (same as `AtlasMaterialPlugin`) so `chunk-mesh.ts` needs NO change. `getSamplers` pushes `atlasSampler`; `bindForSubMesh` binds the shared atlas; `getActiveTextures`/`hasTexture` report it.
- The injection point is `CUSTOM_FRAGMENT_UPDATE_ALBEDO` (PBR), NOT `CUSTOM_FRAGMENT_UPDATE_DIFFUSE` (StandardMaterial) — verified present via `pbrBlockAlbedoOpacity.js`. The PBR fragment target variable is `surfaceAlbedo` (a `vec3` in PBR's pipeline at that point), so write `surfaceAlbedo.rgb`/`surfaceAlbedo` — do NOT reference `baseColor` in the PBR plugin.
- `getCustomCode`'s real signature is `getCustomCode(shaderType: string): { [pointName: string]: string } | null` (NOT a `'vertex'|'fragment'` union — confirmed against the live `AtlasMaterialPlugin` at terrain-material.ts L149). Match it exactly to avoid an override-signature type error.
- `prepareDefinesBeforeAttributes` sets `defines._needUVs = true` (same reason as the atlas plugin: without it UV1 is excluded and every fragment samples one texel).

Steps:

- [ ] **(CODE)** Add imports to the top of `src/rendering/terrain-material.ts` (next to the existing material imports, L32–36):
  ```ts
  import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
  import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
  import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
  ```
  (`StandardMaterial` and `MaterialPluginBase` are already imported — only ADD the `PBRMaterial` line; do not duplicate the others.)
- [ ] **(CODE)** Add the `PbrAtlasMaterialPlugin` class below the existing `AtlasMaterialPlugin` (after its closing brace, ~L228). It mirrors `AtlasMaterialPlugin` but injects at the PBR albedo point:
  ```ts
  /**
   * A {@link MaterialPluginBase} that plugs the SAME procedural atlas lookup as
   * {@link AtlasMaterialPlugin} into a {@link PBRMaterial}'s GLSL — but at the PBR
   * albedo injection point `CUSTOM_FRAGMENT_UPDATE_ALBEDO` (writing `surfaceAlbedo`)
   * instead of StandardMaterial's `CUSTOM_FRAGMENT_UPDATE_DIFFUSE` (`baseColor`).
   * Babylon's full PBR lighting + IBL pipeline then runs on top, so metallic 0 +
   * uniform roughness yield a matte voxel surface with image-based fill.
   *
   * Reuses the identical per-vertex attributes (tileIndex, faceShade) and the same
   * atlas RawTexture, so chunk-mesh.ts is unchanged across flag states.
   */
  class PbrAtlasMaterialPlugin extends MaterialPluginBase {
    private _atlasTex: RawTexture;

    constructor(material: Material, atlasTex: RawTexture) {
      super(material, "PbrAtlasPlugin", 200, {}, true, true);
      this._atlasTex = atlasTex;
    }

    override getClassName(): string {
      return "PbrAtlasMaterialPlugin";
    }

    override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
      attributes.push("tileIndex");
      attributes.push("faceShade");
    }

    override getSamplers(samplers: string[]): void {
      samplers.push("atlasSampler");
    }

    override bindForSubMesh(
      _uniformBuffer: UniformBuffer,
      _scene: Scene,
      _engine: AbstractEngine,
      subMesh: SubMesh,
    ): void {
      const effect = subMesh.effect;
      if (effect === null) return;
      effect.setTexture("atlasSampler", this._atlasTex);
    }

    override isReadyForSubMesh(
      _defines: MaterialDefines,
      _scene: Scene,
      _engine: AbstractEngine,
      _subMesh: SubMesh,
    ): boolean {
      return true;
    }

    override getActiveTextures(activeTextures: BaseTexture[]): void {
      activeTextures.push(this._atlasTex);
    }

    override hasTexture(texture: BaseTexture): boolean {
      return texture === this._atlasTex;
    }

    override prepareDefinesBeforeAttributes(
      defines: MaterialDefines,
      _scene: Scene,
      _mesh: AbstractMesh,
    ): void {
      defines._needUVs = true;
    }

    override getCustomCode(
      shaderType: string,
    ): { [pointName: string]: string } | null {
      if (shaderType === "vertex") {
        return {
          CUSTOM_VERTEX_DEFINITIONS: `
attribute float tileIndex;
varying float vTileIndex;
varying vec2 vAtlasUV;
attribute float faceShade;
varying float vFaceShade;
`,
          CUSTOM_VERTEX_MAIN_END: `
vTileIndex = tileIndex;
vAtlasUV = uvUpdated;
vFaceShade = faceShade;
`,
        };
      }

      if (shaderType === "fragment") {
        return {
          CUSTOM_FRAGMENT_DEFINITIONS: `
varying float vTileIndex;
varying vec2 vAtlasUV;
uniform sampler2D atlasSampler;
varying float vFaceShade;
`,
          // PBR albedo injection: surfaceAlbedo is the vec3 the PBR pipeline uses
          // as the diffuse base before lighting/IBL. Same atlas/faceShade/contact-AO
          // math as the StandardMaterial path, written into surfaceAlbedo.
          CUSTOM_FRAGMENT_UPDATE_ALBEDO: `
{
  float _tileIdx = floor(vTileIndex + 0.5);
  float _col = mod(_tileIdx, 16.0);
  float _row = floor(_tileIdx / 16.0);
  vec2 _tileUV = clamp(fract(vAtlasUV), 0.02, 0.98);
  vec2 _atlasUV = (vec2(_col, _row) + _tileUV) / 16.0;
  vec4 _atlasSample = texture2D(atlasSampler, _atlasUV);
  surfaceAlbedo = _atlasSample.rgb;
  surfaceAlbedo *= vFaceShade;
  vec2 _g = fract(vAtlasUV);
  float _edge = min(min(_g.x, 1.0 - _g.x), min(_g.y, 1.0 - _g.y));
  float _contactAO = smoothstep(0.0, 0.08, _edge);
  float _aoFactor = mix(0.90, 1.0, _contactAO);
  float _isTop = step(0.999, vFaceShade);
  surfaceAlbedo *= mix(_aoFactor, 1.0, _isTop);
}
`,
        };
      }

      return null;
    }
  }
  ```
- [ ] **(CODE)** Add the private PBR factory and branch `createTerrainMaterials`. First, refactor the atlas-texture creation so BOTH paths share it. In `createTerrainMaterials` (L252), the existing body (after the `if (!USE_ATLAS)` legacy early-return at L253–267) builds `atlasTex` then the StandardMaterial pair. Insert the flag branch AFTER `atlasTex` is built (after L293 `atlasTex.name = "terrain-atlas";`) and BEFORE the opaque StandardMaterial block (L295):
  ```ts
    atlasTex.name = "terrain-atlas";

    // Phase 6d: when the flag is ON, build the PBR pair sharing this atlas.
    // When OFF (default), fall through to the unchanged StandardMaterial body.
    if (USE_PBR_TERRAIN) {
      return createPbrTerrainMaterials(scene, atlasTex);
    }

    // Opaque material: full backface culling.
    const opaque = new StandardMaterial("terrain-opaque", scene);
    // … (existing StandardMaterial body unchanged) …
  ```
  Then add the private factory below `createTerrainMaterials` (end of file):
  ```ts
  /**
   * Phase 6d PBR terrain pair. Builds two shared {@link PBRMaterial}s (opaque +
   * transparent) that reuse the SAME albedo atlas via {@link PbrAtlasMaterialPlugin}.
   * metallic 0 + uniform roughness = matte voxel surface; IBL (scene.environmentTexture,
   * wired in main.ts) provides image-based fill on top of sun + hemi + CSM.
   *
   * Mirrors the StandardMaterial pair's culling + transparent alpha so the visual
   * structure (both-sided water/glass/leaves) is preserved.
   */
  function createPbrTerrainMaterials(scene: Scene, atlasTex: RawTexture): TerrainMaterials {
    const opaque = new PBRMaterial("terrain-opaque-pbr", scene);
    opaque.metallic = 0;
    opaque.roughness = PBR_TERRAIN_ROUGHNESS;
    // Atlas already encodes base color; keep the albedo channel neutral white so
    // the plugin's surfaceAlbedo write is the sole hue source.
    opaque.albedoColor = new Color3(1, 1, 1);
    opaque.backFaceCulling = true;
    new PbrAtlasMaterialPlugin(opaque, atlasTex);

    const transparent = new PBRMaterial("terrain-transparent-pbr", scene);
    transparent.metallic = 0;
    transparent.roughness = PBR_TERRAIN_ROUGHNESS;
    transparent.albedoColor = new Color3(1, 1, 1);
    transparent.alpha = TRANSPARENT_ALPHA;
    transparent.transparencyMode = PBRMaterial.MATERIAL_ALPHABLEND;
    transparent.backFaceCulling = false;
    new PbrAtlasMaterialPlugin(transparent, atlasTex);

    return { opaque, transparent };
  }
  ```
  (`TRANSPARENT_ALPHA`, `Color3`, `RawTexture`, the type-only `Material`/`BaseTexture`/`UniformBuffer`/`SubMesh`/`AbstractEngine`/`MaterialDefines`/`AbstractMesh`/`Scene` imports already exist at the top of the file. Only `PBRMaterial` is newly imported in the prior step.)
- [ ] **(CODE, UNIT)** Append a flag-ON `describe` to `src/rendering/terrain-material.test.ts`. Since `USE_PBR_TERRAIN` is a compile-time const (can't be toggled at runtime), expose the PBR factory for testing by adding ONE export to `terrain-material.ts` — export `createPbrTerrainMaterials` (change `function createPbrTerrainMaterials` to `export function createPbrTerrainMaterials`) and a tiny atlas-builder reuse. To keep the test self-contained, the test builds its own atlas `RawTexture` the same way the factory does is unnecessary — instead, add the test against the EXPORTED factory by passing a `RawTexture`. Simplest: also export a test helper. Concretely:
  - In `terrain-material.ts`, add `export` to `createPbrTerrainMaterials` and add a small exported builder:
    ```ts
    /** Test/seam helper: build the shared atlas RawTexture (used by both paths). */
    export function buildAtlasTexture(scene: Scene): RawTexture {
      const atlasData = generateAtlasRGBA();
      const atlasTex = new RawTexture(
        atlasData, ATLAS_PX, ATLAS_PX, 5, scene, false, false,
        Texture.NEAREST_SAMPLINGMODE,
      );
      atlasTex.name = "terrain-atlas";
      return atlasTex;
    }
    ```
    Then refactor `createTerrainMaterials`'s inline atlas creation (L280–293) to call `buildAtlasTexture(scene)` so there is ONE definition (no duplication, no behavior change — same args).
  - In `terrain-material.test.ts`, append:
    ```ts
    import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
    import {
      createPbrTerrainMaterials,
      buildAtlasTexture,
      PBR_TERRAIN_ROUGHNESS,
    } from "./terrain-material";

    describe("PBR terrain path (Phase 6d, flag ON)", () => {
      it("builds a PBRMaterial pair without throwing under NullEngine", () => {
        const atlas = buildAtlasTexture(scene);
        let mats: ReturnType<typeof createPbrTerrainMaterials> | undefined;
        expect(() => {
          mats = createPbrTerrainMaterials(scene, atlas);
        }).not.toThrow();
        expect(mats?.opaque).toBeInstanceOf(PBRMaterial);
        expect(mats?.transparent).toBeInstanceOf(PBRMaterial);
      });

      it("opaque PBR material is non-metal with the uniform roughness", () => {
        const atlas = buildAtlasTexture(scene);
        const mats = createPbrTerrainMaterials(scene, atlas);
        const opaque = mats.opaque as PBRMaterial;
        expect(opaque.metallic).toBe(0);
        expect(opaque.roughness).toBe(PBR_TERRAIN_ROUGHNESS);
        expect(opaque.backFaceCulling).toBe(true);
      });

      it("transparent PBR material alpha-blends both sides", () => {
        const atlas = buildAtlasTexture(scene);
        const mats = createPbrTerrainMaterials(scene, atlas);
        const t = mats.transparent as PBRMaterial;
        expect(t.alpha).toBeLessThan(1);
        expect(t.backFaceCulling).toBe(false);
      });

      it("both PBR materials share ONE atlas texture", () => {
        const atlas = buildAtlasTexture(scene);
        const mats = createPbrTerrainMaterials(scene, atlas);
        const o = (mats.opaque as PBRMaterial).getActiveTextures();
        const tr = (mats.transparent as PBRMaterial).getActiveTextures();
        expect(o.some((x) => x.name === "terrain-atlas")).toBe(true);
        expect(tr.some((x) => x.name === "terrain-atlas")).toBe(true);
      });

      it("PBR plugin injects the atlas lookup at CUSTOM_FRAGMENT_UPDATE_ALBEDO", () => {
        const atlas = buildAtlasTexture(scene);
        const mats = createPbrTerrainMaterials(scene, atlas);
        const opaque = mats.opaque as PBRMaterial;
        const plugin = opaque.pluginManager?.getPlugin("PbrAtlasPlugin");
        expect(plugin).not.toBeNull();
        const frag = plugin?.getCustomCode("fragment") ?? null;
        expect(frag).not.toBeNull();
        expect(frag?.["CUSTOM_FRAGMENT_UPDATE_ALBEDO"]).toContain("surfaceAlbedo");
        expect(frag?.["CUSTOM_FRAGMENT_UPDATE_ALBEDO"]).toContain("atlasSampler");
        // It must NOT write baseColor (that is the StandardMaterial point).
        expect(frag?.["CUSTOM_FRAGMENT_UPDATE_ALBEDO"]).not.toContain("baseColor");
      });
    });
    ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/rendering/terrain-material.test.ts` → all green (existing atlas pins + Task 1 flag tests + the 5 new PBR-path tests; nothing throws under NullEngine).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors (override signatures match; `PBRMaterial.MATERIAL_ALPHABLEND` resolves; no unused locals).
- [ ] **(VERIFY, BUILD)** `corepack pnpm build` → succeeds (PBR module imported; OFF path still the boot default). Re-confirms the deep-import gotcha is handled — `PBRMaterial` resolves at bundle time.
- [ ] **Commit:** `feat(render): flag-gated PBR terrain material pair reusing the albedo atlas`

---

### Task 3: PURE procedural IBL cubemap generator (tests FIRST)

Create the Babylon-free `generateGradientCubeRGBA(size)` so the IBL source is deterministic and fully unit-testable, plus a guarded `createEnvironmentCubemap(scene)` that wraps the bytes in a `RawCubeTexture` and CANNOT black out boot. No scene wiring yet (Task 5).

**Files:**
- Create: `src/rendering/environment-cubemap.ts`
- Create: `src/rendering/environment-cubemap.test.ts`

**Must-protect:**
- `generateGradientCubeRGBA` is PURE: no `@babylonjs/*` import, no RNG, no wall-clock. Deterministic across runs (hash + smoothstep), so its test asserts byte equality across two calls.
- `createEnvironmentCubemap` is wrapped in try/catch and returns `null` on any failure — NullEngine or a low-end GPU that cannot register a `RawCubeTexture` degrades to no-IBL, never a thrown boot error.
- Output length is exactly `6 * size * size * 4` (RGBA, 6 faces) and every channel is an integer in `[0, 255]`.
- No side effects on import (safe to import in tests), mirroring `atlas.ts` / `particle-textures.ts`.
- DEEP-IMPORT GOTCHA: import `RawCubeTexture` from `@babylonjs/core/Materials/Textures/rawCubeTexture` (verified on disk) — NOT the barrel.

Steps:

- [ ] **(CODE, UNIT)** Create `src/rendering/environment-cubemap.ts`:
  ```ts
  /**
   * environment-cubemap.ts — procedural IBL environment for the PBR terrain path
   * (Phase 6d, flag-gated). PURE generation (generateGradientCubeRGBA) + a guarded
   * Babylon wrapper (createEnvironmentCubemap) that degrades to null on failure.
   *
   * Faces (Babylon cube order +X,-X,+Y,-Y,+Z,-Z): a warm golden-hour gradient —
   * +X warm amber, -X cool blue, +Y bright sky, -Y dark warm floor, ±Z blend —
   * so IBL adds soft sky fill on shadowed faces + a faint warm sheen up top,
   * complementing the sun/hemi/CSM lighting rather than replacing it.
   *
   * No randomness, no wall-clock, no Babylon import in the pure path.
   */

  import type { Scene } from "@babylonjs/core/scene";
  import type { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
  import { RawCubeTexture } from "@babylonjs/core/Materials/Textures/rawCubeTexture";

  /** Smoothstep (Hermite) — deterministic, no RNG. */
  function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  /** Clamp a float color channel to an integer byte [0,255]. */
  function toByte(v: number): number {
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  }

  /** Per-face base colors (linear-ish), warm golden-hour intent. */
  const FACE_TOP: [number, number, number] = [0.55, 0.62, 0.78]; // +Y bright cool sky
  const FACE_BOTTOM: [number, number, number] = [0.10, 0.08, 0.06]; // -Y dark warm floor
  const FACE_WARM: [number, number, number] = [0.62, 0.48, 0.30]; // +X amber
  const FACE_COOL: [number, number, number] = [0.30, 0.38, 0.52]; // -X cool blue
  const FACE_MID: [number, number, number] = [0.44, 0.44, 0.42]; // ±Z neutral blend

  /** The 6 face base colors in Babylon cube order: +X,-X,+Y,-Y,+Z,-Z. */
  const FACE_COLORS: ReadonlyArray<[number, number, number]> = [
    FACE_WARM, FACE_COOL, FACE_TOP, FACE_BOTTOM, FACE_MID, FACE_MID,
  ];

  /**
   * Generate a 6-face RGBA cubemap as a single Uint8Array of length
   * 6*size*size*4. Each face is a vertical gradient from its base color toward
   * the sky/floor tint, giving a soft horizon — deterministic, range [0,255].
   */
  export function generateGradientCubeRGBA(size: number): Uint8Array {
    const faceBytes = size * size * 4;
    const out = new Uint8Array(6 * faceBytes);
    for (let face = 0; face < 6; face++) {
      const [br, bg, bb] = FACE_COLORS[face] ?? FACE_MID;
      const base = face * faceBytes;
      for (let y = 0; y < size; y++) {
        // v=0 at top of face, v=1 at bottom: lighten toward sky at top.
        const v = size <= 1 ? 0 : y / (size - 1);
        const lift = smoothstep(1, 0, v) * 0.18; // brighter near the top
        for (let x = 0; x < size; x++) {
          const o = base + (y * size + x) * 4;
          out[o] = toByte(br + lift);
          out[o + 1] = toByte(bg + lift);
          out[o + 2] = toByte(bb + lift);
          out[o + 3] = 255;
        }
      }
    }
    return out;
  }

  /** Default procedural cubemap face size (small — IBL needs no detail). */
  export const ENV_CUBE_SIZE = 32;

  /**
   * Build a Babylon {@link CubeTexture} from the procedural gradient. GUARDED:
   * returns null on any failure (NullEngine / low-end GPU) so IBL is purely
   * additive eye-candy that can never black out boot. Name: "environment-gradient".
   */
  export function createEnvironmentCubemap(scene: Scene): CubeTexture | null {
    try {
      const size = ENV_CUBE_SIZE;
      const all = generateGradientCubeRGBA(size);
      const faceBytes = size * size * 4;
      // RawCubeTexture wants one Uint8Array per face.
      const faces: ArrayBufferView[] = [];
      for (let f = 0; f < 6; f++) {
        faces.push(all.subarray(f * faceBytes, (f + 1) * faceBytes));
      }
      // TEXTUREFORMAT_RGBA = 5, TEXTURETYPE_UNSIGNED_BYTE = 0.
      const tex = new RawCubeTexture(scene, faces, size, 5, 0);
      tex.name = "environment-gradient";
      return tex as unknown as CubeTexture;
    } catch (err) {
      console.warn("[ibl] environment cubemap construction failed — running without IBL.", err);
      return null;
    }
  }
  ```
  (NOTE: `RawCubeTexture extends CubeTexture` in Babylon, but to keep the public return type stable across versions we cast to `CubeTexture`. If `RawCubeTexture`'s constructor arity differs in the installed v8, fall back to the documented 5-arg form `new RawCubeTexture(scene, faces, size)` and set format/type via properties — verify against `node_modules/@babylonjs/core/Materials/Textures/rawCubeTexture.d.ts` before adjusting; the try/catch makes a wrong arity a graceful null rather than a crash.)
- [ ] **(CODE, UNIT)** Create `src/rendering/environment-cubemap.test.ts`:
  ```ts
  import { describe, it, expect, beforeAll, afterAll } from "vitest";
  import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
  import { Scene } from "@babylonjs/core/scene";
  import {
    generateGradientCubeRGBA,
    createEnvironmentCubemap,
    ENV_CUBE_SIZE,
  } from "./environment-cubemap";

  describe("generateGradientCubeRGBA (pure)", () => {
    it("returns 6 RGBA faces of the requested size", () => {
      const size = 16;
      const data = generateGradientCubeRGBA(size);
      expect(data.length).toBe(6 * size * size * 4);
    });

    it("is deterministic (two calls byte-identical)", () => {
      const a = generateGradientCubeRGBA(8);
      const b = generateGradientCubeRGBA(8);
      expect(Array.from(a)).toEqual(Array.from(b));
    });

    it("every channel is an integer in [0,255] and alpha is 255", () => {
      const data = generateGradientCubeRGBA(8);
      for (let i = 0; i < data.length; i++) {
        const v = data[i] ?? -1;
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
      // Alpha (every 4th byte) is fully opaque.
      for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
    });

    it("ENV_CUBE_SIZE is a small power-of-two-ish face size", () => {
      expect(ENV_CUBE_SIZE).toBeGreaterThan(0);
      expect(ENV_CUBE_SIZE).toBeLessThanOrEqual(64);
    });
  });

  describe("createEnvironmentCubemap (guarded, NullEngine)", () => {
    let engine: NullEngine;
    let scene: Scene;
    beforeAll(() => {
      engine = new NullEngine();
      scene = new Scene(engine);
    });
    afterAll(() => {
      scene.dispose();
      engine.dispose();
    });

    it("does not throw under NullEngine (returns a texture or null)", () => {
      let tex: ReturnType<typeof createEnvironmentCubemap> | undefined;
      expect(() => {
        tex = createEnvironmentCubemap(scene);
      }).not.toThrow();
      // Either a named texture or a graceful null — both are acceptable headless.
      if (tex !== null && tex !== undefined) {
        expect(tex.name).toBe("environment-gradient");
      }
    });
  });
  ```
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/rendering/environment-cubemap.test.ts` → all green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **(VERIFY, BUILD)** `corepack pnpm build` → succeeds (module imported by nothing in the boot path yet, but compiles clean).
- [ ] **Commit:** `feat(render): procedural IBL gradient cubemap (pure gen + guarded wrapper)`

---

### Task 4: Persist `pbrIntensity` preference (tests FIRST)

Add a persisted `pbrIntensity: number` (0..1, default 0.5) to `Prefs`, following the exact pattern of every other pref (`Prefs` field, `DEFAULT_PREFS`, `clampPrefs`, `parsePrefs`). This scales the IBL `environmentIntensity` in Task 5 and is harmless/ignored when the flag is OFF.

**Files:**
- Modify: `src/game/preferences.ts` (`Prefs` L24; `DEFAULT_PREFS` L52; `clampPrefs` L88; `parsePrefs` L157)
- Modify: `src/game/preferences.test.ts` (append)

**Must-protect:**
- `pbrIntensity` is a NUMBER pref clamped to `[0, 1]`, defaulting to 0.5, using the existing `clampField` + `numOrDefault` helpers — no new validation machinery.
- It is ALWAYS present in `Prefs` / `DEFAULT_PREFS` (not optional) — `exactOptionalPropertyTypes` discipline: every persisted field is a concrete value, never `undefined`.
- Backward-compat: an old prefs blob without `pbrIntensity` decodes to the 0.5 default via `numOrDefault` (the existing tolerant-parse pattern); no migration, no `SAVE_VERSION` (prefs are a separate JSON blob, not the world save).
- All existing `preferences.test.ts` assertions stay green — adding a field does not break a field-by-field default test unless it `toEqual`s the whole `DEFAULT_PREFS`; check first and, if it does, the default object literal in the test updates intentionally to include `pbrIntensity: 0.5`.

Steps:

- [ ] **(CODE)** Add the field to `Prefs` in `src/game/preferences.ts`, after `toneMappingMode` (L46):
  ```ts
    /** Tone-mapping / color grade (Phase 6c). Persisted; live-applied to post-FX. */
    toneMappingMode: ToneMappingMode;
    /**
     * IBL environment-light intensity for the PBR terrain path (Phase 6d), 0..1.
     * Scales scene.environmentIntensity (× day/night sun curve). Ignored when
     * USE_PBR_TERRAIN is off (the scene has no environment texture then).
     */
    pbrIntensity: number;
    /** UI scale multiplier (0.5..2.0). */
    uiScale: number;
  ```
- [ ] **(CODE)** Add the default to `DEFAULT_PREFS`, after `toneMappingMode` (L63):
  ```ts
    toneMappingMode: "goldenHour",
    pbrIntensity: 0.5,
    uiScale: 1.0,
  ```
- [ ] **(CODE)** Clamp it in `clampPrefs`, after the `toneMappingMode` line (L101–103):
  ```ts
    toneMappingMode: VALID_TONE_MAPPING_MODES.includes(p.toneMappingMode)
      ? p.toneMappingMode
      : DEFAULT_PREFS.toneMappingMode,
    pbrIntensity: clampField(p.pbrIntensity, 0, 1, DEFAULT_PREFS.pbrIntensity),
    uiScale: clampField(p.uiScale, 0.5, 2.0, DEFAULT_PREFS.uiScale),
  ```
- [ ] **(CODE)** Parse it tolerantly in `parsePrefs`, after the `toneMappingMode` field in the returned object (L168–169):
  ```ts
    colorblindMode,
    toneMappingMode,
    pbrIntensity: numOrDefault("pbrIntensity", DEFAULT_PREFS.pbrIntensity),
    uiScale: numOrDefault("uiScale", DEFAULT_PREFS.uiScale),
  ```
- [ ] **(CODE, UNIT)** Append a `describe` to `src/game/preferences.test.ts`:
  ```ts
  describe("pbrIntensity preference (Phase 6d)", () => {
    it("defaults to 0.5", () => {
      expect(DEFAULT_PREFS.pbrIntensity).toBe(0.5);
    });

    it("clamps out-of-range values to [0,1]", () => {
      expect(clampPrefs({ ...DEFAULT_PREFS, pbrIntensity: 5 }).pbrIntensity).toBe(1);
      expect(clampPrefs({ ...DEFAULT_PREFS, pbrIntensity: -2 }).pbrIntensity).toBe(0);
      expect(clampPrefs({ ...DEFAULT_PREFS, pbrIntensity: Number.NaN }).pbrIntensity).toBe(0.5);
    });

    it("round-trips through serialize/parse", () => {
      const p = clampPrefs({ ...DEFAULT_PREFS, pbrIntensity: 0.3 });
      const round = parsePrefs(serializePrefs(p));
      expect(round.pbrIntensity).toBeCloseTo(0.3, 10);
    });

    it("defaults a missing field from an old prefs blob", () => {
      const oldBlob = new TextEncoder().encode(JSON.stringify({ fov: 90 }));
      expect(parsePrefs(oldBlob).pbrIntensity).toBe(0.5);
    });
  });
  ```
  (`DEFAULT_PREFS`, `clampPrefs`, `parsePrefs`, `serializePrefs` are already imported at the top of `preferences.test.ts`; if `serializePrefs` is not yet imported there, add it. If an existing test `toEqual`s the whole `DEFAULT_PREFS`, update that one literal to include `pbrIntensity: 0.5` — note it as an intentional pin update.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/game/preferences.test.ts` → all green.
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors.
- [ ] **Commit:** `feat(prefs): persist pbrIntensity (0..1, default 0.5) for IBL scaling`

---

### Task 5: Wire IBL into `applySky` (optional `env` arg) (tests FIRST)

Give `applySky` an OPTIONAL third arg so the day/night driver can set `scene.environmentTexture` + `scene.environmentIntensity` when (and only when) IBL is active. When the arg is omitted — the default OFF path and EVERY existing test caller — the function body is byte-identical, so `daynight.test.ts` and `sky.test.ts` stay green untouched.

**Files:**
- Modify: `src/game/daynight.ts` (`applySky` signature + an additive block; `sunLightIntensityAt` already imported)
- Modify: `src/game/daynight.test.ts` (append; existing pins untouched)

**Must-protect:**
- `applySky(targets, clock)` with two args is byte-identical to today — the env block is skipped when `env === undefined`. The existing `daynight.test.ts` clearColor/sun/hemi assertions and `sky.test.ts` keyframe assertions do not pass an `env` and MUST stay green with zero edits.
- `env` is `{ texture: BaseTexture; intensity: number }` — a CONCRETE object when present (never partial). The caller (Task 6) is responsible for only passing it when IBL is active; `applySky` itself never reads the `USE_PBR_TERRAIN` flag (keeps the module pure of the render flag).
- `scene.environmentIntensity` is clamped to `[0, 1]` inside `applySky` (Babylon treats it as a 0..1 multiplier; out-of-range from a future caller must not blow out).
- The intensity the caller computes is `sunLightIntensityAt(tod) * prefs.pbrIntensity`, so IBL dims to ~0 at night — but `applySky` only APPLIES the value it is handed; the day/night scaling is computed by the caller using the already-imported `sunLightIntensityAt`. (Alternative: compute it inside `applySky` from the `intensity` it already derives; the plan computes it in the caller to keep `applySky`'s contract "apply what you're told" and avoid threading `pbrIntensity` into this pure module.)
- No change to `clearColor`/`fogColor`/`sun.direction`/`sun.intensity`/`hemi.intensity` math.

Steps:

- [ ] **(CODE)** Update `applySky` in `src/game/daynight.ts`. Add the `BaseTexture` type import near the other type imports (L15–18):
  ```ts
  import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
  ```
  Change the signature + add the additive block at the END of the function body (after the `hemi.intensity` assignment, L78–80):
  ```ts
  export function applySky(
    targets: SkyTargets,
    clock: Clock,
    env?: { texture: BaseTexture; intensity: number },
  ): void {
    // … existing body UNCHANGED (clearColor, fog, sun, hemi) …

    // Phase 6d (flag-gated, additive): when IBL is active the caller passes an
    // env texture + a day/night-scaled intensity. Omitted on the default path,
    // so the OFF look is byte-identical. environmentIntensity is a 0..1 multiplier.
    if (env !== undefined) {
      targets.scene.environmentTexture = env.texture;
      targets.scene.environmentIntensity = Math.max(0, Math.min(1, env.intensity));
    }
  }
  ```
- [ ] **(CODE, UNIT)** Append a `describe` to `src/game/daynight.test.ts`. It needs a NullEngine scene + the two lights to build `SkyTargets`; model the harness on the file's existing `applySky` tests (they already construct a scene + `DirectionalLight` + `HemisphericLight`). Add:
  ```ts
  describe("applySky — IBL env wiring (Phase 6d)", () => {
    it("sets environmentTexture + clamped environmentIntensity when env is passed", () => {
      const { targets, clock } = makeSkyHarness(); // existing helper or inline build
      const fakeTex = {} as unknown as import("@babylonjs/core/Materials/Textures/baseTexture").BaseTexture;
      applySky(targets, clock, { texture: fakeTex, intensity: 0.4 });
      expect(targets.scene.environmentTexture).toBe(fakeTex);
      expect(targets.scene.environmentIntensity).toBeCloseTo(0.4, 10);
    });

    it("clamps an out-of-range env intensity into [0,1]", () => {
      const { targets, clock } = makeSkyHarness();
      const fakeTex = {} as unknown as import("@babylonjs/core/Materials/Textures/baseTexture").BaseTexture;
      applySky(targets, clock, { texture: fakeTex, intensity: 9 });
      expect(targets.scene.environmentIntensity).toBe(1);
    });

    it("leaves environmentTexture null when env is omitted (default path)", () => {
      const { targets, clock } = makeSkyHarness();
      applySky(targets, clock); // no env arg
      expect(targets.scene.environmentTexture).toBeNull();
    });
  });
  ```
  (If `daynight.test.ts` has no reusable `makeSkyHarness`, construct the targets inline exactly as the nearest existing `applySky` test does: `new NullEngine()` → `new Scene(engine)` → `new DirectionalLight(...)` + `new HemisphericLight(...)` → `{ scene, sun, hemi }`, and a `makeClock(10000)`. A fresh `Scene`'s `environmentTexture` is `null` by default, which the third test relies on.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run src/game/daynight.test.ts src/time/sky.test.ts` → all green (existing keyframe/clearColor/sun/hemi pins untouched; 3 new IBL tests pass).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors (optional arg is concrete when present).
- [ ] **Commit:** `feat(render): applySky optional env arg wires scene IBL (flag-gated, additive)`

---

### Task 6: Boot wiring — construct the env cubemap and thread it through `applySky` behind the flag

Construct the procedural env cubemap ONCE at boot, but ONLY when `USE_PBR_TERRAIN` is true, and pass it (with a day/night-scaled intensity) into the per-frame `applySky` call. When the flag is OFF, `envTexture` stays `null`, no `env` arg is passed, and boot + every frame is byte-identical to today. This is glue in `main.ts` (not imported by the test suite — it throws at the HTMLCanvas guard), so verification is build + the live-QA gate.

**Files:**
- Modify: `src/main.ts` (import the env helper + `USE_PBR_TERRAIN` + prefs accessor; construct `envTexture` behind the flag after `createTerrainMaterials`; pass `env` into the L1255 `applySky` call)

**Must-protect:**
- The env texture is constructed ONLY inside `if (USE_PBR_TERRAIN)`. When OFF, `scene.environmentTexture` is never set — the OFF path has NO IBL, guaranteeing byte-identity.
- `createEnvironmentCubemap` is already try/catch-guarded (Task 3) AND the whole boot block is the deep-import-gotcha danger zone — keep the construction inside the flag guard so a worst-case throw on a GPU that can't make a `RawCubeTexture` cannot affect the default OFF boot. After this task, RE-VERIFY boot: `corepack pnpm build` and (live-QA) launch with the flag OFF to confirm no regression, then flip ON locally to confirm it still boots (no black screen).
- The per-frame `applySky` call passes `env` ONLY when `envTexture !== null`. The intensity is `sunLightIntensityAt(tickOfDay(clock)) * prefs.pbrIntensity` — but `sunLightIntensityAt`/`tickOfDay` are pure imports; `prefs` is the live `Prefs` object `applyPrefs` already manages. Read `prefs.pbrIntensity` (the field added in Task 4). Compute the intensity in `main.ts` so `applySky` stays "apply what you're told".
- Do NOT change the OFF-path `applySky({ scene, sun: sunLight, hemi: hemiLight }, clock)` call shape when `envTexture` is null — branch so the two-arg call is used unchanged when there is no IBL.
- `USE_PBR_TERRAIN` must be imported from `./rendering/terrain-material` (the re-export through `world-renderer` only forwards `createTerrainMaterials`; import the flag from its source). `prefs` is the variable `applyPrefs` reads — confirm its in-scope name when wiring (it is the module-level live prefs object).

Steps:

- [ ] **(CODE)** Add imports to `src/main.ts` (with the other rendering imports near L33 / L92):
  ```ts
  import { USE_PBR_TERRAIN } from "./rendering/terrain-material";
  import { createEnvironmentCubemap } from "./rendering/environment-cubemap";
  import { sunLightIntensityAt } from "./time/sky";
  ```
  (`tickOfDay` is already imported at L49; `skyColorAt` is imported at L51 — `sunLightIntensityAt` is from the same `./time/sky` module, add it. If `./time/sky` is already imported on one line, extend that line instead of adding a new import.)
- [ ] **(CODE)** Construct the env cubemap behind the flag, right after `const materials = createTerrainMaterials(scene);` (L211):
  ```ts
  const materials = createTerrainMaterials(scene);

  // Phase 6d (flag-gated, default OFF): when PBR terrain is on, build the
  // procedural IBL cubemap ONCE. Guarded + flag-scoped so the default path never
  // touches scene.environmentTexture and a GPU failure degrades to no-IBL.
  const envTexture = USE_PBR_TERRAIN ? createEnvironmentCubemap(scene) : null;
  ```
- [ ] **(CODE)** Thread it into the per-frame `applySky` call (L1255). Replace:
  ```ts
    // Drive the sky / sun / fog from the clock's time-of-day.
    applySky({ scene, sun: sunLight, hemi: hemiLight }, clock);
  ```
  with:
  ```ts
    // Drive the sky / sun / fog from the clock's time-of-day. When IBL is active
    // (flag ON + cubemap built), also feed a day/night-scaled environment
    // intensity so IBL dims at night and never blows out at noon.
    if (envTexture !== null) {
      const iblIntensity = sunLightIntensityAt(tickOfDay(clock)) * prefs.pbrIntensity;
      applySky(
        { scene, sun: sunLight, hemi: hemiLight },
        clock,
        { texture: envTexture, intensity: iblIntensity },
      );
    } else {
      applySky({ scene, sun: sunLight, hemi: hemiLight }, clock);
    }
  ```
  (Confirm the live prefs object is named `prefs` in this scope; if `applyPrefs` stores it under a different identifier, use that. `prefs.pbrIntensity` is guaranteed present by Task 4's `DEFAULT_PREFS`.)
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run` → FULL suite green (no test imports `main.ts`; this confirms nothing else regressed and the flag-OFF default leaves all rendering tests byte-identical).
- [ ] **(VERIFY, UNIT)** `corepack pnpm typecheck` → no errors (no unused import — `envTexture`, `sunLightIntensityAt`, `USE_PBR_TERRAIN` all used; `prefs.pbrIntensity` typed).
- [ ] **(VERIFY, BUILD)** `corepack pnpm build` → succeeds. This is the boot-bundle gate for the deep-import gotcha: the PBR + cubemap modules must resolve and the OFF default must compile clean.
- [ ] **(LIVE-QA, boot only)** Launch with the flag OFF (default) → boots into the unchanged golden-hour scene (no black screen, no console error). Flip `USE_PBR_TERRAIN = true` locally, rebuild, launch → boots without a black screen (IBL may look untuned — that's Task 7). Revert the flag to `false` before committing. Manual.
- [ ] **Commit:** `feat(render): wire flag-gated procedural IBL into the boot + per-frame sky`

---

### Task 7: Live-QA gate (REAL GPU ONLY — ships no code, asserts nothing in CI)

Everything above is unit-green and build-green with the flag OFF. The actual VISUAL QUALITY of the ON path — and byte-identity of the OFF path — is GPU-only and a human must verify it on a real GPU. This task documents that checklist. It changes NO code. The flag stays `false` in the repo; a reviewer flips it locally to evaluate, and the decision to ever ship it ON (or keep it as a default-OFF capability) is recorded here.

**Files:**
- Modify: `DESIGN.md` (doc-only: record the flag, the procedural-IBL default, and the open tuning knobs)

**Must-protect:**
- The repo default stays `USE_PBR_TERRAIN = false`. Do NOT flip it in a commit. Live-QA flips locally only.
- `DESIGN.md` golden-hour spec values are NOT changed — only ADD a "PBR+IBL terrain (flag-gated, default OFF)" subsection documenting the capability + that the OFF path remains the design-locked look.
- No `TONE_MODES` change, no `SAVE_VERSION` change — re-state that PBR+IBL is rendering-only.

Steps:

- [ ] **(CODE, DOC)** Add a "PBR + IBL terrain (Phase 6d, flag-gated, default OFF)" subsection to `DESIGN.md` near the existing rendering/golden-hour spec. Document: the `USE_PBR_TERRAIN` flag (default off), that OFF is byte-identical to the shipped golden-hour StandardMaterial look, that ON swaps to a `PBRMaterial` pair (metallic 0, uniform roughness `PBR_TERRAIN_ROUGHNESS = 0.78`) reusing the albedo atlas, and that IBL is a PROCEDURAL gradient cubemap scaled by `pbrIntensity` (default 0.5) × the day/night sun curve. State the open knobs: uniform-vs-per-type roughness, procedural-vs-CC0-HDRI, and the `environmentIntensity` ceiling.
- [ ] **(LIVE-QA) OFF-path byte-identity (the design-lock).** With the repo default (`USE_PBR_TERRAIN = false`), launch and screenshot at spawn (TOD 10000 golden hour). Compare to the shipped golden-hour reference: warm 5200K sun, cool hemi fill, warm ambient floor, per-face `faceShade` brightness (top 1.0 / bottom 0.5 / Z 0.8 / X 0.6), gentle contact-AO (≤10%, skipped on top), sharp 2-cascade CSM shadows, ACES `goldenHour` grade. Expect a PIXEL-IDENTICAL match (no environment texture in the scene — verify `scene.environmentTexture === null` via the test-api `renderDiag`/console).
- [ ] **(LIVE-QA) ON-path aesthetics.** Flip `USE_PBR_TERRAIN = true` locally, rebuild, launch at TOD 10000. Verify: stone reads MATTE (not metallic/shiny), grass is matte (not plastic), wood keeps warmth, water/glass get only a SUBTLE sheen. The atlas colors + `faceShade` per-face brightness + contact-AO still read (the PBR plugin re-applies them into `surfaceAlbedo`). If stone looks shiny, RAISE `PBR_TERRAIN_ROUGHNESS` toward 0.85–0.9; if flat/dead, LOWER toward 0.7. Re-screenshot.
- [ ] **(LIVE-QA) IBL augmentation + day/night.** With the flag ON, confirm IBL ADDS soft sky-tinted fill on shadowed faces + a faint warm sheen up top WITHOUT replacing the sun/hemi (sun still dominant, hemi still fills). Sweep TOD via the test-api `setTime(tod)`: noon (6000) must NOT blow out, dusk must not go flat, midnight (18000) must go dark (env intensity → ~0 because `sunLightIntensityAt` → ~0). If noon blows out, LOWER `pbrIntensity` default below 0.5 or cap the per-frame intensity; record the chosen ceiling.
- [ ] **(LIVE-QA) CSM + tone interaction.** With the flag ON, confirm CSM shadows stay crisp and acne-free under PBR across the TOD sweep (no normal map is added in v1, so acne risk is low — verify anyway). Toggle the Phase-6c tone modes (`goldenHour` ↔ `neutral`) and confirm the ACES + grade pass still controls the final composite over PBR output (no color banding, grade still applies).
- [ ] **(LIVE-QA) Other materials under IBL.** With the flag ON, `scene.environmentTexture` is GLOBAL — confirm mobs/arrows/splash (their own StandardMaterials) do not look wrong under the added IBL. If they do, the follow-up is to set their materials' `environmentIntensity` opt-out; note any finding (out of scope to fix in 6d unless egregious).
- [ ] **(DECISION)** Record the verdict in `DESIGN.md` / the PR: keep PBR+IBL as a default-OFF capability (ship the flag, default false), or gate further. Revert `USE_PBR_TERRAIN` to `false` before the final commit.
- [ ] **(VERIFY, UNIT)** `corepack pnpm vitest run` → FULL suite green with the flag OFF (the committed state).
- [ ] **(VERIFY, BUILD)** `corepack pnpm build` → succeeds.
- [ ] **Commit:** `docs(design): record flag-gated PBR+IBL terrain capability + live-QA verdict`

---

## Self-review (spec coverage, placeholders, type/flag consistency)

- **Spec coverage (6d scope items):** (1) `USE_PBR_TERRAIN` flag default false, OFF byte-identical — Task 1 (declare + prove OFF returns StandardMaterial) + every later task gated. (2) PBR material path reusing albedo atlas + tile sampling, metallic 0 + uniform roughness — Task 2 (`PbrAtlasMaterialPlugin` at `CUSTOM_FRAGMENT_UPDATE_ALBEDO` + `createPbrTerrainMaterials`). (3) Flag-gated PROCEDURAL IBL into `scene.environmentTexture`/`environmentIntensity`, reconciled with sun/hemi + CSM + Phase-6c ACES — Tasks 3 (pure cubemap) + 4 (`pbrIntensity` pref) + 5 (`applySky` env arg, clamped) + 6 (boot wiring, day/night-scaled) + 7 (live-QA reconciliation). All three covered.
- **Flag-gating discipline:** Task 1 introduces the flag default-OFF and proves the default path is StandardMaterial. Tasks 2–6 each carry an explicit Must-protect that the OFF path is byte-identical (PBR factory unreachable when OFF; env texture constructed only inside `if (USE_PBR_TERRAIN)`; `applySky` env block skipped when arg omitted). Task 7 re-verifies OFF byte-identity on a real GPU. Consistent.
- **Verifiability honesty:** the "Verifiability honesty" preamble + Task 7 clearly separate NullEngine-unit-testable (flag default, class identity, MR params, ALBEDO injection string, pure cubemap, env-arg wiring, pref clamp) from REAL-GPU live-QA (OFF pixel-identity, ON look, IBL augmentation, CSM/tone interaction). No visual-quality claim is dressed up as a unit test.
- **Type/signature/flag consistency vs verified source:** `createTerrainMaterials(scene): TerrainMaterials` signature preserved (no ABI change between flag states). `getCustomCode(shaderType: string)` matches the real `AtlasMaterialPlugin` override (NOT a `'vertex'|'fragment'` union — corrected from recon). PBR injection target is `surfaceAlbedo` at `CUSTOM_FRAGMENT_UPDATE_ALBEDO` (verified present), NOT `baseColor`. `applySky` currently takes `(targets, clock)` (verified daynight.ts L51) → adding an OPTIONAL 3rd arg keeps all existing callers byte-identical. `Prefs` already has `ToneMappingMode` machinery; `pbrIntensity` follows the `clampField`/`numOrDefault` pattern. `SAVE_VERSION` is 8 (verified migration.ts L14) and untouched. Babylon deep-import paths (`Materials/PBR/pbrMaterial`, `Materials/Textures/rawCubeTexture`, `Materials/Textures/cubeTexture`, `Materials/Textures/baseTexture`) all verified on disk. `exactOptionalPropertyTypes`: `metallic`/`roughness`/`pbrIntensity` set to concrete numbers; the optional `env` arg is a concrete object when present.
- **Deep-import gotcha:** called out in Architecture + Tasks 2/3/6 Must-protect; `PBRMaterial` self-registers via `RegisterClass`; IBL/eye-candy wrapped in try/catch; OFF path is the boot default so a registration throw cannot black out boot; `corepack pnpm build` re-verified after Tasks 2/3/6 and a boot live-QA in Task 6.
- **Placeholder scan:** no `TODO`/`TBD`/`XXX`/`<...>`/`FIXME` left. Every step has concrete file paths, real test code, real impl code, exact `corepack pnpm vitest run <path>` + `typecheck` + `build` verify commands, a commit, and Must-protect notes.
- **Ordering / green-at-every-step:** Task 1 (flag, suite green) → Task 2 (PBR material, suite green, OFF default unchanged) → Task 3 (pure cubemap, isolated) → Task 4 (pref, isolated) → Task 5 (`applySky` arg, existing pins green) → Task 6 (boot glue, full suite + build green) → Task 7 (live-QA + docs, suite + build green). Each task leaves the suite green, the build passing, and the default look unchanged.
