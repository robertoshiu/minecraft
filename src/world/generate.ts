/**
 * generate.ts — world-generation composer.
 *
 * Stitches the individual generation stages into a single deterministic
 * pipeline for one {@link ChunkColumn}. The stage ORDER is load-bearing:
 *
 *   1. generateTerrain — lay down bedrock / stone / sub-surface / surface and
 *      flood water. Produces the solid column.
 *   2. carveCaves      — carve 3D-noise tunnels through that solid rock. Runs
 *      after terrain so there is something to carve, and below the surface
 *      clamp so the ground is never broken open.
 *   3. generateOres    — scatter ore veins into the REMAINING stone. Runs before
 *      lava so veins fill stone that survived carving (and never float in cave
 *      air); ore replaces only STONE cells, not air.
 *   4. fillDeepLava    — embed LAVA LAKES into the deep band [1, LAVA_LEVEL].
 *      Replaces leftover deep STONE or AIR with lava wherever the noise gate
 *      fires. Ores (already placed on stone in stage 3) survive because the
 *      lava stage's allowlist skips any block that is not STONE or AIR — ore
 *      IDs are distinct from both. Runs last so surface integrity is preserved.
 *      This is what makes lava (and the fire DOT) reachable in-game.
 *
 * Output depends only on (columnX, columnZ, seed): identical inputs => identical
 * voxels. Pure: no Babylon imports, no Math.random, no Date.
 */

import { ChunkColumn } from "../chunk/column";
import { generateTerrain } from "./terrain";
import { carveCaves } from "./cave";
import { generateOres } from "./ore";
import { fillDeepLava } from "./lava";
import { computeColumnSkylight, type LightMap } from "./lighting";

/**
 * Build one fully-generated column at (columnX, columnZ) for `seed`.
 *
 * Runs terrain -> caves -> ores (see file header for why the order matters) and
 * returns the populated column.
 */
export function generateColumn(columnX: number, columnZ: number, seed: number): ChunkColumn {
  const column = new ChunkColumn(columnX, columnZ);
  generateTerrain(column, seed);
  carveCaves(column, seed);
  generateOres(column, seed);
  fillDeepLava(column, seed);
  return column;
}

/**
 * Build a column via {@link generateColumn} and its column-only skylight via
 * {@link computeColumnSkylight}.
 */
export function generateColumnWithLight(
  columnX: number,
  columnZ: number,
  seed: number,
): { column: ChunkColumn; light: LightMap } {
  const column = generateColumn(columnX, columnZ, seed);
  const light = computeColumnSkylight(column);
  return { column, light };
}
