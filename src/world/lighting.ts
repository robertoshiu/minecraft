/**
 * lighting.ts — L3 column-only skylight.
 *
 * Computes skylight for one {@link ChunkColumn} using the simplest correct
 * model: light comes straight down from the sky and is stopped by the first
 * opaque block. There is NO horizontal flood-fill here — that is the job of a
 * later lighting pass (L4+). Skylight only travels vertically.
 *
 * For each (lx, lz) column we walk worldY from the top (255) to the bottom (0)
 * holding a "current" skylight level that starts at {@link LIGHT.SKY_MAX} (15):
 *  - While no opaque block has been seen, the cell is open to the sky -> 15.
 *  - The first opaque block encountered, and every cell beneath it, is 0
 *    (opaque blocks stop the vertical beam; with no horizontal spread, the
 *    interior stays dark).
 *  - Non-opaque blocks above the highest opaque block (air/water/glass/leaves)
 *    do not block the beam and stay 15.
 *
 * This satisfies the mob-spawn rules: open/surface cells are 15 (>= PASSIVE_MIN)
 * and cells below the first opaque block are 0 (<= HOSTILE_MAX).
 *
 * Pure: no Babylon imports, no Math.random, no Date. Deterministic.
 */

import { LIGHT, CHUNK, type BlockId } from "../rules/mc-1.20";
import type { ChunkColumn } from "../chunk/column";
import { isOpaque } from "../rules/block-registry";

/**
 * Flat skylight buffer for one column. Length `16*16*256`; values are 0..15.
 * Linear index = `lx + lz*16 + worldY*256` (lx fastest, then lz, then worldY).
 */
export type LightMap = Uint8Array;

/** Horizontal column extent (blocks) along x and z. */
const SIZE = CHUNK.SIZE; // 16
/** Vertical world extent (blocks). Valid worldY is 0..HEIGHT-1. */
const HEIGHT = CHUNK.HEIGHT; // 256
/** Total cells in a column's light map (16*16*256). */
const VOLUME = SIZE * SIZE * HEIGHT;

/** Linear index into a {@link LightMap}: lx fastest, then lz, then worldY. */
function lightIndex(lx: number, worldY: number, lz: number): number {
  return lx + lz * SIZE + worldY * SIZE * SIZE;
}

function inHoriz(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < SIZE;
}

function inHeight(worldY: number): boolean {
  return Number.isInteger(worldY) && worldY >= 0 && worldY < HEIGHT;
}

/**
 * Compute the column-only skylight for `column`.
 *
 * Returns a fresh {@link LightMap}. See the file header for the exact semantics.
 */
export function computeColumnSkylight(column: ChunkColumn): LightMap {
  const map: LightMap = new Uint8Array(VOLUME);

  for (let lx = 0; lx < SIZE; lx++) {
    for (let lz = 0; lz < SIZE; lz++) {
      // Walk top -> bottom. `blocked` flips true at (and stays true below) the
      // highest opaque block in this column.
      let blocked = false;
      for (let worldY = HEIGHT - 1; worldY >= 0; worldY--) {
        if (!blocked) {
          const id: BlockId = column.getBlock(lx, worldY, lz);
          if (isOpaque(id)) {
            blocked = true;
          }
        }
        map[lightIndex(lx, worldY, lz)] = blocked ? 0 : LIGHT.SKY_MAX;
      }
    }
  }

  return map;
}

/**
 * Bounds-checked skylight read at (lx, worldY, lz).
 *
 * @throws RangeError if lx/lz are not integers in 0..15, or worldY is not an
 *   integer in 0..255.
 */
export function skylightAt(map: LightMap, lx: number, worldY: number, lz: number): number {
  if (!inHoriz(lx) || !inHoriz(lz) || !inHeight(worldY)) {
    throw new RangeError(
      `skylightAt: out of range (lx=${lx}, worldY=${worldY}, lz=${lz}); ` +
        `lx,lz must be integers 0..${SIZE - 1} and worldY an integer 0..${HEIGHT - 1}`,
    );
  }
  // The index is always within [0, VOLUME) for in-range coords, but
  // noUncheckedIndexedAccess widens the read to `number | undefined`.
  return map[lightIndex(lx, worldY, lz)] ?? 0;
}
