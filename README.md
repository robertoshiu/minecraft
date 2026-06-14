# Voxel Survival

A browser-based voxel survival game built with TypeScript + Babylon.js.

![Screenshot](docs/screenshot.png)

---

## Features

- **Infinite procedural world** — 4-biome terrain (plains, forest, desert, snow) with 3D caves and ore seams, streaming in 16x16x256 chunks
- **Full survival loop** — hunger, health, fall damage, tool durability, potion effects
- **Crafting and smelting** — shaped and shapeless recipes, workbench, furnace
- **Mobs** — passive animals (cow, pig, chicken, sheep) and hostile mobs (zombie, creeper, skeleton, spider) with independent AI
- **Day/night cycle** — 20-minute Minecraft-accurate day, dynamic sky colors (sunrise/sunset/dawn), directional light rotation
- **Inventory system** — 4x9 storage, hotbar, drag-and-drop slots, pick-block
- **Save/load** — IndexedDB persistence for world chunks, player position, and inventory
- **Block interaction** — DDA voxel raycast targeting, live greedy remesh on break/place
- **Audio** — Positional block and mob sounds via Web Audio API
- **Particle effects** — Block-break burst, damage indicators
- **Sleep mechanic** — Beds advance time to dawn when used at night

---

## Getting Started

### Prerequisites

- **Node.js 22+** — [nodejs.org](https://nodejs.org)
- **Corepack** — ships with Node 22; enables the correct pnpm version automatically

> **Note:** Always use `corepack pnpm` instead of bare `pnpm`. The globally-installed pnpm on Node 22 defaults to 8.1.1 which is broken on this Node version. `corepack pnpm` reads the `packageManager` field and fetches the correct version.

### Install

```sh
corepack pnpm install
```

### Development server

```sh
corepack pnpm dev
# Opens at http://localhost:5173
```

### Production build

```sh
corepack pnpm build
# Type-checks then bundles to dist/
```

### Preview production build

```sh
corepack pnpm preview
```

### Tests

```sh
corepack pnpm test        # Run 746 unit tests once
corepack pnpm test:watch  # Watch mode
corepack pnpm typecheck   # Type-check only (no emit)
```

---

## Controls

| Input | Action |
|---|---|
| W A S D | Move |
| Space | Jump |
| Shift | Sprint |
| Mouse move | Look (click canvas to acquire pointer lock) |
| Left click | Break block / attack mob |
| Right click | Place block / use item / sleep in bed |
| Middle click | Pick block (copies target block to hotbar) |
| 1 – 9 | Select hotbar slot |
| Scroll wheel | Cycle hotbar slots |
| E | Open / close inventory |
| H | Help screen |
| F5 | Save game |
| Escape | Close modal / pause menu |

See [docs/controls.md](docs/controls.md) for the full reference.

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Rendering | Babylon.js v8.56.2 | WebGL2, procedural vertex-color atlas |
| Build | Vite 6+ | ESM-native, COOP/COEP headers, fast HMR |
| Language | TypeScript 5.5+ strict | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Tests | Vitest 2+ | 746 unit tests, NullEngine, headless |
| Package manager | pnpm via Corepack | Node 22 compatible |

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for a full technical overview including:

- High-level system diagram (Mermaid)
- Module descriptions for all `src/` directories
- Data flow: world gen → chunk data → greedy mesher → Babylon.js mesh
- Game loop: tick → physics → AI → rendering
- Save system: serialization → IndexedDB

---

## Credits

All terrain, textures, and game logic are implemented procedurally — no external art assets are used. Block colors are vertex-colored via a code-defined palette (`src/rendering/palette.ts`). Physics constants and game mechanics are implemented from public documentation of voxel game conventions; no proprietary code or assets are included.

---

## License

MIT
