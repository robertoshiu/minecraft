/**
 * world.ts — the World access layer (keystone).
 *
 * Wraps a sparse `Map<"cx,cz", ChunkColumn>` and exposes block reads/writes in
 * absolute WORLD coordinates, hiding the column/section/local-coordinate math
 * from every consumer (player physics, raycasting, the renderer, edits).
 *
 * Columns are generated lazily on demand via {@link generateColumn} and cached.
 * Out-of-range vertical reads and reads in not-yet-generated columns resolve to
 * AIR (so the player can stand at the world edge / sky without crashing).
 *
 * The column-key format is `"cx,cz"` and MUST match the renderer's key format
 * so both layers agree on which column owns a given world coordinate.
 *
 * Pure logic — no Babylon imports.
 */

import { ChunkColumn } from "../chunk/column";
import { Blocks, type BlockId } from "../rules/mc-1.20";
import { isSolid } from "../rules/block-registry";
import { generateColumn } from "./generate";

/** Horizontal column extent (blocks) along x and z. */
const COLUMN_SIZE = 16;
/** Vertical world extent (blocks); valid worldY is [0, WORLD_HEIGHT). */
const WORLD_HEIGHT = 256;

/** worldX/worldZ → column index (one column = 16 blocks). */
function toColumn(world: number): number {
  return Math.floor(world / COLUMN_SIZE);
}

/** worldX/worldZ → local 0..15 within its column (handles negatives). */
function toLocal(world: number): number {
  return ((world % COLUMN_SIZE) + COLUMN_SIZE) % COLUMN_SIZE;
}

/** Is `worldY` inside the playable vertical range 0..255? */
function inHeight(worldY: number): boolean {
  return Number.isInteger(worldY) && worldY >= 0 && worldY < WORLD_HEIGHT;
}

/**
 * Sparse voxel world keyed by column. All public reads/writes use absolute
 * world coordinates; the class resolves the owning column + local coords.
 */
export class World {
  /** Deterministic world seed (drives lazy column generation). */
  readonly seed: number;
  /** Live column store, keyed by {@link World.columnKey}. */
  readonly columns: Map<string, ChunkColumn>;

  /** Registered column-loaded listeners. */
  private readonly _columnLoadedListeners = new Set<(cx: number, cz: number) => void>();

  /**
   * When true, ensureColumn will NOT fire column-loaded listeners even for
   * freshly generated columns. Used to suppress duplicate remesh when a
   * setBlock call generates a column that the blockChanged path already handles.
   */
  suppressColumnLoaded = false;

  constructor(seed: number, columns?: Map<string, ChunkColumn>) {
    this.seed = seed;
    this.columns = columns ?? new Map<string, ChunkColumn>();
  }

  /**
   * Register a listener that fires whenever a column is freshly generated
   * (i.e. was absent before ensureColumn was called). Returns an unsubscribe
   * function that removes the listener.
   */
  subscribeColumnLoaded(fn: (cx: number, cz: number) => void): () => void {
    this._columnLoadedListeners.add(fn);
    return () => {
      this._columnLoadedListeners.delete(fn);
    };
  }

  /** Map key for a column at (cx, cz). MUST match the renderer's format. */
  static columnKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  /** The stored column at (cx, cz), or undefined if not generated yet. */
  getColumn(cx: number, cz: number): ChunkColumn | undefined {
    return this.columns.get(World.columnKey(cx, cz));
  }

  /**
   * Return the column at (cx, cz), generating + caching it via
   * {@link generateColumn} if it does not exist yet.
   *
   * Fires all registered column-loaded listeners when the column is freshly
   * generated (was absent before this call), unless {@link suppressColumnLoaded}
   * is true. Cache hits (column already existed) do NOT fire listeners.
   */
  ensureColumn(cx: number, cz: number): ChunkColumn {
    const key = World.columnKey(cx, cz);
    const existing = this.columns.get(key);
    const wasFresh = existing === undefined;
    let column: ChunkColumn;
    if (wasFresh) {
      column = generateColumn(cx, cz, this.seed);
      this.columns.set(key, column);
    } else {
      column = existing;
    }
    if (wasFresh && !this.suppressColumnLoaded && this._columnLoadedListeners.size > 0) {
      for (const fn of this._columnLoadedListeners) {
        fn(cx, cz);
      }
    }
    return column;
  }

  /**
   * Read the block at absolute world coords. Out-of-range Y or a not-yet
   * generated column resolves to AIR (does NOT generate the column).
   */
  getBlock(wx: number, wy: number, wz: number): BlockId {
    if (!inHeight(wy)) return Blocks.AIR;
    const column = this.getColumn(toColumn(wx), toColumn(wz));
    if (column === undefined) return Blocks.AIR;
    return column.getBlock(toLocal(wx), wy, toLocal(wz));
  }

  /**
   * Write a block at absolute world coords, ensuring the owning column exists
   * first. Out-of-range Y is silently ignored (nothing to write to).
   *
   * The ensureColumn call is wrapped in suppressColumnLoaded so that a block
   * write into an ungenerated column does NOT fire the column-loaded listener —
   * the existing blockChanged path already handles remeshing in this case.
   */
  setBlock(wx: number, wy: number, wz: number, id: BlockId): void {
    if (!inHeight(wy)) return;
    const prevSuppress = this.suppressColumnLoaded;
    this.suppressColumnLoaded = true;
    let column: ChunkColumn;
    try {
      column = this.ensureColumn(toColumn(wx), toColumn(wz));
    } finally {
      this.suppressColumnLoaded = prevSuppress;
    }
    column.setBlock(toLocal(wx), wy, toLocal(wz), id);
  }

  /** True iff the block at absolute world coords has collision. */
  isSolidAt(wx: number, wy: number, wz: number): boolean {
    return isSolid(this.getBlock(wx, wy, wz));
  }
}
