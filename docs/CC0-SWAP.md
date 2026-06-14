# CC0 Asset Swap Guide

This document describes how to replace the current procedural texture atlas with hand-authored CC0 textures without touching any game logic.

---

## Current State

The renderer generates a single **1024×1024 RGBA atlas at runtime** in `src/rendering/atlas.ts`. Key facts:

- 16×16 grid of 64×64 px tile cells (row-major: `index = row*16 + col`)
- Procedural detail only: deterministic hash-based speckle, wood grain, and leaf dapple patterns
- All 36 used tile indices (0–35) are covered; indices 36–255 fill with debug magenta
- 2-pixel edge dilation per tile prevents mipmap bleeding
- `src/rendering/palette.ts` maps each tile index to a flat vertex color (used by the current greedy-mesh renderer until PBR lands)

No external image files are loaded today. There are no Mojang, Notch, or any third-party art assets in the repository.

---

## Target State

Replace `generateAtlasRGBA()` in `atlas.ts` with a texture-loader that reads pre-packed PNG files from `public/textures/`. The procedural code can be retained as a dev fallback when the PNG files are absent.

Suggested loader signature (do not implement until PBR shader is ready):

```typescript
// atlas.ts — future API
export async function loadAtlasTexture(scene: Scene): Promise<Texture> {
  // 1. Try to fetch public/textures/atlas-color.png  (albedo)
  // 2. Try to fetch public/textures/atlas-orm.png    (occlusion/roughness/metallic)
  // 3. Try to fetch public/textures/atlas-normal.png (tangent-space normals)
  // 4. Fallback: call generateAtlasRGBA() and upload as a DynamicTexture
}
```

---

## PBR Channels Required

Each texture must ship three PNG files at the same atlas layout:

| Channel pack | File name             | Contents                                                  |
|--------------|-----------------------|-----------------------------------------------------------|
| Albedo       | `atlas-color.png`     | sRGB base color (no baked lighting or AO)                 |
| ORM          | `atlas-orm.png`       | R = ambient occlusion, G = roughness, B = metallic        |
| Normal       | `atlas-normal.png`    | Tangent-space normals, OpenGL convention (Y up)           |

Resolution: **1024×1024** to match the current atlas size. Individual tile inputs are 16×16 px (matching vanilla Minecraft resolution), up-scaled to 64×64 when packing.

---

## Texture Sources

All textures must be **CC0 (Creative Commons Zero)** or equivalent public domain. Do not use anything from Mojang's asset pipeline.

Recommended sources:

- **Poly Haven** — https://polyhaven.com (surface textures, PBR packs)
- **ambientCG** — https://ambientcg.com (tileable PBR materials, CC0)
- **OpenGameArt** — https://opengameart.org (filter by CC0)
- **Kenney** — https://kenney.nl/assets (CC0 game asset packs)

---

## Required Textures — All 36 Atlas Tiles

