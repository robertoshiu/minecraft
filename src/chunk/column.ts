/**
 * column.ts — `ChunkColumn`: one 16×16 world column, 256 blocks tall.
 *
 * A column is 16 stacked {@link Chunk} sections (section sy in 0..15 covers
 * world Y in [sy*16, sy*16+15]). World Y is split into section + local with
 * `worldY >> 4` (section) and `worldY & 15` (local y).
 *
 * Pure data container. No Babylon imports.
 */

import { Blocks, type BlockId } from "../rules/mc-1.20";
import { Chunk, ChunkOutOfBoundsError } from "./data";

/** Horizontal section extent (blocks) along x and z. */
const SIZE = 16;
/** Number of stacked sections in a column. */
const SECTION_COUNT = 16;
/** Vertical world extent (blocks). */
const WORLD_HEIGHT = SIZE * SECTION_COUNT; // 256

function inHoriz(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < SIZE;
}

function inHeight(worldY: number): boolean {
  return Number.isInteger(worldY) && worldY >= 0 && worldY < WORLD_HEIGHT;
}

/** A 16×16 world column at integer column coords (columnX, columnZ). */
export class ChunkColumn {
  /** Column X in column units (one column = 16 blocks). */
  readonly columnX: number;
  /** Column Z in column units. */
  readonly columnZ: number;

  /** The 16 stacked sections, index = section sy (0..15). */
  readonly sections: Chunk[];

  constructor(columnX: number, columnZ: number) {
    this.columnX = columnX;
    this.columnZ = columnZ;
    this.sections = [];
    for (let sy = 0; sy < SECTION_COUNT; sy++) {
      this.sections.push(new Chunk(columnX, sy, columnZ));
    }
  }

  /** Resolve a section by world Y, throwing if the column is malformed. */
  private sectionAt(worldY: number): Chunk {
    const section = this.sections[worldY >> 4];
    if (section === undefined) {
      // Unreachable for in-range worldY given eager construction, but keeps the
      // type narrow under noUncheckedIndexedAccess.
      throw new ChunkOutOfBoundsError(0, worldY, 0);
    }
    return section;
  }

  /** Read the block at local (lx, lz) and absolute worldY (0..255). */
  getBlock(lx: number, worldY: number, lz: number): BlockId {
    if (!inHoriz(lx) || !inHoriz(lz) || !inHeight(worldY)) {
      throw new ChunkOutOfBoundsError(lx, worldY, lz);
    }
    return this.sectionAt(worldY).get(lx, worldY & 15, lz);
  }

  /** Write the block at local (lx, lz) and absolute worldY (0..255). */
  setBlock(lx: number, worldY: number, lz: number, id: BlockId): void {
    if (!inHoriz(lx) || !inHoriz(lz) || !inHeight(worldY)) {
      throw new ChunkOutOfBoundsError(lx, worldY, lz);
    }
    this.sectionAt(worldY).set(lx, worldY & 15, lz, id);
  }

  /**
   * Highest worldY at (lx, lz) whose block is not AIR, or -1 if the entire
   * column at that position is air.
   */
  surfaceHeight(lx: number, lz: number): number {
    if (!inHoriz(lx) || !inHoriz(lz)) {
      throw new ChunkOutOfBoundsError(lx, 0, lz);
    }
    for (let worldY = WORLD_HEIGHT - 1; worldY >= 0; worldY--) {
      if (this.sectionAt(worldY).get(lx, worldY & 15, lz) !== Blocks.AIR) {
        return worldY;
      }
    }
    return -1;
  }

  /** Fill the entire 16×16 horizontal plane at `worldY` with `id`. */
  fillLayer(worldY: number, id: BlockId): void {
    if (!inHeight(worldY)) {
      throw new ChunkOutOfBoundsError(0, worldY, 0);
    }
    const section = this.sectionAt(worldY);
    const ly = worldY & 15;
    for (let lz = 0; lz < SIZE; lz++) {
      for (let lx = 0; lx < SIZE; lx++) {
        section.set(lx, ly, lz, id);
      }
    }
  }
}
