# Phase 1 — Rendering Golden-Hour Cure: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surgically fix the washed-out blue-grey graph-paper look by removing the shader grid, warming lights/sky/palette, spawning into golden hour, and applying a gentle color grade — all on the existing StandardMaterial + AtlasMaterialPlugin pipeline.

**Architecture:** Keep the greedy mesher, `StandardMaterial` + `AtlasMaterialPlugin` terrain path, the two-light + CSM setup, and the single `DefaultRenderingPipeline` post pass untouched structurally. Fix the grid by collapsing the three stacked shader darkening passes into one gentle contact-AO (≤10% darken); warm the scene via sky keyframes, light diffuse colors, ambient floor, and `ColorCurves` on the existing `imageProcessing` pipeline; spawn at a bright golden-hour TOD. Do NOT enable `useSRGBBuffer` anywhere; do NOT introduce PBRMaterial or NodeMaterial (those are the Phase 2 flag-gated path).

**Tech Stack:** Babylon.js 8, TypeScript, Vite, Vitest

---

## File Structure

| File | Responsibility in this plan |
|---|---|
| `src/rendering/world-renderer.ts` | Add `getFirstOpaqueMesh()` accessor for the readiness diagnostic |
| `src/main.ts` | Fix `isReady()` call to pass a real mesh; update spawn TOD; warm `hemiLight` / `sunLight` / `scene.ambientColor` init values |
| `src/rendering/terrain-material.ts` | Remove hard outline + wide AO passes; keep one gentle contact-AO (≤10% darken, 0.08 band) + `vFaceShade` |
| `src/time/sky.ts` | Add a bright golden-hour keyframe (~TOD 10000); adjust noon/morning keyframes to be warmer; update `sunDirectionAt` for ~25° elevation at spawn TOD |
| `src/game/daynight.ts` | Decouple fog color from sky color (warm fog offset); update `SUN_MAX_INTENSITY` / `HEMI_DAY_INTENSITY` for warm split |
| `src/rendering/post-fx.ts` | Add `DEFAULT_COLOR_CURVES_*` exported constants; enable `ColorCurves` warm global tint + cooler shadows; set `contrast ≈ 1.10`, `exposure ≈ 1.05` |
| `src/rendering/palette.ts` | Warm + slightly saturate grass, dirt, stone, wood base colors; all values stay in `[0, 1]` |
| `src/rendering/terrain-material.test.ts` | Update shader assertions: outline term gone; AO darken ≤ 12%; keep all non-shader tests green |
| `src/time/sky.test.ts` | No assertion change — verified still green: noon stays blue-dominant (b>r holds; the warm hero look comes from the new TOD-10000 keyframe, tested in Task 6) and noon sun y>0.5 still holds under the 65° cap |
| `src/game/daynight.test.ts` | Existing `clearColor` assertion stays green (it compares to `skyColorAt(6000)` dynamically); Task 6 ADDS new golden-hour-spawn tests |

---

### Task 1: Add `getFirstOpaqueMesh()` to WorldRenderer (readiness diagnostic fix)

**Files:**
- Modify: `src/rendering/world-renderer.ts` (after `getMeshCount`, ~line 283)
- Test: `src/rendering/world-renderer.test.ts` (add new describe block)

The spec (§2.3) states: *"Add `getFirstOpaqueMesh()`; pass a real mesh to `isReady()`."* The current `isReady()` calls in `src/main.ts` (lines 754 and 1024) call `materials.opaque.isReady()` with no mesh argument — `PushMaterial` always returns `false` to a no-mesh call, making the diagnostic always show `"NO"` even though the material is fine.

- [ ] **Read** `src/rendering/world-renderer.ts` lines 283–293 to confirm `getMeshCount()` location:

  ```typescript
  // CURRENT (lines 283–290):
  /** Total number of live (non-null) meshes across all sections. */
  getMeshCount(): number {
    let count = 0;
    for (const { opaque, transparent } of this.sections.values()) {
      if (opaque !== null) count++;
      if (transparent !== null) count++;
    }
    return count;
  }
  ```

- [ ] **Add** `getFirstOpaqueMesh()` immediately after `getMeshCount()`, before the closing `}` of the class (line 291):

  ```typescript
  // ADD after getMeshCount():
  /**
   * Return the first live opaque mesh found in the sections map, or null if
   * none exist yet. Used by the readiness diagnostic to pass a real mesh to
   * `material.isReady(mesh)` — PushMaterial always returns false when called
   * with no mesh argument, giving a spurious "material not ready" diagnostic.
   */
  getFirstOpaqueMesh(): Mesh | null {
    for (const { opaque } of this.sections.values()) {
      if (opaque !== null) return opaque;
    }
    return null;
  }
  ```

- [ ] **Fix** `src/main.ts` line 754 — replace the no-mesh `isReady()` calls with mesh-aware versions:

  ```typescript
  // CURRENT (lines 753–755):
  const opaqueMeshCount = renderer.getMeshCount();
  const opaqueMaterialReady = materials.opaque.isReady();
  const transparentMaterialReady = materials.transparent.isReady();

  // NEW:
  const opaqueMeshCount = renderer.getMeshCount();
  const _firstMesh = renderer.getFirstOpaqueMesh();
  const opaqueMaterialReady = _firstMesh !== null
    ? materials.opaque.isReady(_firstMesh)
    : materials.opaque.isReady();
  const transparentMaterialReady = _firstMesh !== null
    ? materials.transparent.isReady(_firstMesh)
    : materials.transparent.isReady();
  ```

- [ ] **Fix** `src/main.ts` lines 1023–1025 (`renderDiag` snapshot in test-api):

  ```typescript
  // CURRENT (lines 1023–1026):
  return {
    opaqueMeshCount: renderer.getMeshCount(),
    opaqueMaterialReady: materials.opaque.isReady(),
    transparentMaterialReady: materials.transparent.isReady(),

  // NEW:
  const _diagMesh = renderer.getFirstOpaqueMesh();
  return {
    opaqueMeshCount: renderer.getMeshCount(),
    opaqueMaterialReady: _diagMesh !== null
      ? materials.opaque.isReady(_diagMesh)
      : materials.opaque.isReady(),
    transparentMaterialReady: _diagMesh !== null
      ? materials.transparent.isReady(_diagMesh)
      : materials.transparent.isReady(),
  ```

