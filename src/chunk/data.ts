/**
 * data.ts — `Chunk`: one 16×16×16 voxel section.
 *
 * Pure data container. No Babylon imports, no game logic beyond storage and
 * indexing. Backed by a flat `Uint16Array(16*16*16)` so it is cheap to clone,
 * transfer and serialize.
 *
 * Linear index convention: `idx(x,y,z) = x + y*16 + z*256`, x,y,z each 0..15.
 * This makes x the fastest-varying axis and z the slowest.
 */

import { Blocks, type BlockId } from "../rules/mc-1.20";

/** Edge length of a section along each axis (blocks). */
const SIZE = 16;
/** Total voxels in a section (16³). */
const VOLUME = SIZE * SIZE * SIZE; // 4096
/** Voxels on one face of a section (16²). */
const FACE_AREA = SIZE * SIZE; // 256

/** A face of a section. p = positive (max coord), n = negative (min coord). */
export type FaceDir = "px" | "nx" | "py" | "ny" | "pz" | "nz";

const FACE_DIRS: readonly FaceDir[] = ["px", "nx", "py", "ny", "pz", "nz"];

/** Thrown when a voxel coordinate falls outside 0..15 on any axis. */
export class ChunkOutOfBoundsError extends Error {
  constructor(x: number, y: number, z: number) {
    super(`Chunk coordinate out of bounds: (${x}, ${y}, ${z}) — each of x,y,z must be in 0..15`);
    this.name = "ChunkOutOfBoundsError";
    // Restore prototype chain for `instanceof` under transpiled ES targets.
    Object.setPrototypeOf(this, ChunkOutOfBoundsError.prototype);
  }
}

function inRange(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < SIZE;
}

/** One 16×16×16 voxel section at world section coords (sx, sy, sz). */
export class Chunk {
  /** World section X (one section = 16 blocks). */
  readonly sx: number;
  /** World section Y. */
  readonly sy: number;
  /** World section Z. */
  readonly sz: number;

  /** Flat voxel storage, indexed by {@link idx}. */
  private readonly voxels: Uint16Array;

  /**
   * Cached opposing-face slices from the six neighbor sections, used by the
   * mesher for cross-section face culling. `null` until merged.
   */
  readonly _borders: Record<FaceDir, Uint16Array | null> = {
    px: null,
    nx: null,
    py: null,
    ny: null,
    pz: null,
    nz: null,
  };

  constructor(sx = 0, sy = 0, sz = 0) {
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    this.voxels = new Uint16Array(VOLUME); // zero-filled = all AIR (0)
  }

  /** Linear index for local coordinate (x,y,z), each 0..15. */
  idx(x: number, y: number, z: number): number {
    return x + y * SIZE + z * SIZE * SIZE;
  }

  /** Read the block id at local (x,y,z). Throws if out of range. */
  get(x: number, y: number, z: number): BlockId {
    if (!inRange(x) || !inRange(y) || !inRange(z)) {
      throw new ChunkOutOfBoundsError(x, y, z);
    }
    // idx is always within [0, VOLUME) for in-range coords; the stored values
    // are only ever written from BlockId, so the cast is sound.
    return (this.voxels[this.idx(x, y, z)] ?? Blocks.AIR) as BlockId;
  }

  /** Write the block id at local (x,y,z). Throws if out of range. */
  set(x: number, y: number, z: number, id: BlockId): void {
    if (!inRange(x) || !inRange(y) || !inRange(z)) {
      throw new ChunkOutOfBoundsError(x, y, z);
    }
    this.voxels[this.idx(x, y, z)] = id;
  }

  /** Set every voxel in the section to `id`. */
  fill(id: BlockId): void {
    this.voxels.fill(id);
  }

  /** True iff every voxel is AIR. */
  isEmpty(): boolean {
    for (let i = 0; i < this.voxels.length; i++) {
      if (this.voxels[i] !== Blocks.AIR) return false;
    }
    return true;
  }

  /** Deep, independent copy (voxels + section coords + merged borders). */
  clone(): Chunk {
    const c = new Chunk(this.sx, this.sy, this.sz);
    c.voxels.set(this.voxels);
    for (const dir of FACE_DIRS) {
      const b = this._borders[dir];
      c._borders[dir] = b === null ? null : new Uint16Array(b);
    }
    return c;
  }

  /**
   * Return THIS chunk's own face slice for `dir` as a fresh 256-length array.
   *
   * Indexing convention (the two axes that vary within the plane, in
   * fastest→slowest order, matching the linear sub-index `a + b*16`):
   *  - px / nx: x = 15 / x = 0   plane, indexed by (y, z)  -> y + z*16
   *  - py / ny: y = 15 / y = 0   plane, indexed by (x, z)  -> x + z*16
   *  - pz / nz: z = 15 / z = 0   plane, indexed by (x, y)  -> x + y*16
   */
  getNeighborBorder(dir: FaceDir): Uint16Array {
    const out = new Uint16Array(FACE_AREA);
    const max = SIZE - 1;
    switch (dir) {
      case "px":
      case "nx": {
        const x = dir === "px" ? max : 0;
        for (let z = 0; z < SIZE; z++) {
          for (let y = 0; y < SIZE; y++) {
            out[y + z * SIZE] = this.voxels[this.idx(x, y, z)] ?? Blocks.AIR;
          }
        }
        break;
      }
      case "py":
      case "ny": {
        const y = dir === "py" ? max : 0;
        for (let z = 0; z < SIZE; z++) {
          for (let x = 0; x < SIZE; x++) {
            out[x + z * SIZE] = this.voxels[this.idx(x, y, z)] ?? Blocks.AIR;
          }
        }
        break;
      }
      case "pz":
      case "nz": {
        const z = dir === "pz" ? max : 0;
        for (let y = 0; y < SIZE; y++) {
          for (let x = 0; x < SIZE; x++) {
            out[x + y * SIZE] = this.voxels[this.idx(x, y, z)] ?? Blocks.AIR;
          }
        }
        break;
      }
    }
    return out;
  }

  /**
   * Store a neighbor section's opposing-face slice for cross-section culling.
   * `data` must be exactly 256 long, else throws. A defensive copy is kept.
   */
  mergeNeighborBorder(dir: FaceDir, data: Uint16Array): void {
    if (data.length !== FACE_AREA) {
      throw new Error(
        `mergeNeighborBorder(${dir}): expected ${FACE_AREA} entries, got ${data.length}`,
      );
    }
    this._borders[dir] = new Uint16Array(data);
  }

  /** The merged neighbor border for `dir`, or `null` if none stored. */
  getBorder(dir: FaceDir): Uint16Array | null {
    return this._borders[dir];
  }
}
