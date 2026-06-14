/**
 * biome.ts — biome classification for world generation.
 *
 * Biomes are derived from two low-frequency 2D noise fields (a "temperature"
 * field and a "humidity" field). Using a low frequency makes biomes form large
 * contiguous regions instead of speckled noise. Each field is split at its
 * median (0) into two halves, giving a roughly even 2×2 = 4-way split across
 * the four biomes.
 */

import { Blocks, type BlockId } from "../rules/mc-1.20";
import { makeNoise2D, type NoiseFn2D } from "./noise";

export type Biome = "plains" | "forest" | "desert" | "snow";

/** Low frequency => large contiguous biome regions (~one biome per ~250 blocks). */
const BIOME_FREQ = 1 / 256;

/**
 * Offset the humidity field's seed so it is statistically independent of the
 * temperature field; otherwise both fields would correlate and only two of the
 * four biomes would ever appear.
 */
const HUMIDITY_SEED_OFFSET = 0x9e3779b1;

/** Cache one noise pair per seed so repeated calls don't rebuild permutation tables. */
const noiseCache = new Map<number, { temp: NoiseFn2D; humid: NoiseFn2D }>();

function noisesFor(seed: number): { temp: NoiseFn2D; humid: NoiseFn2D } {
  const key = seed >>> 0;
  const cached = noiseCache.get(key);
  if (cached !== undefined) return cached;
  const pair = {
    temp: makeNoise2D(key),
    humid: makeNoise2D((key + HUMIDITY_SEED_OFFSET) >>> 0),
  };
  noiseCache.set(key, pair);
  return pair;
}

/**
 * Classify the biome at world (x, z) for the given seed.
 *
 * temperature high + humidity low  -> desert (hot & dry)
 * temperature high + humidity high -> plains (hot & wet)
 * temperature low  + humidity low  -> snow   (cold & dry)
 * temperature low  + humidity high -> forest (cold & wet)
 */
export function getBiome(worldX: number, worldZ: number, seed: number): Biome {
  const { temp, humid } = noisesFor(seed);
  const t = temp(worldX * BIOME_FREQ, worldZ * BIOME_FREQ);
  const h = humid(worldX * BIOME_FREQ, worldZ * BIOME_FREQ);
  const hot = t >= 0;
  const wet = h >= 0;
  if (hot) return wet ? "plains" : "desert";
  return wet ? "forest" : "snow";
}

export interface BiomeParams {
  surfaceBlock: BlockId;
  subSurfaceBlock: BlockId;
  baseHeight: number;
  amplitude: number;
}

const PARAMS: Record<Biome, BiomeParams> = {
  desert: {
    surfaceBlock: Blocks.SAND,
    subSurfaceBlock: Blocks.SAND,
    baseHeight: 66,
    amplitude: 4,
  },
  plains: {
    surfaceBlock: Blocks.GRASS,
    subSurfaceBlock: Blocks.DIRT,
    baseHeight: 68,
    amplitude: 10,
  },
  forest: {
    surfaceBlock: Blocks.GRASS,
    subSurfaceBlock: Blocks.DIRT,
    baseHeight: 70,
    amplitude: 18,
  },
  snow: {
    surfaceBlock: Blocks.SNOW,
    subSurfaceBlock: Blocks.DIRT,
    baseHeight: 72,
    amplitude: 26,
  },
};

/** Height/material profile for a biome. Pure: returns a fresh copy each call. */
export function biomeParams(b: Biome): BiomeParams {
  const p = PARAMS[b];
  return {
    surfaceBlock: p.surfaceBlock,
    subSurfaceBlock: p.subSurfaceBlock,
    baseHeight: p.baseHeight,
    amplitude: p.amplitude,
  };
}