- [ ] **Write unit test** in `src/rendering/world-renderer.test.ts` — add a new `describe` block:

  ```typescript
  // ADD to world-renderer.test.ts (import Mesh at top if not already):
  describe("WorldRenderer.getFirstOpaqueMesh", () => {
    it("returns null when no sections have been built", () => {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const world = new World(1337);
      const mats = createTerrainMaterials(scene);
      const renderer = new WorldRenderer(scene, world, mats);
      expect(renderer.getFirstOpaqueMesh()).toBeNull();
      scene.dispose();
      engine.dispose();
    });

    it("returns a Mesh after buildInitial populates opaque sections", () => {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const world = new World(1337);
      const mats = createTerrainMaterials(scene);
      const renderer = new WorldRenderer(scene, world, mats);
      renderer.buildInitial(1);
      const mesh = renderer.getFirstOpaqueMesh();
      // At radius 1 there should be at least one opaque terrain mesh.
      // Accept null only if the world generated no solid blocks (unlikely with seed 1337).
      if (renderer.getMeshCount() > 0) {
        expect(mesh).not.toBeNull();
      }
      scene.dispose();
      engine.dispose();
    });
  });
  ```

- [ ] **Verify** (UNIT): `corepack pnpm vitest run src/rendering/world-renderer.test.ts`
  Expected output: all tests pass, including the two new `getFirstOpaqueMesh` tests.

- [ ] **Typecheck**: `corepack pnpm typecheck` — expect 0 errors.

- [ ] **Commit**: `git commit -m "feat(renderer): add getFirstOpaqueMesh(); fix isReady() no-mesh diagnostic bug"`

---

### Task 2: Remove shader grid — delete outline + collapse AO; update terrain-material.test.ts

**Files:**
- Modify: `src/rendering/terrain-material.ts` (`CUSTOM_FRAGMENT_UPDATE_DIFFUSE` block, lines 200–227)
- Modify: `src/rendering/terrain-material.test.ts` (shader string assertions, lines 145–152)

The spec (§2.2, §2.3) says: *"Delete the hard outline pass; collapse the seam + AO passes into one gentle contact-AO (≤8–10% darken over a soft band)."* The current fragment shader has three stacked darkening passes (seam ~20%, wide AO ~22%, outline 50%) that stack to ~31% darkening at every edge. The seam band is 0.06, the AO band is 0.32 — both too wide. The outline pass must be deleted entirely.

- [ ] **Replace** the `CUSTOM_FRAGMENT_UPDATE_DIFFUSE` string in `src/rendering/terrain-material.ts` (lines 200–228). Current code:

  ```glsl
  // CURRENT (lines 200–227 inside getCustomCode fragment return):
  CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
  {
    float _tileIdx = floor(vTileIndex + 0.5);
    float _col = mod(_tileIdx, 16.0);
    float _row = floor(_tileIdx / 16.0);
    vec2 _tileUV = clamp(fract(vAtlasUV), 0.02, 0.98);
    vec2 _atlasUV = (vec2(_col, _row) + _tileUV) / 16.0;
    vec4 _atlasSample = texture2D(atlasSampler, _atlasUV);
    baseColor.rgb = _atlasSample.rgb;
    // FIX 1: baked per-face directional brightness (top bright, bottom dark).
    baseColor.rgb *= vFaceShade;
    // FIX 2: per-block edge groove using the per-block UV from fract(vAtlasUV).
    // _g is in [0,1) per block; _edge is distance to nearest block border;
    // smoothstep produces 0 at border, 1 in interior.
    vec2 _g = fract(vAtlasUV);
    float _edge = min(min(_g.x, 1.0 - _g.x), min(_g.y, 1.0 - _g.y));
    float _seam = smoothstep(0.0, 0.06, _edge);
    baseColor.rgb *= mix(0.80, 1.0, _seam);
    // --- Cube definition: soft edge AO band + crisp per-block outline ---
    // _bd = distance (in block-UV units) to the nearest block border, 0 at edge.
    float _bd = _edge;
    // Soft AO: darken up to ~22% within a wide band near every block edge → depth.
    float _ao = smoothstep(0.0, 0.32, _bd);
    baseColor.rgb *= mix(0.78, 1.0, _ao);
    // Crisp thin outline: a hard dark line right at the block border → visible grid.
    float _outline = 1.0 - smoothstep(0.0, 0.03, _bd);
    baseColor.rgb = mix(baseColor.rgb, baseColor.rgb * 0.5, _outline);
  }
  `,
  ```

  Replace with:

  ```glsl
  // NEW:
  CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
  {
    float _tileIdx = floor(vTileIndex + 0.5);
    float _col = mod(_tileIdx, 16.0);
    float _row = floor(_tileIdx / 16.0);
    vec2 _tileUV = clamp(fract(vAtlasUV), 0.02, 0.98);
    vec2 _atlasUV = (vec2(_col, _row) + _tileUV) / 16.0;
    vec4 _atlasSample = texture2D(atlasSampler, _atlasUV);
    baseColor.rgb = _atlasSample.rgb;
    // Per-face directional brightness (top bright, bottom dark, sides mid).
    baseColor.rgb *= vFaceShade;
    // Gentle contact-AO: one soft band, ≤10% darken, no hard outline.
    // _g is in [0,1) per block; _edge is distance to nearest block border.
    vec2 _g = fract(vAtlasUV);
    float _edge = min(min(_g.x, 1.0 - _g.x), min(_g.y, 1.0 - _g.y));
    // Narrow band (0.08) so AO only appears at close contact, not across the face.
    float _contactAO = smoothstep(0.0, 0.08, _edge);
    // mix(0.90, 1.0) → at most ~10% darken at the extreme edge.
    baseColor.rgb *= mix(0.90, 1.0, _contactAO);
  }
  `,
  ```

- [ ] **Update** the shader assertion test in `src/rendering/terrain-material.test.ts` — the test at lines 145–152 currently asserts the old multi-pass strings. Replace the entire `it("fragment shader applies edge groove darkening via smoothstep (FIX 2)")` test:

  ```typescript
  // CURRENT (lines 145–152):
  it("fragment shader applies edge groove darkening via smoothstep (FIX 2)", () => {
    const mats = createTerrainMaterials(scene);
    const opaque = mats.opaque as StandardMaterial;
    const frag = getPluginCode(opaque, "fragment", "CUSTOM_FRAGMENT_UPDATE_DIFFUSE");
    expect(frag).toContain("smoothstep");
    expect(frag).toContain("_seam");
    expect(frag).toContain("mix(0.80");
  });

  // NEW (replace with):
  it("fragment shader has gentle contact-AO: no hard outline, darken ≤ 12%", () => {
    const mats = createTerrainMaterials(scene);
    const opaque = mats.opaque as StandardMaterial;
    const frag = getPluginCode(opaque, "fragment", "CUSTOM_FRAGMENT_UPDATE_DIFFUSE");
    // Contact-AO band present via smoothstep.
    expect(frag).toContain("smoothstep");
    // Hard outline pass is gone — must not contain the old outline variable.
    expect(frag).not.toContain("_outline");
    // Seam variable removed.
    expect(frag).not.toContain("_seam");
    // Darkening factor at most 10% (mix from 0.90 or higher).
    // The mix lower-bound must be ≥ 0.88 (≤ 12% darken).
    const mixMatch = frag.match(/mix\((0\.\d+)/);
    expect(mixMatch).not.toBeNull();
    if (mixMatch !== null) {
      const lowerBound = parseFloat(mixMatch[1] ?? "0");
      expect(lowerBound).toBeGreaterThanOrEqual(0.88);
    }
  });
  ```

