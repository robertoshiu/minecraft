/**
 * cave.ts — 3D-noise tunnel carver for world columns.
 *
 * `carveCaves` runs AFTER terrain generation and ore placement. It walks every
 * voxel of a {@link ChunkColumn}, samples a deterministic 3D fBm noise field,
 * and turns solid rock/dirt into AIR wherever the noise crosses a threshold.
 * The sampling is anchored to absolute world coordinates so caves are
 * continuous across column boundaries and identical for a given seed.
 *
 * Design choices:
 *  - FREQ ~ 1/24 gives cave systems on the order of a couple dozen blocks wide.
 *  - The Y axis is sampled at a *higher* frequency than X/Z (FREQ_Y > FREQ),
 *    which compresses the noise vertically so tunnels come out wider than they
 *    are tall — the familiar Minecraft "winding corridor" look.
 *  - THRESHOLD is high (0.62) so only the sparse peaks of the field carve,
 *    keeping caves rare rather than swiss-cheese.
 *
 * Pure: no Babylon imports, no Math.random, no Date. Deterministic.
 */

import { Blocks, type BlockId } from "../rules/mc-1.20";
import type { ChunkColumn } from "../chunk/column";
import { makeNoise3D, fbm3d } from "./noise";

/** Horizontal column extent (blocks) along x and z. */
const SIZE = 16;
/** Vertical world extent (blocks). */
const WORLD_HEIGHT = 256;

/** Horizontal sampling frequency (cells per block). ~1 feature per 24 blocks. */
const FREQ = 1 / 24;
/**
 * Vertical sampling frequency. Larger than {@link FREQ} so the noise varies
 * faster in Y, squashing carved regions vertically -> caves wider than tall.
 */
const FREQ_Y = 1 / 14;
/** fBm octaves: enough detail for winding tunnels without excessive cost. */
const OCTAVES = 3;
/** Carve only where the (absolute) fBm value exceeds this — keeps caves sparse. */
const THRESHOLD = 0.62;

/** True iff a block id is one the carver is allowed to replace with AIR. */
function isCarvable(id: BlockId): boolean {
  return id === Blocks.STONE || id === Blocks.DIRT;
}

/**
 * Carve 3D-noise tunnels into `column` in place.
 *
 * For each voxel that is STONE or DIRT, sits at worldY >= 1 (never bedrock at
 * y=0), and lies strictly below the local surface (`worldY < surfaceHeight - 1`),
 * the absolute fBm noise value is compared against {@link THRESHOLD}; voxels
 * above it become AIR. Surface integrity is preserved by the surface clamp, so
 * no holes are ever punched through the ground.
 */
export function carveCaves(column: ChunkColumn, seed: number): void {
  const noise = makeNoise3D(seed >>> 0);
  const baseX = column.columnX * SIZE;
  const baseZ = column.columnZ * SIZE;

  for (let lz = 0; lz < SIZE; lz++) {
    for (let lx = 0; lx < SIZE; lx++) {
      const surface = column.surfaceHeight(lx, lz);
      // Highest voxel we may carve: strictly below surfaceHeight - 1.
      const top = Math.min(surface - 2, WORLD_HEIGHT - 1);
      if (top < 1) continue;

      const worldX = baseX + lx;
      const worldZ = baseZ + lz;

      for (let worldY = 1; worldY <= top; worldY++) {
        if (!isCarvable(column.getBlock(lx, worldY, lz))) continue;

        const n = fbm3d(
          noise,
          worldX * FREQ,
          worldY * FREQ_Y,
          worldZ * FREQ,
          OCTAVES,
        );

        if (Math.abs(n) > THRESHOLD) {
          column.setBlock(lx, worldY, lz, Blocks.AIR);
        }
      }
    }
  }
}
