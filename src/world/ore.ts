/**
 * ore.ts — deterministic ore-vein generator for a chunk column.
 *
 * Runs AFTER terrain generation (the column is assumed to already contain
 * STONE). For every entry in {@link ORE_TABLE} it scatters `veinsPerChunk`
 * veins of the ore block, replacing ONLY existing STONE so ores can never
 * float in air / dirt / water.
 *
 * Determinism: every random decision is driven by a local mulberry32 PRNG
 * seeded with an integer hash of (seed, columnX, columnZ, oreIndex, veinIndex).
 * No Math.random, no Date — identical output for a given (seed, column).
 */

import { Blocks, ORE_TABLE, type BlockId } from "../rules/mc-1.20";
import type { ChunkColumn } from "../chunk/column";

/** Horizontal section extent (blocks) along x and z. */
const SIZE = 16;
/** Vertical world extent (blocks). Valid worldY is 0..WORLD_HEIGHT-1. */
const WORLD_HEIGHT = 256;
const MAX_Y = WORLD_HEIGHT - 1; // 255

// ---------------------------------------------------------------------------
// PRNG / hashing
// ---------------------------------------------------------------------------

/**
 * Deterministic 32-bit integer mix of an arbitrary list of integers. Folds the
 * inputs together with the well-known xorshift-multiply constants so different
 * argument orderings / values diverge quickly. Returns an unsigned 32-bit int.
 */
function hashInts(...values: readonly number[]): number {
  let h = 0x811c9dc5 >>> 0; // FNV-ish offset basis
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x27d4eb2d) >>> 0;
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
  }
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** A stateful PRNG returning floats in [0, 1). */
type Rng = () => number;

/** mulberry32: tiny, fast, deterministic 32-bit PRNG. Returns [0, 1). */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [lo, hi] inclusive, drawn from `rng`. Assumes lo <= hi. */
function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ---------------------------------------------------------------------------
// bestY-biased vertical sampling
// ---------------------------------------------------------------------------

/**
 * Sample a worldY in [minY, maxY] biased toward `bestY`.
 *
 * Strategy: draw a triangular-ish offset around `bestY` by averaging two
 * uniform samples (sum of two uniforms → triangular peak), scaled to span the
 * larger of the two half-ranges so the full [minY,maxY] band stays reachable.
 * The result is clamped to [minY,maxY], yielding a distribution that peaks at
 * bestY and tapers toward both ends.
 */
function sampleBiasedY(rng: Rng, minY: number, maxY: number, bestY: number): number {
  const lo = Math.max(0, minY);
  const hi = Math.min(MAX_Y, maxY);
  if (hi <= lo) return lo;
  const peak = Math.min(hi, Math.max(lo, bestY));
  // Half-span large enough to reach either edge from the peak.
  const span = Math.max(peak - lo, hi - peak);
  // Triangular noise in [-1, 1] (peaks at 0): average of two uniforms.
  const tri = rng() + rng() - 1;
  const y = Math.round(peak + tri * span);
  if (y < lo) return lo;
  if (y > hi) return hi;
  return y;
}

// ---------------------------------------------------------------------------
// Neighbor / exposure helpers
// ---------------------------------------------------------------------------

const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * True iff any of the 6 axis neighbors of (lx, worldY, lz) is AIR. Out-of-bounds
 * neighbors (outside this column) are treated as non-air, since neighboring
 * columns are presumed solid stone at these depths — this keeps the check
 * conservative and self-contained.
 */
function hasAirNeighbor(column: ChunkColumn, lx: number, worldY: number, lz: number): boolean {
  for (const [dx, dy, dz] of NEIGHBORS) {
    const nx = lx + dx;
    const ny = worldY + dy;
    const nz = lz + dz;
    if (nx < 0 || nx >= SIZE || nz < 0 || nz >= SIZE || ny < 0 || ny > MAX_Y) {
      continue;
    }
    if (column.getBlock(nx, ny, nz) === Blocks.AIR) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/**
 * Attempt to place `ore` at (lx, worldY, lz). Only succeeds if the target is
 * currently STONE. Applies the EC9 air-exposure penalty for DIAMOND_ORE: when
 * any neighbor is AIR the block is placed with only 50% probability, decided
 * deterministically from `rng`.
 */
function tryPlace(
  column: ChunkColumn,
  lx: number,
  worldY: number,
  lz: number,
  ore: BlockId,
  rng: Rng,
): void {
  if (lx < 0 || lx >= SIZE || lz < 0 || lz >= SIZE || worldY < 0 || worldY > MAX_Y) {
    return;
  }
  if (column.getBlock(lx, worldY, lz) !== Blocks.STONE) return;

  if (ore === Blocks.DIAMOND_ORE && hasAirNeighbor(column, lx, worldY, lz)) {
    // EC9: exposed diamond only placed half the time. Draw the gate
    // unconditionally so the PRNG stream stays aligned regardless of geometry.
    if (rng() < 0.5) return;
  }

  column.setBlock(lx, worldY, lz, ore);
}

/**
 * Scatter ~`veinSize` ore blocks in a compact cluster around (cx, cy, cz) via a
 * bounded random walk. The walk starts at the center and takes small steps,
 * trying to place ore at each visited voxel.
 */
function placeVein(
  column: ChunkColumn,
  ore: BlockId,
  veinSize: number,
  cx: number,
  cy: number,
  cz: number,
  rng: Rng,
): void {
  let x = cx;
  let y = cy;
  let z = cz;
  for (let i = 0; i < veinSize; i++) {
    tryPlace(column, x, y, z, ore, rng);
    // Step to a random axis neighbor for the next placement (cluster growth).
    const dir = NEIGHBORS[randInt(rng, 0, NEIGHBORS.length - 1)] ?? NEIGHBORS[0];
    if (dir !== undefined) {
      x += dir[0];
      y += dir[1];
      z += dir[2];
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Generate all ore veins into `column` for the given world `seed`. Mutates the
 * column in place, replacing only STONE voxels. Run AFTER terrain generation.
 */
export function generateOres(column: ChunkColumn, seed: number): void {
  for (let oreIndex = 0; oreIndex < ORE_TABLE.length; oreIndex++) {
    const entry = ORE_TABLE[oreIndex];
    if (entry === undefined) continue;
    const { block, minY, maxY, bestY, veinSize, veinsPerChunk } = entry;

    for (let veinIndex = 0; veinIndex < veinsPerChunk; veinIndex++) {
      const rng = mulberry32(
        hashInts(seed, column.columnX, column.columnZ, oreIndex, veinIndex),
      );
      const cx = randInt(rng, 0, SIZE - 1);
      const cz = randInt(rng, 0, SIZE - 1);
      const cy = sampleBiasedY(rng, minY, maxY, bestY);
      placeVein(column, block, veinSize, cx, cy, cz, rng);
    }
  }
}