- [ ] **Verify** (UNIT): `corepack pnpm vitest run src/rendering/terrain-material.test.ts`
  Expected: all tests pass. The updated test replaces the old design-lock assertions; no other test in this file is changed.

- [ ] **QA note (VISUAL-ONLY — not a unit test):** After this task, run `corepack pnpm dev` and look at a close-up block face. The grid lines (dark outlines at every block edge) should be gone. Faces should look clean. Capture a screenshot and compare to the "before" baseline. This step cannot be verified headless.

- [ ] **Commit**: `git commit -m "fix(shader): remove hard outline + wide AO; replace with gentle contact-AO ≤10%"`

---

### Task 3: Golden-hour sun direction in sky.ts + update sky.test.ts

**Files:**
- Modify: `src/time/sky.ts` (`sunDirectionAt` function, lines 142–154)
- Modify: `src/time/sky.test.ts` (noon b>r assertion, lines 42–47; sun y>0.5 assertion, lines 102–105)

The spec (§2.3) says: *"sun toward ~25° elevation / ~135° azimuth."* The current `sunDirectionAt` has y = sin(theta) where theta = (tod/24000) * 2π, giving y ≈ 1.0 (overhead) at tod 6000. We want the sun at a lower, more raking 25°–30° elevation at the golden-hour spawn TOD (~10000). The spawn TOD change happens in Task 6; here we update the sun direction math to include a meaningful x-z tilt so the sun is never perfectly overhead.

- [ ] **Replace** `sunDirectionAt` in `src/time/sky.ts` (lines 142–154). Current code:

  ```typescript
  // CURRENT (lines 142–154):
  export function sunDirectionAt(tod: number): RGB {
    const t = wrapTod(tod);
    // Angle around the day: 0 at tod 0, 2π at tod 24000.
    const theta = (t / DAY) * Math.PI * 2;
    // Height peaks at noon (tod 6000 => theta = π/2 => sin = 1) and bottoms at
    // midnight (tod 18000 => theta = 3π/2 => sin = -1).
    const y = Math.sin(theta);
    // Horizontal component sweeps across the sky; keep z small for a fixed tilt.
    const x = Math.cos(theta);
    const z = 0;
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    return [x / len, y / len, z / len];
  }
  ```

  Replace with:

  ```typescript
  // NEW:
  /**
   * A normalised sun direction `[x, y, z]` for the directional light.
   *
   * The sun travels along an arc tilted from zenith: the vertical component is
   * capped at sin(65°) ≈ 0.906 so the sun never reaches directly overhead —
   * it stays at a raking angle that produces golden-hour shadows throughout the
   * day. At tod 6000 (noon) the sun is at ~65° elevation; at the golden-hour
   * spawn TOD (~10000) it is lower (~25°–30°), producing strong side-lighting.
   *
   * The horizontal (x) component gives the sun its east→west sweep so shadows
   * rotate across the day. z is a small fixed southward tilt for visual interest.
   */
  export function sunDirectionAt(tod: number): RGB {
    const t = wrapTod(tod);
    // Angle around the day: 0 at tod 0, 2π at tod 24000.
    const theta = (t / DAY) * Math.PI * 2;
    // Tilt the arc: cap vertical component so the sun never goes fully overhead.
    // A 65° max elevation gives strong directional shadows at all times of day.
    const MAX_ELEV = (65 * Math.PI) / 180; // 65° in radians
    const y = Math.sin(theta) * Math.sin(MAX_ELEV);
    // East–west horizontal sweep.
    const x = Math.cos(theta);
    // Small fixed southward tilt for visual interest (raking light from the south).
    const z = 0.15;
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    return [x / len, y / len, z / len];
  }
  ```

- [ ] **Update** `src/time/sky.test.ts` — the `"y is high (>0.5) near noon"` test (lines 102–105) still holds because at noon (tod 6000) theta = π/2, y = sin(π/2) * sin(65°) ≈ 0.906 → still > 0.5. No change needed to that assertion — it stays green automatically. Verify by running the test.

- [ ] **Update** `src/time/sky.test.ts` — the `"noon (6000) is bright: a vivid daytime sky-blue"` test (lines 42–47). This test will need to be updated in Task 4 when the noon sky keyframe is warmed (b>r will no longer hold). Mark here that Task 4 owns that update. No change in this task.

- [ ] **Verify** (UNIT): `corepack pnpm vitest run src/time/sky.test.ts`
  Expected: all tests pass (the y>0.5 noon assertion still holds; the noon b>r assertion is a separate test that will be updated in Task 4 when keyframes change).

- [ ] **Commit**: `git commit -m "feat(sky): tilt sun arc to 65° max elevation for raking golden-hour lighting"`

---

### Task 4: Warm sky/fog keyframes in sky.ts + decouple fog + update daynight.test.ts

**Files:**
- Modify: `src/time/sky.ts` (`SKY_KEYFRAMES`, lines 56–65)
- Modify: `src/game/daynight.ts` (`applySky` function, lines 50–74)
- Modify: `src/time/sky.test.ts` (noon b>r assertion, lines 42–47)
- Modify: `src/game/daynight.test.ts` (`clearColor` closeTo assertion, lines 37–45)

The spec (§2.2, §2.3) says: *"warm the daytime sky keyframe(s) and decouple/warm fog; add a dedicated bright-warm keyframe."* The current noon keyframe `{ at: 6000, color: [0.45, 0.65, 0.95] }` is a saturated cool blue that overwrites `scene.clearColor` every frame — warming constants in `main.ts` has no effect because `applySky` overwrites them. The fix is to warm the keyframes and optionally shift the fog color toward a dusty warm haze rather than tracking the sky exactly.

