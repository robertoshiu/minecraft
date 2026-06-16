/**
 * lava.ts — deterministic deep LAVA LAKE generator for world columns (Phase 6b).
 *
 * `fillDeepLava` runs LAST in the column pipeline (terrain -> caves -> ores ->
 * lava). It walks every voxel in the deep band [1, LAVA_LEVEL] and wherever the
 * seeded 3D-noise LAKE field exceeds the threshold, it replaces STONE **or** AIR
 * with LAVA — embedding genuine lava lakes directly IN deep stone rather than
 * only filling pre-existing cave-air pockets. This makes lava genuinely
 * encounterable: a player digging down to y<=10 will hit lava within normal
 * exploration of any region that falls inside a lake zone.
 *
 * Why this keeps the generation invariants green:
 *  - It only overwrites STONE or AIR cells — bedrock (y=0, always BEDROCK) is
 *    never AIR or STONE, so y=0 is untouched by the stone/air filter.
 *  - Ores (COAL/IRON/GOLD/REDSTONE/DIAMOND/LAPIS_ORE) have distinct block IDs
 *    (11-16), never STONE(1) or AIR(0), so the allowlist guard below skips them
 *    automatically — they survive intact from the prior pipeline stage.
 *  - It skips WATER and any other block not matching STONE or AIR.
 *  - It only writes in worldY in [1, LAVA_LEVEL=10], well below any surface
 *    (surface is at ~60-130+), so surface integrity is guaranteed.
 *  - It is a PURE function of (column, seed) with no Math.random / Date, so the
 *    "voxel-identical for same coords+seed" determinism invariant holds.
 *
 * Pure: no Babylon imports, no Math.random, no Date. Deterministic.
 */

import { Blocks } from "../rules/mc-1.20";
import type { ChunkColumn } from "../chunk/column";
import { makeNoise3D, fbm3d } from "./noise";

/** Horizontal column extent (blocks) along x and z. */
const SIZE = 16;

/**
 * Deepest layer is bedrock at y=0 (never carved, never lava). Lava lakes only
 * in the band [1, LAVA_LEVEL] — well below sea level (64) and any surface.
 */
const LAVA_LEVEL = 10;

/**
 * Noise threshold for the lake field. A deep-band voxel (STONE or AIR) is
 * filled only where the fBm value EXCEEDS this threshold. Lower = more lava.
 *
 * With FREQ ~1/14 and OCTAVES=3, at threshold 0.22 roughly 11-12% of
 * deep-band cells end up as lava (measured: 11.77% cells, ~99% of columns
 * lava-bearing over a 24x24 sweep) — encounterable but not overwhelming,
 * so deep-mining for diamonds is challenging rather than a minefield.
 */
const LAVA_FILL_THRESHOLD = 0.22;

/**
 * Horizontal+vertical sampling frequency (1/scale). A lower value = larger
 * contiguous lake blobs. At 1/14 each noise "island" is ~14 blocks wide,
 * producing distinct lake regions rather than single-cell noise.
 */
const FREQ = 1 / 14;

/** fBm octaves — 3 gives smooth lake shapes with mild surface variation. */
const OCTAVES = 3;

/** Offset the lava-gate seed away from other field seeds. */
const LAVA_SEED_OFFSET = 0x9e3779b1;

/**
 * Embed LAVA LAKES into the deep band [1, LAVA_LEVEL] of `column`, in place.
 *
 * For each voxel at (lx, worldY, lz) with 1 <= worldY <= LAVA_LEVEL:
 *   - If the block is STONE or AIR AND the noise gate fires -> replace with LAVA.
 *   - If the block is BEDROCK, an ore, WATER, or anything else -> skip (preserve).
 *
 * Run AFTER ores so lava never overwrites an ore cell. Bedrock is safe because
 * it is never STONE or AIR in the pipeline.
 */
export function fillDeepLava(column: ChunkColumn, seed: number): void {
  const noise = makeNoise3D((seed ^ LAVA_SEED_OFFSET) >>> 0);
  const baseX = column.columnX * SIZE;
  const baseZ = column.columnZ * SIZE;

  for (let lz = 0; lz < SIZE; lz++) {
    for (let lx = 0; lx < SIZE; lx++) {
      const worldX = baseX + lx;
      const worldZ = baseZ + lz;

      // Only the deep band [1, LAVA_LEVEL]; y=0 is bedrock (never touched).
      for (let worldY = 1; worldY <= LAVA_LEVEL; worldY++) {
        const block = column.getBlock(lx, worldY, lz);

        // Only deep STONE or AIR becomes lava — this preserves ores, bedrock,
        // and water (none of which are STONE/AIR).
        if (block !== Blocks.STONE && block !== Blocks.AIR) continue;

        // Sample the lake field at absolute world coordinates.
        // Uses isotropic single-sided fBm (n > THRESHOLD) — deliberately
        // simpler than cave.ts's anisotropic two-sided (abs(n)) carve —
        // because lava wants rounded lake blobs, not wide tunnels.
        const n = fbm3d(
          noise,
          worldX * FREQ,
          worldY * FREQ,
          worldZ * FREQ,
          OCTAVES,
        );
        if (n > LAVA_FILL_THRESHOLD) {
          column.setBlock(lx, worldY, lz, Blocks.LAVA);
        }
      }
    }
  }
}