| Tile idx | Name                   | Faces used by                              | Suggested CC0 search terms                              |
|----------|------------------------|--------------------------------------------|---------------------------------------------------------|
| 0        | air\_blank             | AIR (never rendered)                       | — (leave transparent/blank)                             |
| 1        | stone                  | STONE (all)                                | "stone tile seamless" / "gray stone surface"            |
| 2        | dirt                   | DIRT (all); GRASS (ny)                     | "dirt ground seamless" / "soil texture"                 |
| 3        | grass\_top             | GRASS (py)                                 | "grass top-down seamless" / "lawn aerial"               |
| 4        | grass\_side            | GRASS (px,nx,pz,nz)                        | "grass dirt side" — composite: top half green, lower dirt |
| 5        | sand                   | SAND (all)                                 | "sand seamless" / "beach sand surface"                  |
| 6        | water                  | WATER (all)                                | "water surface seamless" / "water top-down" (alpha)     |
| 7        | oak\_log\_side         | OAK\_LOG (px,nx,pz,nz)                    | "tree bark seamless" / "oak bark"                       |
| 8        | oak\_log\_end          | OAK\_LOG (py,ny)                           | "wood end grain" / "log cross-section"                  |
| 9        | oak\_leaves            | OAK\_LEAVES (all)                          | "leaf texture seamless" / "foliage atlas" (alpha)       |
| 10       | oak\_planks            | OAK\_PLANKS (all)                          | "wood plank seamless" / "oak floor boards"              |
| 11       | cobblestone            | COBBLESTONE (all)                          | "cobblestone seamless" / "stone paving"                 |
| 12       | glass                  | GLASS (all)                                | "glass texture" / "frosted glass" (alpha)               |
| 13       | coal\_ore              | COAL\_ORE (all)                            | stone base + dark vein overlay; "coal seam"             |
| 14       | iron\_ore              | IRON\_ORE (all)                            | stone base + tan/rust vein overlay                      |
| 15       | gold\_ore              | GOLD\_ORE (all)                            | stone base + yellow vein overlay                        |
| 16       | redstone\_ore          | REDSTONE\_ORE (all)                        | stone base + red vein overlay                           |
| 17       | diamond\_ore           | DIAMOND\_ORE (all)                         | stone base + cyan/teal vein overlay                     |
| 18       | lapis\_ore             | LAPIS\_ORE (all)                           | stone base + blue vein overlay                          |
| 19       | bedrock                | BEDROCK (all)                              | "rough stone dark" / "basalt seamless"                  |
| 20       | snow                   | SNOW (all)                                 | "snow seamless" / "snow surface top"                    |
| 21       | gravel                 | GRAVEL (all)                               | "gravel seamless" / "pea gravel surface"                |
| 22       | crafting\_table\_top   | CRAFTING\_TABLE (py)                       | "workbench top" — wood planks + 2×2 carved grid overlay |
| 23       | crafting\_table\_bottom| CRAFTING\_TABLE (ny)                       | reuse oak\_planks (idx 10) or plain wood                |
| 24       | crafting\_table\_side  | CRAFTING\_TABLE (px,nx,pz,nz)              | wood planks + simple tool outlines overlay              |
| 25       | furnace\_top           | FURNACE (py,ny)                            | "stone slab top" / dark stone                           |
| 26       | furnace\_side          | FURNACE (nx,pz,nz)                         | "stone brick seamless"                                  |
| 27       | furnace\_front         | FURNACE (px)                               | stone brick + fire-opening cutout (orange glow)         |
| 28       | torch                  | TORCH (all)                                | "wooden stick" + flame tip; small sprite on alpha bg    |
| 29       | glowstone              | GLOWSTONE (all)                            | "yellow crystal" / "amber crystal" — bright emissive    |
| 30       | lava                   | LAVA (all)                                 | "molten rock" / "lava surface" (animated optional)      |
| 31       | birch\_log\_side       | BIRCH\_LOG (px,nx,pz,nz)                  | "birch bark seamless" / "white bark"                    |
| 32       | birch\_log\_end        | BIRCH\_LOG (py,ny)                         | "birch log cross-section" / "white wood end grain"      |
| 33       | birch\_leaves          | BIRCH\_LEAVES (all)                        | "birch leaf seamless" / "light green foliage" (alpha)   |
| 34       | birch\_planks          | BIRCH\_PLANKS (all)                        | "light wood plank seamless" / "birch floor"             |
| 35       | bed                    | BED (all)                                  | "fabric red seamless" / "wool texture red"              |

---

## File Layout

```
public/
  textures/
    atlas-color.png        1024×1024  sRGB albedo atlas
    atlas-orm.png          1024×1024  ORM pack
    atlas-normal.png       1024×1024  tangent-space normal map
    sources/               individual 16x16 tiles (pre-pack, for reference)
      stone-color.png
      stone-orm.png
      stone-normal.png
      ... (one set per tile name above)
docs/
  ATTRIBUTION.md           required per CC0 courtesy; see file
```

---

## How to Pack the Atlas

The atlas packing script is not yet written. The intended approach:

1. Place individual 16×16 source PNGs under `public/textures/sources/<name>-<channel>.png`
2. Run a Node.js packing script (to be created at `scripts/pack-atlas.mjs`) that:
   - Reads tiles in index order (0–35)
   - Up-scales each 16×16 tile to 64×64 (nearest-neighbor, no anti-aliasing)
   - Places it at `(tileCol(idx)*64, tileRow(idx)*64)` in the 1024×1024 output
   - Applies 2-pixel edge dilation (matching current `generateAtlasRGBA` behavior)
   - Writes `atlas-color.png`, `atlas-orm.png`, `atlas-normal.png`
3. Run `scripts/verify-cc0.sh` (or `.ps1`) to confirm no proprietary asset markers exist

Until this pipeline is in place, the procedural atlas in `atlas.ts` remains active and no source code changes are required.

---

## Attribution Requirements

CC0 textures do not legally require attribution, but courtesy attribution is expected by the community. Maintain `docs/ATTRIBUTION.md` with one row per source asset. See that file for the required table format.

No attribution is needed for the procedural assets generated by `atlas.ts` (original work).

---

## G1 Gate Criteria

The asset swap is considered complete (G1) when all of the following pass:

1. `scripts/verify-cc0.sh` reports **PASS** (no Mojang/Minecraft references in `dist/`)
2. `docs/ATTRIBUTION.md` has a row for every non-procedural asset
3. `corepack pnpm run build` completes without errors
4. `corepack pnpm run test` shows all tests green
5. A manual visual check confirms no debug-magenta tiles appear in-game