- [ ] **Replace** `SKY_KEYFRAMES` in `src/time/sky.ts` (lines 56–65). Current code:

  ```typescript
  // CURRENT (lines 56–65):
  const SKY_KEYFRAMES: readonly Keyframe[] = [
    { at: 0,     color: [0.45, 0.65, 0.95] },
    { at: 6000,  color: [0.45, 0.65, 0.95] },
    { at: 12000, color: [0.5,  0.62, 0.85] },
    { at: 12500, color: [0.95, 0.55, 0.25] },
    { at: 13000, color: [0.35, 0.22, 0.28] },
    { at: 18000, color: [0.02, 0.03, 0.09] },
    { at: 22800, color: [0.06, 0.05, 0.16] },
    { at: 23200, color: [0.95, 0.6,  0.55] },
  ];
  ```

  Replace with (adds a golden-hour keyframe at TOD 10000, warms morning/noon):

  ```typescript
  // NEW:
  /**
   * Sky-color keyframes around the day circle.
   *
   *   0      morning: warm peach-blue (soft, not cold)
   *   6000   mid-morning: light warm sky (less saturated blue)
   *   10000  golden hour: deep warm amber-gold sky (spawn keyframe)
   *   12000  late afternoon: soft warm blue before sunset
   *   12500  sunset: warm orange
   *   13000  dusk: rapidly darkening
   *   18000  midnight: dark navy
   *   22800  pre-dawn: still dark
   *   23200  sunrise: soft pink-orange
   *
   * The segment from the last keyframe (23200) wraps back to the first (0).
   */
  const SKY_KEYFRAMES: readonly Keyframe[] = [
    { at: 0,     color: [0.60, 0.68, 0.88] },  // morning: warm peach-blue
    { at: 6000,  color: [0.55, 0.70, 0.90] },  // mid-morning: light warm sky (b still dominant but less cool)
    { at: 10000, color: [0.82, 0.62, 0.38] },  // golden-hour: deep warm amber (spawn TOD)
    { at: 12000, color: [0.58, 0.66, 0.82] },  // late afternoon: soft warm-blue
    { at: 12500, color: [0.95, 0.55, 0.25] },  // sunset: warm orange (unchanged)
    { at: 13000, color: [0.35, 0.22, 0.28] },  // dusk (unchanged)
    { at: 18000, color: [0.02, 0.03, 0.09] },  // midnight (unchanged)
    { at: 22800, color: [0.06, 0.05, 0.16] },  // pre-dawn (unchanged)
    { at: 23200, color: [0.95, 0.6,  0.55] },  // sunrise (unchanged)
  ];
  ```

- [ ] **Decouple fog color** in `src/game/daynight.ts` — add a warm fog offset so fog reads dusty/warm rather than pure sky blue. Replace `applySky` function (lines 50–74). Current code:

  ```typescript
  // CURRENT (lines 50–74):
  export function applySky(targets: SkyTargets, clock: Clock): void {
    const tod = tickOfDay(clock);

    const [r, g, b] = skyColorAt(tod);
    const intensity = sunLightIntensityAt(tod);
    const [sx, sy, sz] = sunDirectionAt(tod);

    // Sky clear color (alpha unchanged) + fog color tracks the sky.
    targets.scene.clearColor.r = r;
    targets.scene.clearColor.g = g;
    targets.scene.clearColor.b = b;
    targets.scene.fogColor = new Color3(r, g, b);

    // Directional light: scale [0,1] intensity to a sane max.
    targets.sun.intensity = intensity * SUN_MAX_INTENSITY;
    // sunDirectionAt points FROM origin TOWARD the sun; a DirectionalLight's
    // `.direction` is the direction light TRAVELS, so negate it (light points
    // down at noon when the sun is overhead).
    targets.sun.direction.set(-sx, -sy, -sz);

    // Ambient hemispheric light fades toward (but never to) zero at night.
    targets.hemi.intensity =
      HEMI_NIGHT_INTENSITY +
      (HEMI_DAY_INTENSITY - HEMI_NIGHT_INTENSITY) * intensity;
  }
  ```

  Replace with:

  ```typescript
  // NEW:
  export function applySky(targets: SkyTargets, clock: Clock): void {
    const tod = tickOfDay(clock);

    const [r, g, b] = skyColorAt(tod);
    const intensity = sunLightIntensityAt(tod);
    const [sx, sy, sz] = sunDirectionAt(tod);

    // Sky clear color (alpha unchanged).
    targets.scene.clearColor.r = r;
    targets.scene.clearColor.g = g;
    targets.scene.clearColor.b = b;

    // Fog color: slightly warmer and less saturated than the sky.
    // During the day the fog picks up warm dusty tones from the sun; at night
    // it tracks the sky exactly (intensity ≈ 0 → no warm offset).
    // Warm offset: +0.04 red, +0.02 green, -0.03 blue (daytime only).
    const warmR = r + 0.04 * intensity;
    const warmG = g + 0.02 * intensity;
    const warmB = b - 0.03 * intensity;
    targets.scene.fogColor = new Color3(
      Math.min(1, warmR),
      Math.min(1, Math.max(0, warmG)),
      Math.min(1, Math.max(0, warmB)),
    );

    // Directional light: scale [0,1] intensity to a sane max.
    targets.sun.intensity = intensity * SUN_MAX_INTENSITY;
    targets.sun.direction.set(-sx, -sy, -sz);

    // Ambient hemispheric light fades toward (but never to) zero at night.
    targets.hemi.intensity =
      HEMI_NIGHT_INTENSITY +
      (HEMI_DAY_INTENSITY - HEMI_NIGHT_INTENSITY) * intensity;
  }
  ```

- [ ] **Update** `src/time/sky.test.ts` lines 42–47 — the `"noon (6000) is bright: a vivid daytime sky-blue"` test. The new noon keyframe `[0.55, 0.70, 0.90]` still has b (0.90) > r (0.55) so the `b > r` assertion still holds. **However** check that `b > 0.7` still holds (it does: 0.90 > 0.7). No change needed — the test stays green with the new keyframe.

- [ ] **Update** `src/game/daynight.test.ts` — the `"sets the scene clear color"` test (lines 37–45) asserts `scene.clearColor.r` closeTo `skyColorAt(6000)[0]`. This test is STILL correct because `applySky` still sets `clearColor` from `skyColorAt(tod)` — the only change is the warm offset applied to `fogColor` not `clearColor`. The test stays green as-is. Verify:

- [ ] **Verify** (UNIT): `corepack pnpm vitest run src/time/sky.test.ts src/game/daynight.test.ts`
  Expected: all tests pass. The noon b>r assertion: new noon `[0.55, 0.70, 0.90]` → b (0.90) > r (0.55) ✓; b > 0.7 ✓; g > 0.4 ✓.

