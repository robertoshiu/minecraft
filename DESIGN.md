# Design System — Minecraft Clone

This file is the single source of truth for all visual and UI decisions.
Read it before making any UI, color, font, or animation change.
Do not deviate without explicit user approval.

---

## Visual Identity: "Golden Hour Survival"

**Direction**: Minecraft RTX warmth meets Valheim's grounded materiality.

The default lighting is **warm golden-hour IBL** (Poly Haven "kloofendal" HDRI, sun at ~27° elevation, azimuth 135°). This is not noon-bright vanilla MC; it is the 30 minutes before sunset where everything reads as cinematic. Key light color temperature: 5200K; ambient fill: 7500K cool blue sky bounce. The warm/cool split gives depth without saturation tricks.

**Spawn time-of-day**: TOD 10000 (golden hour — sun low, amber sky, raking light). The old noon spawn (TOD 6000) is no longer the default.

**Color saturation**: Warmed and slightly-saturated base colors baked into the atlas palette (the atlas is the sole hue source for terrain). Grass is a believable olive-green (#5a7a32), not neon. Diamond ore gets a +20% saturation boost on the emissive channel so it reads as "precious" against muted stone. Lava is #ff6a00 at 1.8 emissive intensity — it must feel dangerous.

**Edge treatment**: ONE gentle contact-AO band (≤10% darken, 0.08 band width). Hard outline and wide AO have been removed — they created a dark grid over every block face. No geometry bevels; voxel silhouette is preserved.

**Emissive blocks** (only 6 types emit light):

| Block | Color | Intensity | Radius | Note |
|---|---|---|---|---|
| Torch | #ffb347 | 1.2 | 8 | Warm flame |
| Lava | #ff6a00 | 1.8 | — | Dangerous |
| Glowstone | #fff4e0 | 1.5 | — | Soft white |
| Redstone ore | #ff2222 | 0.6 | — | Pulses |
| Diamond ore | #44ffee | 0.4 | — | Subtle |
| Gold ore | #ffd700 | 0.3 | — | Very subtle |

**Post-FX**: Restrained. Bloom threshold 0.85, intensity 0.3, radius 4px (emissives and sun specular only). Subtle film grain at 0.02 opacity (animated, breaks cave banding). No chromatic aberration, no vignette, no LUT. SSAO at 0.4 intensity, radius 0.5, to ground blocks against each other.

**Post grade (layered on existing ACES tonemapping pass)**: exposure 1.07, contrast 1.10; ColorCurves: globalSaturation +12, globalExposure 0.05, shadowsHue 200, shadowsDensity 12.

**References**: Minecraft RTX beta (warm torch-lit cave), Valheim (material warmth + restrained particles), Subnautica (IBL-driven depth).

---

## Rendering Values (Phase-1 Golden-Hour Cure)

These are the locked target values shipped in Phase-1. Update only when a new rendering phase is approved.

### Time-of-Day & Sky

**Spawn TOD**: 10000 (golden hour). Previously 6000 (noon).

**Sky color keyframes** (linear RGB, interpolated by the day/night cycle):

| TOD | Name | R | G | B |
|---|---|---|---|---|
| 0 | Morning | 0.60 | 0.68 | 0.88 |
| 6000 | Noon | 0.55 | 0.70 | 0.90 |
| 10000 | Golden hour (spawn) | 0.82 | 0.62 | 0.38 |
| 12000 | Afternoon | 0.58 | 0.66 | 0.82 |

**Fog**: Decoupled from sky color. During daytime, a warm offset is applied over the sky value, intensity-scaled: +0.04 R, +0.02 G, −0.03 B. This keeps horizon haze amber-tinted without contaminating the sky gradient.

### Sun Arc

Vertical elevation term scaled by sin(65°) (raking angle): ~80° elevation at noon (TOD 6000), ~27° elevation at golden-hour spawn (TOD 10000). Horizontal arc covers full east-to-west sweep.

### Lighting

| Light | Property | Value | Notes |
|---|---|---|---|
| Sun (DirectionalLight) | diffuse | `[1.0, 0.88, 0.70]` | ~5200K warm key |
| Hemi sky (HemisphericLight) | diffuse | `[0.88, 0.93, 1.0]` | ~7500K cool sky fill |
| Hemi sky | groundColor | `[0.42, 0.36, 0.28]` | Warm bounce from terrain |
| Scene | ambientColor | `[0.16, 0.14, 0.11]` | Warm-low ambient floor |

### Post Grade

Applied on top of the existing ACES tonemapping pass (not a separate pipeline stage):

| Parameter | Value |
|---|---|
| exposure | 1.07 |
| contrast | 1.10 |
| ColorCurves.globalSaturation | +12 |
| ColorCurves.globalExposure | 0.05 |
| ColorCurves.shadowsHue | 200 |
| ColorCurves.shadowsDensity | 12 |

### Terrain Shader AO

Hard outline and wide ambient-occlusion removed (they caused a dark grid on every block face). Replaced with ONE gentle contact-AO: maximum 10% darkening, 0.08 band width.

### Palette

The block atlas is the sole hue source for terrain color. Base colors are warmed and slightly saturated relative to vanilla — no procedural recoloring at runtime. The palette was committed in the `feat(palette)` task.

---

## Color Palette

Copy this block verbatim into any new stylesheet. Tokens are the only approved color values for UI elements.

```css
:root {
  /* === Background Layers === */
  --bg-panel:        #1a1d24;  /* Dark blue-gray, not pure black — reduces OLED smear, warm contrast to text */
  --bg-glass:        rgba(18, 21, 28, 0.82);  /* Frosted panel for inventory/crafting — 82% opacity for depth without obscuring world */
  --bg-overlay:      rgba(0, 0, 0, 0.55);  /* Death/pause dimmer — 55% black preserves world visibility */
  --bg-slot:         #252830;  /* Inventory slot base — 2 tones lighter than panel for subtle hierarchy */
  --bg-slot-hover:   #2f333d;  /* Hover state — +10% lightness, no hue shift */

  /* === Text Hierarchy === */
  --text-primary:    #e8e6e1;  /* Warm off-white, not #fff — reduces eye strain during long sessions */
  --text-secondary:  #9a978f;  /* Muted warm gray — readable but clearly subordinate */
  --text-muted:      #5c5a54;  /* Disabled/placeholder — 3:1 contrast ratio minimum */
  --text-disabled:   #3d3c38;  /* Unavailable actions — barely visible, signals "not now" */

  /* === Brand / Accent === */
  --accent:          #d4a843;  /* Warm gold — evokes ore/crafting, NOT Minecraft green (IP guardrail) */
  --accent-hover:    #e6bc5a;  /* +15% lightness on hover */
  --accent-active:   #b8912e;  /* -10% lightness on press */

  /* === Game State === */
  --hp-full:         #c43838;  /* Saturated red — urgent but not alarming */
  --hp-empty:        #3a2020;  /* Dark desaturated red — visible but recedes */
  --hunger-full:     #b07830;  /* Warm brown-orange — earthy, food-associated */
  --hunger-empty:    #2e2418;  /* Dark brown — matches hunger theme */
  --xp-bar:          #7ec850;  /* Bright green — classic XP association, slightly desaturated vs MC */
  --day-indicator:   #f0c860;  /* Warm yellow — sun association */
  --night-indicator: #4a5a8a;  /* Cool blue — moon/night association */
  --warning:         #e8a020;  /* Amber — caution without panic */
  --success:         #4caf50;  /* Material green — universally recognized */

  /* === Status === */
  --info:            #5090c0;  /* Calm blue — informational, non-urgent */
  --error:           #d04040;  /* Strong red — demands attention */
  --neutral:         #707070;  /* Mid-gray — no emotional valence */
}
```

---

## Typography

Three fonts, no more. Self-host all three as WOFF2 in `assets/fonts/` (CDN breaks COOP/COEP headers — G19).

| Role | Font | Weights | Sizes | Rationale |
|---|---|---|---|---|
| **UI text** | `Inter` (variable) | 400, 500, 600 | 12 / 14 / 16 / 20px | High x-height, excellent at small sizes, variable font = single file |
| **Display** | `Space Grotesk` | 500, 700 | 24 / 32 / 48px | Geometric but warm; used for death screen title, day counter, pause menu headers |
| **Mono** | `JetBrains Mono` | 400 | 11 / 13px | F3 debug screen, FPS counter, coordinates — tabular nums ensure alignment |

---

## UI Element Specs

### Hotbar

- **Container**: 364×44px, bottom-center, 8px from viewport bottom.
- **Slots**: 9 slots × 40×40px, 1px gap, 8px border-radius.
- **Colors**: Slot bg `--bg-slot`, border `#3a3d45` 1px solid. Selected slot: `--accent` 2px border + `box-shadow: 0 0 8px rgba(212,168,67,0.4)`.
- **Stack count**: `--text-primary`, 12px Inter 600, bottom-right, `text-shadow: 0 1px 2px rgba(0,0,0,0.8)`.
- **Animation**:
  - Default: static.
  - Hover: `translateY(-2px)`, 120ms ease-out.
  - Selection change: gold border slides to new slot, 200ms `cubic-bezier(0.4,0,0.2,1)`.
  - Item pickup: 150ms scale 0→1 bounce.
  - Item consume: 200ms scale 1→0 + fade.
- **Accessibility**: Selected slot `aria-current="true"`, 2px focus ring. Colorblind: border thickness (2px vs 1px) + glow distinguishes selection, not color alone.

### Health Hearts

- **Dimensions**: 182×18px container (10 hearts × 18px + 2px gaps). Bottom-left, 8px from left, 52px from bottom.
- **Heart**: 16×16px SVG within 18×18 container.
- **Colors**: Full `--hp-full` (#c43838), empty `--hp-empty` (#3a2020), half = left full / right empty.
- **Animation**:
  - Damage: flash white (100ms) then shake (translateX ±2px, 3 cycles, 200ms).
  - Regen tick: brief green overlay (150ms fade in/out).
  - Low HP (< 6): pulse scale 1.0→1.08, 1s cycle.
  - Critical (< 4): pulse 0.5s, red screen-edge vignette.
- **Accessibility**: Protanopia — full hearts turn `#5090c0` blue. Screen reader: `aria-label="Health: 14 of 20"`.

### Hunger Shanks

- **Dimensions**: 182×18px, mirrors health bar. Bottom-right, 8px from right, 52px from bottom.
- **Shank**: simplified drumstick SVG, 16×16px.
- **Colors**: Full `--hunger-full` (#b07830), empty `--hunger-empty` (#2e2418).
- **Animation**:
  - Loss: shank grays out left-to-right (300ms wipe).
  - Low hunger (< 6): subtle ±1px shake, 2s cycle.
  - Eating: consumed shank fills right-to-left with green tint (200ms).
- **Accessibility**: Deuteranopia — empty shanks get X pattern overlay. Screen reader: `aria-label="Hunger: 16 of 20"`.

### Crosshair

- **Dimensions**: 24×24px centered. Two 2px×10px bars at 90°, 4px gap in center.
- **Colors**: Default `--text-primary` at 80% opacity. Block targeted: 100% opacity + 1px white outline. Hostile mob: `#ff5252`. Interactable: `--accent`.
- **Animation**:
  - Block targeted: scale 1.0→1.1, 100ms.
  - Breaking block: progress ring 0→360° over break duration (`--accent` stroke).
  - Break complete: flash white, 50ms.
  - No target: dims to 50% opacity.

### Day Counter

- **Dimensions**: 120×32px pill (border-radius 16px). Top-left, 12px from top, 12px from left.
- **Colors**: Bg `--bg-glass`. Day icon ☀ `--day-indicator` (#f0c860), night icon ☾ `--night-indicator` (#4a5a8a). Text `--text-primary`, 14px Space Grotesk 500.
- **Format**: "Day 12" or "Night 12".
- **Animation**:
  - Dawn: pill slides in from left (300ms), number counts up (200ms).
  - Dusk: icon crossfades sun→moon (400ms).
  - Night: `box-shadow: 0 0 6px rgba(74,90,138,0.3)`.
- **Accessibility**: Day/night distinguished by icon shape, not color alone. Screen reader: `aria-label="Day 12, daytime"`.

### Death Screen

- **Dimensions**: 480×320px card, 8px border-radius, on full-viewport overlay.
- **Overlay**: `--bg-overlay` (55% black), 12px backdrop-filter blur.
- **Colors**: Card bg `--bg-panel`, 1px border `#3a3d45`. Title "You Died" in `--hp-full`, 48px Space Grotesk 700. Subtitle (death cause): `--text-secondary` 16px. "Respawn" button `--accent`, "Title Screen" button `--bg-slot`.
- **Animation**:
  - On death: screen desaturates over 800ms (CSS filter), red vignette pulses once (600ms), card fades in + slides up 20px (400ms, 200ms delay).
  - Respawn click: card fades out (200ms), world fades from black (600ms).
- **Accessibility**: Screen reader auto-announces death cause. Death screen auto-focuses Respawn button.

### Inventory Grid

- **Dimensions**: 9 columns × 4 rows of 36px slots, 8px gaps. Container: 384×420px with 16px padding.
- **Colors**: Container `--bg-glass`, backdrop-filter blur(8px). Slots `--bg-slot`, hover `--bg-slot-hover`, 4px border-radius. Item tooltip: `--bg-panel` with `--accent` 2px left border.
- **Animation**:
  - Open: scale 0.95→1.0 + fade in (200ms).
  - Close: scale 1.0→0.95 + fade out (150ms).
  - Item drag: follows cursor at scale 1.1 + drop shadow.
  - Drop valid: slot flashes green (100ms). Invalid: snaps back (200ms spring).
- **Accessibility**: Full tab order, arrow-key grid navigation, roving tabindex. Screen reader: `aria-label="Slot 3: Stone, 42 items"`.

### Crafting Grid (3×3 Workbench)

- **Dimensions**: 3×3 grid = 132×132px (36px slots + 8px gaps). Output slot: 44×44px. Arrow: 24×24px. Total container: 200×160px.
- **Colors**: Grid slots `--bg-slot`. Output slot: `--bg-slot` + 2px `--accent` border. Arrow: `--text-muted` → `--accent` when recipe valid (150ms fade).
- **Animation**:
  - Recipe valid: arrow fades in (150ms), output slot glows `--accent` at 0.2 opacity.
  - Craft click: grid items shrink + fade (150ms), output item pops to cursor (200ms).
- **Accessibility**: Output slot announces recipe result on focus. Colorblind: valid recipe shows green checkmark overlay.

---

## Implementation Status

The current build uses these color tokens in `src/styles/hud.css` (subset of the full token set above — `--bg-glass`, `--accent`, `--text-primary`, `--text-secondary`, `--hp-full`, `--hp-empty`, `--hunger-full`, `--hunger-empty`, `--day-indicator`, `--slot-border`). The hotbar, crosshair, health hearts, hunger shanks, and day counter are all wired to these tokens.

**PBR atlas art is deferred.** The current build uses vertex-color rendering (flat block colors from the block palette) as a sanctioned placeholder. All PBR material, IBL, shadow, and atlas work (plan Waves 2.6, 2.8) is not yet implemented. When PBR is added, it must follow the emissive table and roughness values above exactly.

Font loading (Inter / Space Grotesk / JetBrains Mono) is deferred. The current build uses `system-ui` as a fallback. Font integration must self-host WOFF2 files in `assets/fonts/` to comply with the COOP/COEP requirement (G19).

---

## PBR + IBL Terrain (Phase 6d, flag-gated, default OFF)

### Status: Opt-in experimental capability. The design-locked golden-hour look is unchanged.

The shipped default (`USE_PBR_TERRAIN = false` in `src/rendering/terrain-material.ts`) is **byte-identical** to the golden-hour StandardMaterial path described above — no `scene.environmentTexture`, no PBR material, no new shader. The flag is a compile-time `export const`; flipping it does not alter `SAVE_VERSION` (stays at 8) or any game logic.

### What the ON path does

When `USE_PBR_TERRAIN = true`:

- **Material path.** `createTerrainMaterials` returns a `PBRMaterial` opaque/transparent pair (instead of `StandardMaterial`) that reuses the **same albedo atlas RawTexture**. The `PbrAtlasMaterialPlugin` injects the identical per-vertex tile lookup + `faceShade` + contact-AO into Babylon's `CUSTOM_FRAGMENT_UPDATE_ALBEDO` point (writing `surfaceAlbedo`), so chunk geometry (`chunk-mesh.ts`) is unchanged. Key material parameters: `metallic = 0` (all terrain is non-metal), `roughness = PBR_TERRAIN_ROUGHNESS = 0.78` (uniform, matte Minecraft voxel look). Per-type roughness is a follow-up, not v1.
- **IBL path.** A procedural gradient cubemap (`createEnvironmentCubemap` in `src/rendering/environment-cubemap.ts`) is constructed once at boot and wired to `scene.environmentTexture`. The six faces approximate a warm golden-hour sky (+X warm amber, −X cool blue, +Y bright sky, −Y dark warm floor, ±Z neutral blend) so IBL adds soft sky-tinted fill on shadowed faces and a faint warm sheen on top faces — ADDITIVE on top of the existing sun/hemi/CSM, not a replacement. `scene.environmentIntensity` is set per frame to `sunLightIntensityAt(tod) × prefs.pbrIntensity` so IBL dims to near-zero at midnight and never double-brightens the scene at noon.
- **Tone mapping.** The Phase-6c ACES `ImageProcessingPostProcess` + `goldenHour`/`neutral` grades are unchanged. PBR output feeds the same downstream pass.

### Tuning knobs

| Knob | Location | Default | Direction |
|---|---|---|---|
| `PBR_TERRAIN_ROUGHNESS` | `src/rendering/terrain-material.ts` | `0.78` | Raise toward 0.85–0.9 if stone looks shiny; lower toward 0.7 if flat/dead |
| `pbrIntensity` pref | `src/game/preferences.ts` `DEFAULT_PREFS` | `0.5` | Lower if noon blows out with IBL on; 0..1 range, persisted |
| IBL face colors | `src/rendering/environment-cubemap.ts` `FACE_*` constants | warm golden-hour gradient | Adjust for different sky moods; pure function, fully unit-testable |

### Open follow-up items (out of 6d scope)

- Per-type roughness (stone vs grass vs wood vs water) — v1 is uniform roughness only.
- CC0 HDRI environment (e.g. Poly Haven) vs procedural gradient — procedural is the default-OFF safe path.
- Per-material `environmentIntensity` opt-out for mobs/arrows/splash (StandardMaterials) — only if IBL makes them look egregious with the flag ON.

### How to enable for local QA

1. Open `src/rendering/terrain-material.ts` and change `export const USE_PBR_TERRAIN = false;` to `true`.
2. Run `corepack pnpm build` (or `corepack pnpm dev`).
3. Launch the game. Evaluate the checklist below.
4. **Revert the flag to `false` before committing.**

### Live-QA checklist (real GPU only — not asserted in CI)

These items are human-verified on a real GPU. NullEngine / CI cannot evaluate visual quality or pixel identity. Work through them in order with `USE_PBR_TERRAIN = true` (except item 1, which uses the default `false`).

1. **OFF-path byte-identity (the design-lock).** With the repo default (`USE_PBR_TERRAIN = false`), launch and screenshot at spawn (TOD 10000 golden hour). The result must be **pixel-identical** to the shipped golden-hour reference: warm 5200K sun, cool hemi fill, per-face `faceShade` brightness (top 1.0 / bottom 0.5 / Z 0.8 / X 0.6), gentle contact-AO (≤10%, skipped on top), sharp CSM shadows, ACES `goldenHour` grade. Verify `scene.environmentTexture === null` via the test-api `renderDiag` console output.

2. **ON-path PBR aesthetics.** With the flag ON, launch at TOD 10000. Stone must read **matte, not metallic or shiny**. Grass must be matte, not plastic. Wood must keep warmth from the atlas. Water/glass may show only a **subtle sheen** (roughness 0.78 is well into the matte range). The atlas tile colors + `faceShade` per-face brightness + contact-AO must still be clearly readable. If stone looks shiny, raise `PBR_TERRAIN_ROUGHNESS` toward 0.85–0.9 and rebuild. If it looks flat/dead, lower toward 0.7.

3. **IBL day/night sweep.** Use the test-api `setTime(tod)` to sweep TOD. IBL must **add** soft sky-tinted fill on shadowed faces + a faint warm top sheen **without replacing** the sun/hemi (sun remains dominant, hemi still fills). Key checkpoints: noon (TOD 6000) must **not** blow out; dusk must not go flat; midnight (TOD 18000) must go dark (env intensity dims to ~0 because `sunLightIntensityAt` returns ~0 at night). If noon blows out, lower `DEFAULT_PREFS.pbrIntensity` below 0.5 or cap the per-frame intensity ceiling, and record the chosen value.

4. **CSM + tone interaction.** With the flag ON, sweep TOD and confirm CSM shadows stay **crisp and acne-free** under PBR (no normal map is added in v1 so acne risk is low, but verify). Toggle the Phase-6c tone modes (`goldenHour` ↔ `neutral`) and confirm the ACES + grade pass still controls the final composite over PBR output — no color banding, grade still applies cleanly on top of PBR.

5. **Global-material check (mobs/arrows/splash).** With the flag ON, `scene.environmentTexture` is global and affects **all** scene materials including mob and projectile StandardMaterials. Confirm they do not look wrong under the added IBL. Minor tinting is acceptable; egregious color shift or blown-out mobs warrants a follow-up `environmentIntensity` opt-out on those materials (out of 6d scope — note any finding and open a follow-up item, do not fix in this branch unless truly egregious).

6. **Boot-with-flag-ON smoke test.** Launch fresh with `USE_PBR_TERRAIN = true`. Confirm there is **no black screen, no console throw** (the `createEnvironmentCubemap` try/catch should handle any GPU failure gracefully, degrading to no-IBL rather than crashing). After confirming a clean boot, **revert `USE_PBR_TERRAIN` to `false`** before pushing.

### Verdict (to be filled in after live QA)

> _Not yet evaluated. The flag remains `false` (default-OFF capability). A reviewer performing live QA should update this section with: tuned `PBR_TERRAIN_ROUGHNESS`, tuned `pbrIntensity`, any egregious material issues found, and the decision to ship ON or keep as a default-OFF experiment._
