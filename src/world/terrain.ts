/**
 * terrain.ts — deterministic heightmap terrain fill for a chunk column.
 *
 * For each (lx, lz) column position we:
 *   1. classify the biome at the world coordinate,
 *   2. compute a height from the biome's base height + fBm-modulated amplitude,
 *   3. stack BEDROCK / STONE / sub-surface / surface blocks up to that height,
 *   4. flood any cavity below sea level with WATER.
 *
 * Output depends only on (column coords, seed): identical inputs => identical
 * voxels.
 */

import { Blocks } from "../rules/mc-1.20";
import type { ChunkColumn } from "../chunk/column";
import { makeNoise2D, fbm2d, type NoiseFn2D } from "./noise";
import { getBiome, biomeParams } from "./biome";

export const SEA_LEVEL = 64;

/** Horizontal extent of a column (blocks). */
const SIZE = 16;
/** Topmost writable world Y (world height is 256, so 0..255). */
const MAX_Y = 255;

/** Heightmap noise frequency (one full feature per ~96 blocks). */
const TERRAIN_FREQ = 1 / 96;
/** Octaves of fBm summed for the heightmap. */
const TERRAIN_OCTAVES = 4;

/** Lowest and highest permissible surface heights. */
const MIN_HEIGHT = 1;
const MAX_HEIGHT = 200;

/**
 * Offset the heightmap seed away from the biome seeds so the height field is
 * independent of the biome temperature/humidity fields.
 */
const HEIGHT_SEED_OFFSET = 0x632be59b;

/** Cache one heightmap-noise function per seed. */
const heightNoiseCache = new Map<number, NoiseFn2D>();

function heightNoiseFor(seed: number): NoiseFn2D {
  const key = seed >>> 0;
  const cached = heightNoiseCache.get(key);
  if (cached !== undefined) return cached;
  const fn = makeNoise2D((key + HEIGHT_SEED_OFFSET) >>> 0);
  heightNoiseCache.set(key, fn);
  return fn;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Fill a chunk column with deterministic biome-driven terrain. */
export function generateTerrain(column: ChunkColumn, seed: number): void {
  const noise = heightNoiseFor(seed);

  for (let lx = 0; lx < SIZE; lx++) {
    for (let lz = 0; lz < SIZE; lz++) {
      const worldX = column.columnX * SIZE + lx;
      const worldZ = column.columnZ * SIZE + lz;

      const biome = getBiome(worldX, worldZ, seed);
      const params = biomeParams(biome);

      const n = fbm2d(
        noise,
        worldX * TERRAIN_FREQ,
        worldZ * TERRAIN_FREQ,
        TERRAIN_OCTAVES,
      );
      const rawHeight = Math.round(params.baseHeight + n * params.amplitude);
      const height = clamp(rawHeight, MIN_HEIGHT, MAX_HEIGHT);

      // y = 0 is always bedrock.
      column.setBlock(lx, 0, lz, Blocks.BEDROCK);

      // Stone core: [1, height - 4].
      const stoneTop = height - 4;
      for (let y = 1; y <= stoneTop; y++) {
        column.setBlock(lx, y, lz, Blocks.STONE);
      }

      // Sub-surface: [height - 3, height - 1]. Guard for small heights so we
      // never overwrite bedrock or stretch below y=1.
      const subBottom = Math.max(1, height - 3);
      for (let y = subBottom; y <= height - 1; y++) {
        column.setBlock(lx, y, lz, params.subSurfaceBlock);
      }

      // Surface block at the top.
      let surfaceBlock = params.surfaceBlock;
      // Beach rule: plains/desert shores at/just-above sea level become sand.
      if (
        (biome === "plains" || biome === "desert") &&
        height <= SEA_LEVEL + 1 &&
        height >= SEA_LEVEL - 1
      ) {
        surfaceBlock = Blocks.SAND;
      }
      if (height >= 1) {
        column.setBlock(lx, height, lz, surfaceBlock);
      }

      // Flood below sea level with water.
      if (height < SEA_LEVEL) {
        const top = Math.min(SEA_LEVEL, MAX_Y);
        for (let y = height + 1; y <= top; y++) {
          column.setBlock(lx, y, lz, Blocks.WATER);
        }
      }
    }
  }
}