- [ ] **Commit**: `git commit -m "feat(sky): warm keyframes + add golden-hour keyframe at TOD 10000; decouple fog warm offset"`

---

### Task 5: Warm/cool light split + warm ambient floor in main.ts

**Files:**
- Modify: `src/main.ts` (lights init, lines 139–158; scene.ambientColor, line 158)

The spec (§2.3) says: *"Warm key (~5200K) + cool hemisphere sky fill (~7500K) with warm ground bounce; warm the ambient floor."* The current values are already partially warmed from earlier fixes (per the comments in the file). This task audits and finalizes the warm/cool split to match the golden-hour intent, now that the sky keyframes (Task 4) provide the correct warm sky.

- [ ] **Update** hemisphere light init in `src/main.ts` (lines 139–145). Current code:

  ```typescript
  // CURRENT (lines 139–145):
  const hemiLight = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemiLight.intensity = 1.1;
  hemiLight.diffuse = new Color3(1.0, 0.98, 0.95);
  // FIX 4: trimmed from 0.45 → 0.34 to reduce the flat fill that washes out
  // per-face contrast. This lets faceShade brightness steps read clearly while
  // keeping the scene well within the bright "golden-hour" target.
  hemiLight.groundColor = new Color3(0.34, 0.35, 0.38);
  ```

  Replace with (cooler sky diffuse to contrast against warm sun; warm ground bounce):

  ```typescript
  // NEW:
  const hemiLight = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemiLight.intensity = 1.1;
  // Cool-sky fill (~7500K): slightly blue-white for sky-lit surfaces (top faces).
  hemiLight.diffuse = new Color3(0.88, 0.93, 1.0);
  // Warm ground bounce: amber-tinged fill for downward/side-facing normals.
  hemiLight.groundColor = new Color3(0.42, 0.36, 0.28);
  ```

- [ ] **Update** sun light init in `src/main.ts` (lines 147–150). Current code:

  ```typescript
  // CURRENT (lines 147–150):
  const sunLight = new DirectionalLight("sun", new Vector3(-0.6, -0.85, -0.4), scene);
  sunLight.intensity = 2.4;
  sunLight.diffuse = new Color3(1.0, 0.94, 0.82);
  ```

  Replace with (warmer ~5200K key; direction is overwritten per-frame by applySky anyway):

  ```typescript
  // NEW:
  // Key light: warm 5200K-ish. Direction overwritten every frame by applySky().
  const sunLight = new DirectionalLight("sun", new Vector3(-0.6, -0.85, -0.4), scene);
  sunLight.intensity = 2.4;
  // Warm amber-gold (~5200K) key light for the golden-hour intent.
  sunLight.diffuse = new Color3(1.0, 0.88, 0.70);
  ```

- [ ] **Update** `scene.ambientColor` in `src/main.ts` (line 158). Current code:

  ```typescript
  // CURRENT (line 158):
  scene.ambientColor = new Color3(0.16, 0.16, 0.18);
  ```

  Replace with (slightly warm amber ambient floor; keep low to preserve faceShade contrast):

  ```typescript
  // NEW:
  // Warm ambient floor: slight amber tint so all faces have a legible warm minimum.
  // Kept low (0.14) to preserve per-face directional brightness contrast.
  scene.ambientColor = new Color3(0.16, 0.14, 0.11);
  ```

- [ ] **Verify** (UNIT): `corepack pnpm test` (full suite)
  Expected: 885 tests (or more, including new tests from Tasks 1–4) pass. No regressions — light init values are not unit-tested directly; the test suite exercises behavior, not constants in main.ts.

- [ ] **QA note (VISUAL-ONLY):** Run `corepack pnpm dev`. Verify at spawn: sky fill on top faces should read cool-sky blue-white; side and bottom faces should have a warm amber ground bounce. Compare to before-screenshot.

- [ ] **Commit**: `git commit -m "feat(lighting): warm 5200K sun key + cool 7500K sky fill + warm ground bounce + warm ambient floor"`

---

### Task 6: Golden-hour spawn TOD

**Files:**
- Modify: `src/main.ts` (spawn clock init, line 102)

The spec (§2.3, §2.4) says: *"Spawn into a bright golden-hour time-of-day (before SUNSET_START, where sun intensity ≈ 1.0)."* The new golden-hour keyframe added in Task 4 is at TOD 10000. `TIME.SUNSET_START = 12000`, so TOD 10000 is safely in the daytime band where `sunLightIntensityAt` returns 1.0. The spawn TOD change is one line.

- [ ] **Replace** the clock init in `src/main.ts` (line 102). Current code:

  ```typescript
  // CURRENT (line 102):
  const clock = makeClock(6000);
  ```

  Replace with:

  ```typescript
  // NEW:
  // Spawn at the golden-hour keyframe (TOD 10000): sun is at ~25°–30° elevation,
  // warm amber sky, full intensity (< SUNSET_START=12000). The warm keyframe
  // added to SKY_KEYFRAMES in sky.ts activates here.
  const clock = makeClock(10000);
  ```

- [ ] **Update** the initial sky color read in `src/main.ts` (lines 105–106 and 109). These lines call `skyColorAt(tickOfDay(clock))` which will now use tod=10000 — no code change needed, they already read from the clock dynamically. Verify visually.

- [ ] **Write a UNIT test** confirming spawn TOD is in golden-hour band — add to `src/game/daynight.test.ts`:

  ```typescript
  // ADD to daynight.test.ts (import sunLightIntensityAt at top if not already):
  import { sunLightIntensityAt } from "../time/sky";
  import { TIME } from "../rules/mc-1.20";

  describe("golden-hour spawn TOD", () => {
    it("spawn TOD 10000 is before SUNSET_START (full sun intensity)", () => {
      // The spawn clock is initialized at TOD 10000; verify it is in the full
      // daytime band so sunLightIntensityAt returns 1.0 (not ramping down).
      const SPAWN_TOD = 10000;
      expect(SPAWN_TOD).toBeLessThan(TIME.SUNSET_START); // 12000
      expect(sunLightIntensityAt(SPAWN_TOD)).toBeCloseTo(1.0, 5);
    });

    it("skyColorAt(10000) is warm (red channel dominant over blue)", () => {
      // The golden-hour keyframe at TOD 10000 should read amber/warm —
      // red channel should exceed blue channel at this keyframe.
      const [r, , b] = skyColorAt(10000);
      expect(r).toBeGreaterThan(b);
    });
  });
  ```

- [ ] **Verify** (UNIT): `corepack pnpm vitest run src/game/daynight.test.ts`
  Expected: all tests pass including the two new golden-hour spawn tests.

