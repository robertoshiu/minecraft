# Design System — Minecraft Clone

This file is the single source of truth for all visual and UI decisions.
Read it before making any UI, color, font, or animation change.
Do not deviate without explicit user approval.

---

## Visual Identity: "Golden Hour Survival"

**Direction**: Minecraft RTX warmth meets Valheim's grounded materiality.

The default lighting is **warm golden-hour IBL** (Poly Haven "kloofendal" HDRI, sun at 25° elevation, azimuth 135°). This is not noon-bright vanilla MC; it is the 30 minutes before sunset where everything reads as cinematic. Key light color temperature: 5200K; ambient fill: 7500K cool blue sky bounce. The warm/cool split gives depth without saturation tricks.

**Color saturation**: Faithful-to-nature base with +12% saturation on ores and emissives only. Grass is a believable olive-green (#5a7a32), not neon. Diamond ore gets a +20% saturation boost on the emissive channel so it reads as "precious" against muted stone. Lava is #ff6a00 at 1.8 emissive intensity — it must feel dangerous.

**Edge treatment**: Sharp-edged PBR with 0.02px bevel via normal map only (no geometry bevels). This preserves the voxel silhouette while catching light on edges. Roughness per material: stone 0.85, polished planks 0.55, ore deposits 0.3 (slight sheen signals rarity).

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

**References**: Minecraft RTX beta (warm torch-lit cave), Valheim (material warmth + restrained particles), Subnautica (IBL-driven depth).

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