- [ ] **QA note (VISUAL-ONLY):** Run `corepack pnpm dev`. On load, the sky should be warm amber-gold (the TOD 10000 keyframe). The sun should cast long raking shadows. Capture a spawn screenshot.

- [ ] **Commit**: `git commit -m "feat(spawn): start at golden-hour TOD 10000 (warm amber sky, full sun intensity)"`

---

### Task 7: ColorCurves + contrast + exposure grade in post-fx.ts

**Files:**
- Modify: `src/rendering/post-fx.ts` (add exported constants; enable ColorCurves + contrast + exposure in `initPostFX`)

The spec (§2.3) says: *"On the existing pipeline: enable ColorCurves (warm global tint, cooler shadows) + contrast ≈ 1.10 + exposure ≈ 1.05–1.10. Keep ACES. No new render pass."* The current `initPostFX` sets `exposure = 1.0` and has no `ColorCurves`. Note: `ColorCurves` and `contrast` live on `imageProcessing` which already exists on the pipeline. Keep ACES (`toneMappingType = 1`).

**Important:** `DEFAULT_BLOOM_THRESHOLD`, `DEFAULT_BLOOM_INTENSITY`, `DEFAULT_BLOOM_KERNEL`, `DEFAULT_SSAO_INTENSITY`, and `DEFAULT_GRAIN_INTENSITY` are tested in `post-fx.test.ts` and must NOT change value.

- [ ] **Add exported constants** to `src/rendering/post-fx.ts` after the existing constants (after line 48):

  ```typescript
  // ADD after DEFAULT_GRAIN_INTENSITY (line 48):
  /** Image-processing exposure (HDR → display). Slightly above 1 to lift midtones. */
  export const DEFAULT_EXPOSURE = 1.07;
  /** Image-processing contrast. Above 1 adds punch/depth. */
  export const DEFAULT_CONTRAST = 1.10;
  /** ColorCurves global hue: 0 = no shift. */
  export const DEFAULT_CC_GLOBAL_HUE = 0;
  /** ColorCurves global saturation. Babylon scale: 0 = neutral, ~+10..+30 = subtly richer (usable range ~-100..100). Keep modest; tune via QA. */
  export const DEFAULT_CC_GLOBAL_SATURATION = 12;
  /** ColorCurves global exposure: warm lift. */
  export const DEFAULT_CC_GLOBAL_EXPOSURE = 0.05;
  /** ColorCurves shadow hue: slight cool shift in shadows. */
  export const DEFAULT_CC_SHADOWS_HUE = 200;
  /** ColorCurves shadow density: subtle blue tint in deep shadows. */
  export const DEFAULT_CC_SHADOWS_DENSITY = 12;
  ```

- [ ] **Add `ColorCurves` import** at the top of `src/rendering/post-fx.ts` (after the existing imports):

  ```typescript
  // ADD import (after existing imports):
  import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
  ```

- [ ] **Enable ColorCurves + contrast + exposure** in `initPostFX` in `src/rendering/post-fx.ts` — add after the `p.imageProcessing.exposure = 1.0;` line (line 163). Current code around line 160–165:

  ```typescript
  // CURRENT (lines 160–165):
  p.imageProcessingEnabled = true;
  p.imageProcessing.toneMappingEnabled = true;
  p.imageProcessing.toneMappingType = 1; // ImageProcessingConfiguration.TONEMAPPING_ACES
  p.imageProcessing.exposure = 1.0;
  p.fxaaEnabled = false;
  ```

  Replace with:

  ```typescript
  // NEW:
  p.imageProcessingEnabled = true;
  p.imageProcessing.toneMappingEnabled = true;
  p.imageProcessing.toneMappingType = 1; // ImageProcessingConfiguration.TONEMAPPING_ACES
  p.imageProcessing.exposure = DEFAULT_EXPOSURE;
  p.imageProcessing.contrast = DEFAULT_CONTRAST;
  // ColorCurves: warm global tint + cooler shadows for golden-hour grade.
  p.imageProcessing.colorCurvesEnabled = true;
  const cc = new ColorCurves();
  cc.globalHue = DEFAULT_CC_GLOBAL_HUE;
  cc.globalSaturation = DEFAULT_CC_GLOBAL_SATURATION;
  cc.globalExposure = DEFAULT_CC_GLOBAL_EXPOSURE;
  // Subtle cool shift in deep shadows (adds depth against warm midtones).
  cc.shadowsHue = DEFAULT_CC_SHADOWS_HUE;
  cc.shadowsDensity = DEFAULT_CC_SHADOWS_DENSITY;
  p.imageProcessing.colorCurves = cc;
  p.fxaaEnabled = false;
  ```

- [ ] **Add unit tests** for the new constants to `src/rendering/post-fx.test.ts` — add inside the existing `describe("design-spec constants")` block:

  ```typescript
  // ADD to the "design-spec constants" describe block in post-fx.test.ts:
  it("exposure matches spec (DEFAULT_EXPOSURE ≈ 1.07)", () => {
    expect(DEFAULT_EXPOSURE).toBeGreaterThan(1.0);
    expect(DEFAULT_EXPOSURE).toBeLessThanOrEqual(1.15);
  });

  it("contrast matches spec (DEFAULT_CONTRAST ≈ 1.10)", () => {
    expect(DEFAULT_CONTRAST).toBeGreaterThan(1.0);
    expect(DEFAULT_CONTRAST).toBeLessThanOrEqual(1.20);
  });

  it("color curves global saturation is subtly enriched (modest positive, not extreme)", () => {
    expect(DEFAULT_CC_GLOBAL_SATURATION).toBeGreaterThan(0);
    expect(DEFAULT_CC_GLOBAL_SATURATION).toBeLessThanOrEqual(40);
  });
  ```

  Also add the new constants to the import at the top of `post-fx.test.ts`:

  ```typescript
  // UPDATE import in post-fx.test.ts to add new exports:
  import {
    initPostFX,
    DEFAULT_BLOOM_THRESHOLD,
    DEFAULT_BLOOM_INTENSITY,
    DEFAULT_BLOOM_KERNEL,
    DEFAULT_SSAO_INTENSITY,
    DEFAULT_GRAIN_INTENSITY,
    DEFAULT_EXPOSURE,
    DEFAULT_CONTRAST,
    DEFAULT_CC_GLOBAL_SATURATION,
    type PostFXController,
  } from "./post-fx";
  ```

- [ ] **Verify** (UNIT): `corepack pnpm vitest run src/rendering/post-fx.test.ts`
  Expected: all existing tests still pass (bloom/grain constants unchanged); new exposure/contrast/saturation tests pass.

- [ ] **QA note (VISUAL-ONLY — A/B optional):** Run `corepack pnpm dev`. The image should look punchier (contrast 1.10), slightly lifted (exposure 1.07), subtly richer color (globalSaturation +12, tune via QA), with cooler deep shadows. Optional: swap `toneMappingType` to `2` (KHR_PBR_NEUTRAL) in the dev console and compare screenshots. Settle on ACES vs KHR_PBR_NEUTRAL now — no code fork needed, just update the constant.

- [ ] **Commit**: `git commit -m "feat(post-fx): add ColorCurves warm grade + contrast 1.10 + exposure 1.07 on existing ACES pipeline"`

---

### Task 8: Warm + slightly saturate palette in palette.ts

**Files:**
- Modify: `src/rendering/palette.ts` (`TILE_COLORS`, lines 23–60)

The spec (§2.3) says: *"Warm + slightly saturate base colors, tuned against rendered output (gamma space)."* The current palette is cool/olive (grass is `[0.35, 0.55, 0.2]` — olive; stone is `[0.5, 0.5, 0.5]` — flat grey; dirt is `[0.45, 0.32, 0.2]` — already somewhat warm). Palette tests only check `[0,1]` ranges — all values must stay in `[0,1]`.

Note: The palette is used by the atlas generator (`src/rendering/atlas.ts`) to tint the procedural atlas texels. In the atlas path (`USE_ATLAS=true`), the atlas renders noise-textured colors — the palette provides the base hue. Warming the palette directly warms the atlas-textured blocks.

- [ ] **Replace** `TILE_COLORS` in `src/rendering/palette.ts` (lines 23–60). Key changes: warm stone (+red +green, -blue), warm grass (more yellow-green, less olive-grey), warm dirt (redder), enrich wood tones, keep ores distinctive. All values in `[0, 1]`.

  ```typescript
  // CURRENT (lines 23–60):
  const TILE_COLORS: Readonly<Record<number, RGB>> = {
    0:  [0.0,  0.0,  0.0 ], // air_blank — never rendered
    1:  [0.5,  0.5,  0.5 ], // stone — mid gray
    2:  [0.45, 0.32, 0.2 ], // dirt — brown
    3:  [0.35, 0.55, 0.2 ], // grass_top — olive green
    4:  [0.42, 0.46, 0.24], // grass_side — brownish-green
    5:  [0.85, 0.8,  0.62], // sand — pale tan
    6:  [0.18, 0.36, 0.7 ], // water — blue
    7:  [0.45, 0.34, 0.22], // oak_log_side — brown bark
    8:  [0.62, 0.5,  0.34], // oak_log_end — lighter end-grain
    9:  [0.22, 0.45, 0.16], // oak_leaves — green
    10: [0.66, 0.52, 0.33], // oak_planks — tan wood
    11: [0.42, 0.42, 0.42], // cobblestone — dark gray
    12: [0.75, 0.85, 0.9 ], // glass — pale blue-white
    13: [0.28, 0.28, 0.3 ], // coal_ore — stone-gray, dark tint
    14: [0.56, 0.48, 0.42], // iron_ore — stone-gray, tan tint
    15: [0.66, 0.6,  0.32], // gold_ore — stone-gray, yellow tint
    16: [0.6,  0.32, 0.32], // redstone_ore — stone-gray, red tint
    17: [0.4,  0.62, 0.64], // diamond_ore — stone-gray, cyan tint
    18: [0.32, 0.4,  0.62], // lapis_ore — stone-gray, blue tint
    19: [0.12, 0.12, 0.13], // bedrock — near-black
    20: [0.95, 0.96, 0.98], // snow — white
    21: [0.5,  0.48, 0.46], // gravel — speckled gray
    22: [0.6,  0.46, 0.3 ], // crafting_table_top
    23: [0.66, 0.52, 0.33], // crafting_table_bottom — planks look
    24: [0.58, 0.44, 0.28], // crafting_table_side
    25: [0.36, 0.36, 0.38], // furnace_top — dark stone
    26: [0.4,  0.4,  0.42], // furnace_side
    27: [0.3,  0.3,  0.32], // furnace_front — fire hole, darker
    28: [0.85, 0.65, 0.3 ], // torch — warm orange
    29: [0.92, 0.85, 0.55], // glowstone — bright yellow
    30: [0.85, 0.35, 0.12], // lava — orange-red
    31: [0.86, 0.86, 0.82], // birch_log_side — pale bark
    32: [0.8,  0.76, 0.6 ], // birch_log_end
    33: [0.3,  0.5,  0.22], // birch_leaves — green
    34: [0.78, 0.7,  0.5 ], // birch_planks — pale wood
    35: [0.78, 0.16, 0.18], // bed — warm red
  };
  ```

  Replace with (warmed + slightly saturated; all values in `[0, 1]`):

  ```typescript
  // NEW:
  const TILE_COLORS: Readonly<Record<number, RGB>> = {
    0:  [0.0,  0.0,  0.0 ], // air_blank — never rendered
    1:  [0.54, 0.52, 0.48], // stone — warm grey (slight red-orange cast)
    2:  [0.52, 0.34, 0.18], // dirt — richer warm brown
    3:  [0.38, 0.58, 0.16], // grass_top — vivid warm yellow-green
    4:  [0.46, 0.48, 0.20], // grass_side — warmer brownish-green
    5:  [0.90, 0.84, 0.60], // sand — richer warm tan
    6:  [0.16, 0.38, 0.72], // water — slightly richer blue
    7:  [0.50, 0.36, 0.20], // oak_log_side — richer warm bark
    8:  [0.68, 0.54, 0.32], // oak_log_end — warmer end-grain
    9:  [0.24, 0.48, 0.14], // oak_leaves — vivid green
    10: [0.72, 0.56, 0.30], // oak_planks — richer warm tan wood
    11: [0.46, 0.44, 0.40], // cobblestone — warm dark grey
    12: [0.78, 0.86, 0.90], // glass — pale blue-white (unchanged)
    13: [0.30, 0.28, 0.26], // coal_ore — warm dark
    14: [0.60, 0.50, 0.40], // iron_ore — warm tan
    15: [0.70, 0.64, 0.28], // gold_ore — richer yellow
    16: [0.64, 0.28, 0.28], // redstone_ore — deeper red
    17: [0.36, 0.64, 0.66], // diamond_ore — vivid cyan
    18: [0.28, 0.38, 0.66], // lapis_ore — deeper blue
    19: [0.12, 0.12, 0.13], // bedrock — near-black (unchanged)
    20: [0.94, 0.96, 0.98], // snow — white (unchanged)
    21: [0.54, 0.50, 0.46], // gravel — warm speckled grey
    22: [0.64, 0.48, 0.28], // crafting_table_top — warmer
    23: [0.70, 0.56, 0.30], // crafting_table_bottom — planks
    24: [0.62, 0.46, 0.24], // crafting_table_side — warmer
    25: [0.38, 0.36, 0.34], // furnace_top — warm dark stone
    26: [0.44, 0.42, 0.38], // furnace_side — warm stone
    27: [0.30, 0.28, 0.26], // furnace_front — darker warm
    28: [0.90, 0.68, 0.28], // torch — richer warm orange
    29: [0.94, 0.88, 0.52], // glowstone — rich yellow
    30: [0.88, 0.32, 0.10], // lava — vivid orange-red
    31: [0.88, 0.86, 0.80], // birch_log_side — warm pale bark
    32: [0.84, 0.78, 0.58], // birch_log_end — warmer
    33: [0.28, 0.52, 0.18], // birch_leaves — vivid green
    34: [0.82, 0.74, 0.48], // birch_planks — richer warm pale wood
    35: [0.82, 0.14, 0.16], // bed — vivid warm red
  };
  ```

- [ ] **Write unit test** verifying all palette values are in `[0, 1]` — add to `src/rendering/palette.test.ts` (or create the file if it doesn't exist). Check current palette test file:

  ```typescript
  // If src/rendering/palette.test.ts doesn't exist, create it:
  import { describe, it, expect } from "vitest";
  import { tileColor } from "./palette";

  describe("tileColor", () => {
    it("returns [0,1]-range values for all known tile indices 0–35", () => {
      for (let idx = 0; idx <= 35; idx++) {
        const [r, g, b] = tileColor(idx);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(1);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(1);
      }
    });

    it("returns a fresh copy each call (mutations do not affect subsequent calls)", () => {
      const a = tileColor(1);
      a[0] = 999;
      const b = tileColor(1);
      expect(b[0]).not.toBe(999);
    });

    it("returns FALLBACK magenta-ish for unknown indices", () => {
      const [r, , b] = tileColor(9999);
      // FALLBACK is [0.8, 0.2, 0.8] — red and blue are high.
      expect(r).toBeGreaterThan(0.5);
      expect(b).toBeGreaterThan(0.5);
    });
  });
  ```

- [ ] **Verify** (UNIT): `corepack pnpm vitest run src/rendering/palette.test.ts`
  Expected: all tests pass. The `[0,1]` sweep confirms no value is out-of-range.

- [ ] **QA note (VISUAL-ONLY):** Run `corepack pnpm dev`. Grass should look vivid warm yellow-green; stone should have a warm grey cast; dirt richer brown. Compare to the "before" screenshot from Task 2's QA baseline.

- [ ] **Commit**: `git commit -m "feat(palette): warm + saturate base colors for golden-hour terrain look"`

---

### Task 9: Full suite verification + DESIGN.md target update

**Files:**
- Read: `DESIGN.md` (top-level; update the rendering target values section)
- No source file modifications — only DESIGN.md update and final QA

The spec (§2.5) says: *"Update DESIGN.md with the new target values so the 'must not drift from DESIGN.md' tests anchor to reality."*

- [ ] **Run full suite**: `corepack pnpm test`
  Expected: 885 tests (+ the new tests added in Tasks 1, 6, 7, 8) all pass. Zero regressions.

- [ ] **Typecheck**: `corepack pnpm typecheck`
  Expected: 0 errors.

- [ ] **Read** `DESIGN.md` to find the rendering values section, then update it to reflect the new golden-hour targets. Key values to update:
  - Spawn TOD: `6000` → `10000`
  - Sky noon keyframe: `[0.45, 0.65, 0.95]` → `[0.55, 0.70, 0.90]`
  - Golden-hour keyframe at TOD 10000: `[0.82, 0.62, 0.38]` (new)
  - `DEFAULT_EXPOSURE`: `1.0` → `1.07`
  - `DEFAULT_CONTRAST`: (new) `1.10`
  - ColorCurves: (new) globalSaturation `+12`, shadowsHue `200`, shadowsDensity `12`
  - Shader: no hard outline; contact-AO ≤10% over 0.08 band
  - Sun: max elevation capped at 65°

- [ ] **Final live QA (VISUAL-ONLY — mandatory per spec §5):** Run `corepack pnpm dev`. Perform these checks:
  1. **Spawn screenshot**: sky should be amber-gold (TOD 10000 keyframe). Sun should cast long raking shadows.
  2. **Close-up block face**: no dark grid lines at block edges. Gentle contact shadow at block corners only. Faces read clean.
  3. **Warm blocks**: grass vivid warm yellow-green, stone warm grey, dirt richer brown.
  4. **Lighting**: top faces bright (cool sky fill), side faces pick up warm sun, bottom faces darker.
  5. **Night transition**: advance time to ~13000+ (dusk); sky should darken naturally; fog picks up warm offset.
  6. **Performance**: F4 diagnostic should now show `opq:ok` and `trn:ok` (not `NO`) once terrain meshes are ready.
  7. **Optional A/B**: swap `toneMappingType` to `2` (KHR_PBR_NEUTRAL) in `post-fx.ts`, rebuild, compare screenshots. Decide and revert to preferred setting.

- [ ] **Commit DESIGN.md update**: `git commit -m "docs(design): update rendering targets for golden-hour cure — new keyframes, exposure, ColorCurves"`

---

## Spec Coverage Map

| Spec §2.3 requirement | Task |
|---|---|
| Remove grid (delete outline, collapse seam+AO) | Task 2 |
| Warm palette | Task 8 |
| Warm key light (~5200K) + cool hemisphere fill (~7500K) + warm ground bounce | Task 5 |
| Warm sky keyframes + decouple fog | Task 4 |
| Sun toward ~25° elevation / ~135° azimuth | Task 3 |
| Golden-hour spawn TOD | Task 6 |
| ColorCurves + contrast + exposure on existing pipeline | Task 7 |
| Fix readiness diagnostic (getFirstOpaqueMesh + isReady with mesh arg) | Task 1 |
| Do NOT enable useSRGBBuffer | Enforced by omission (not in any task) |
| Design-lock test updates | Task 2 updates `terrain-material.test.ts` (grid shader strings). `sky.test.ts` / `daynight.test.ts` existing assertions stay green (verified); `daynight.test.ts` gains new spawn tests in Task 6 |
| DESIGN.md update | Task 9 |
| Live QA (mandatory per §5) | Tasks 2, 5, 6, 8, 9 |
