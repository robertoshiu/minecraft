/**
 * serialize.ts — binary serialization for the save system.
 *
 * Voxel data is encoded as raw little-endian `Uint16Array` bytes (NO JSON for
 * voxels — 4096 cells per section × 16 sections × N columns is far too much for
 * a JSON encode). The player record is small and irregular, so it is encoded
 * with a compact structured binary writer/reader rather than typed-array bulk.
 *
 * Endianness: every multi-byte field is written little-endian explicitly via
 * `DataView`, so saves are portable across host architectures (typed-array
 * `.buffer` views would otherwise inherit host endianness).
 *
 * Pure data ↔ bytes. No Babylon, no game logic beyond storage layout.
 */

import { ChunkColumn } from "../chunk/column";
import { type BlockId } from "../rules/mc-1.20";
import { type MobSave } from "../mobs/persistence";

// ---------------------------------------------------------------------------
// Public save shapes
// ---------------------------------------------------------------------------

/** Persisted player state. `inventory` slots may be empty (`null`). */
export interface PlayerSave {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  food: number;
  saturation: number;
  selectedSlot: number;
  inventory: (ItemStackSave | null)[];
  /** Bed spawn point. Added in save v3; absent in older saves (migrated with defaults). */
  spawnX: number;
  spawnY: number;
  spawnZ: number;
}

/** A single inventory slot's item. Tools carry durability; most items don't. */
export interface ItemStackSave {
  itemId: number;
  count: number;
  maxStack: number;
  durability?: number;
  maxDurability?: number;
}

/**
 * A complete world save. `columns` is keyed `"cx,cz"`; each value is the
 * binary-encoded bytes produced by {@link serializeColumn}.
 *
 * `mobs` (added in save v2) is the live-mob snapshot. It is optional so v1 saves
 * (which had no mobs) decode cleanly; an absent value is treated as `[]`.
 */
export interface WorldSave {
  version: number;
  seed: number;
  totalTicks: number;
  player: PlayerSave;
  columns: Record<string, Uint8Array>;
  mobs?: MobSave[];
}

// ---------------------------------------------------------------------------
// Column geometry (mirrors src/chunk)
// ---------------------------------------------------------------------------

const SIZE = 16;
const SECTION_COUNT = 16;
const WORLD_HEIGHT = SIZE * SECTION_COUNT; // 256
const SECTION_VOLUME = SIZE * SIZE * SIZE; // 4096
const COLUMN_CELLS = SECTION_VOLUME * SECTION_COUNT; // 65536 voxels

/** Magic + format version for a single serialized column. */
const COLUMN_MAGIC = 0x4d43_4f4c; // "MCOL" (Minecraft COLumn), as a u32
const COLUMN_FORMAT = 1;
/** Header: magic(u32) + format(u16) + columnX(i32) + columnZ(i32). */
const COLUMN_HEADER_BYTES = 4 + 2 + 4 + 4;

// ---------------------------------------------------------------------------
// Column serialization (binary, byte-exact round trip)
// ---------------------------------------------------------------------------

/**
 * Encode a {@link ChunkColumn} to bytes. Layout:
 *
 *   [magic u32][format u16][columnX i32][columnZ i32]
 *   [ 65536 × u16 voxels, little-endian ]
 *
 * Voxel ordering matches the in-section linear index `x + y*16 + z*256`, with
 * sections stacked low→high (section 0 first), i.e. world index
 * `x + worldY*256 + z*256*256` is NOT used; instead we iterate section-major so
 * the bytes line up 1:1 with the underlying `Uint16Array(4096)` per section.
 */
export function serializeColumn(col: ChunkColumn): Uint8Array {
  const totalBytes = COLUMN_HEADER_BYTES + COLUMN_CELLS * 2;
  const buf = new ArrayBuffer(totalBytes);
  const view = new DataView(buf);

  let off = 0;
  view.setUint32(off, COLUMN_MAGIC, true);
  off += 4;
  view.setUint16(off, COLUMN_FORMAT, true);
  off += 2;
  view.setInt32(off, col.columnX, true);
  off += 4;
  view.setInt32(off, col.columnZ, true);
  off += 4;

  // Section-major, then in-section z→y→x (x fastest), matching the chunk's
  // linear index so a future raw-buffer fast path stays compatible.
  for (let sy = 0; sy < SECTION_COUNT; sy++) {
    const baseY = sy * SIZE;
    for (let z = 0; z < SIZE; z++) {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const id = col.getBlock(x, baseY + y, z);
          view.setUint16(off, id, true);
          off += 2;
        }
      }
    }
  }

  return new Uint8Array(buf);
}

/** Exact inverse of {@link serializeColumn}; reconstructs a {@link ChunkColumn}. */
export function deserializeColumn(bytes: Uint8Array): ChunkColumn {
  const expected = COLUMN_HEADER_BYTES + COLUMN_CELLS * 2;
  if (bytes.byteLength !== expected) {
    throw new Error(
      `deserializeColumn: expected ${expected} bytes, got ${bytes.byteLength}`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let off = 0;
  const magic = view.getUint32(off, true);
  off += 4;
  if (magic !== COLUMN_MAGIC) {
    throw new Error(
      `deserializeColumn: bad magic 0x${magic.toString(16)} (expected 0x${COLUMN_MAGIC.toString(16)})`,
    );
  }
  const format = view.getUint16(off, true);
  off += 2;
  if (format !== COLUMN_FORMAT) {
    throw new Error(
      `deserializeColumn: unsupported column format ${format} (expected ${COLUMN_FORMAT})`,
    );
  }
  const columnX = view.getInt32(off, true);
  off += 4;
  const columnZ = view.getInt32(off, true);
  off += 4;

  const col = new ChunkColumn(columnX, columnZ);
  for (let sy = 0; sy < SECTION_COUNT; sy++) {
    const baseY = sy * SIZE;
    for (let z = 0; z < SIZE; z++) {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const id = view.getUint16(off, true) as BlockId;
          off += 2;
          col.setBlock(x, baseY + y, z, id);
        }
      }
    }
  }

  return col;
}

// ---------------------------------------------------------------------------
// Full-save serialization
// ---------------------------------------------------------------------------

const SAVE_MAGIC = 0x4d43_5357; // "MCSW" (Minecraft Save World), as a u32
/**
 * Container format version.
 *  - 1: header + player + binary columns.
 *  - 2: …plus a trailing length-prefixed JSON {@link MobSave}[] blob.
 *  - 3: …plus spawnX/spawnY/spawnZ (f64×3) appended at the end of the player record.
 * Older containers are still readable (spawn defaults to the player position).
 */
const SAVE_FORMAT = 3;
/** The lowest container format this build can still decode. */
const SAVE_FORMAT_MIN = 1;

/**
 * A growable little-endian binary writer. Avoids dragging in a dependency; all
 * fields are explicit-endian via `DataView`.
 */
class ByteWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private len = 0;

  constructor(initial = 1024) {
    this.buf = new ArrayBuffer(initial);
    this.view = new DataView(this.buf);
  }

  private ensure(extra: number): void {
    const need = this.len + extra;
    if (need <= this.buf.byteLength) return;
    let cap = this.buf.byteLength * 2;
    while (cap < need) cap *= 2;
    const next = new ArrayBuffer(cap);
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.len));
    this.buf = next;
    this.view = new DataView(this.buf);
  }

  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.len, v);
    this.len += 1;
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.len, v, true);
    this.len += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.len, v >>> 0, true);
    this.len += 4;
  }

  i32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.len, v, true);
    this.len += 4;
  }

  /** A double-precision float (covers seed, ticks, coords, etc. losslessly). */
  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.len, v, true);
    this.len += 8;
  }

  /** Length-prefixed (u32) raw bytes. */
  bytes(b: Uint8Array): void {
    this.u32(b.byteLength);
    this.ensure(b.byteLength);
    new Uint8Array(this.buf).set(b, this.len);
    this.len += b.byteLength;
  }

  /** Length-prefixed (u32) UTF-8 string. */
  str(s: string): void {
    this.bytes(new TextEncoder().encode(s));
  }

  finish(): Uint8Array {
    return new Uint8Array(this.buf.slice(0, this.len));
  }
}

/** Matching little-endian reader. */
class ByteReader {
  private view: DataView;
  private off = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(): number {
    const v = this.view.getUint8(this.off);
    this.off += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v;
  }

  i32(): number {
    const v = this.view.getInt32(this.off, true);
    this.off += 4;
    return v;
  }

  f64(): number {
    const v = this.view.getFloat64(this.off, true);
    this.off += 8;
    return v;
  }

  readBytes(): Uint8Array {
    const n = this.u32();
    const slice = this.bytes.subarray(this.off, this.off + n);
    this.off += n;
    // Copy so the returned array is independent of the backing buffer.
    return new Uint8Array(slice);
  }

  str(): string {
    return new TextDecoder().decode(this.readBytes());
  }
}

// Inventory slot flags.
const SLOT_EMPTY = 0;
const SLOT_PRESENT = 1;
// Durability presence flags within a present slot.
const DURABILITY_ABSENT = 0;
const DURABILITY_PRESENT = 1;

function writePlayer(w: ByteWriter, p: PlayerSave): void {
  w.f64(p.x);
  w.f64(p.y);
  w.f64(p.z);
  w.f64(p.yaw);
  w.f64(p.pitch);
  w.f64(p.health);
  w.f64(p.food);
  w.f64(p.saturation);
  w.i32(p.selectedSlot);

  w.u32(p.inventory.length);
  for (const slot of p.inventory) {
    if (slot === null) {
      w.u8(SLOT_EMPTY);
      continue;
    }
    w.u8(SLOT_PRESENT);
    w.i32(slot.itemId);
    w.i32(slot.count);
    w.i32(slot.maxStack);
    const hasDur =
      slot.durability !== undefined && slot.maxDurability !== undefined;
    if (hasDur) {
      w.u8(DURABILITY_PRESENT);
      w.i32(slot.durability ?? 0);
      w.i32(slot.maxDurability ?? 0);
    } else {
      w.u8(DURABILITY_ABSENT);
    }
  }

  // Spawn point (added in save v3).
  w.f64(p.spawnX);
  w.f64(p.spawnY);
  w.f64(p.spawnZ);
}

function readPlayer(r: ByteReader, containerFormat: number): PlayerSave {
  const x = r.f64();
  const y = r.f64();
  const z = r.f64();
  const yaw = r.f64();
  const pitch = r.f64();
  const health = r.f64();
  const food = r.f64();
  const saturation = r.f64();
  const selectedSlot = r.i32();

  const slotCount = r.u32();
  const inventory: (ItemStackSave | null)[] = [];
  for (let i = 0; i < slotCount; i++) {
    const present = r.u8();
    if (present === SLOT_EMPTY) {
      inventory.push(null);
      continue;
    }
    const itemId = r.i32();
    const count = r.i32();
    const maxStack = r.i32();
    const durFlag = r.u8();
    if (durFlag === DURABILITY_PRESENT) {
      const durability = r.i32();
      const maxDurability = r.i32();
      inventory.push({ itemId, count, maxStack, durability, maxDurability });
    } else {
      inventory.push({ itemId, count, maxStack });
    }
  }

  // Spawn point (added in container format 3 / save v3).
  // Older containers default spawn to the player's current position.
  let spawnX = x;
  let spawnY = y;
  let spawnZ = z;
  if (containerFormat >= 3) {
    spawnX = r.f64();
    spawnY = r.f64();
    spawnZ = r.f64();
  }

  return {
    x,
    y,
    z,
    yaw,
    pitch,
    health,
    food,
    saturation,
    selectedSlot,
    inventory,
    spawnX,
    spawnY,
    spawnZ,
  };
}

/** Encode an entire {@link WorldSave} (header + player + binary columns). */
export function serializeSave(save: WorldSave): Uint8Array {
  const w = new ByteWriter();
  w.u32(SAVE_MAGIC);
  w.u16(SAVE_FORMAT);
  w.i32(save.version);
  w.f64(save.seed);
  w.f64(save.totalTicks);

  writePlayer(w, save.player);

  const entries = Object.entries(save.columns);
  w.u32(entries.length);
  for (const [key, bytes] of entries) {
    w.str(key);
    w.bytes(bytes);
  }

  // Mobs (container format 2+): a length-prefixed UTF-8 JSON array of MobSave.
  w.str(JSON.stringify(save.mobs ?? []));

  return w.finish();
}

/** Exact inverse of {@link serializeSave}. */
export function deserializeSave(bytes: Uint8Array): WorldSave {
  const r = new ByteReader(bytes);
  const magic = r.u32();
  if (magic !== SAVE_MAGIC) {
    throw new Error(
      `deserializeSave: bad magic 0x${magic.toString(16)} (expected 0x${SAVE_MAGIC.toString(16)})`,
    );
  }
  const format = r.u16();
  if (format < SAVE_FORMAT_MIN || format > SAVE_FORMAT) {
    throw new Error(
      `deserializeSave: unsupported save container format ${format} ` +
        `(supported ${SAVE_FORMAT_MIN}..${SAVE_FORMAT})`,
    );
  }
  const version = r.i32();
  const seed = r.f64();
  const totalTicks = r.f64();

  const player = readPlayer(r, format);

  const columnCount = r.u32();
  const columns: Record<string, Uint8Array> = {};
  for (let i = 0; i < columnCount; i++) {
    const key = r.str();
    columns[key] = r.readBytes();
  }

  // Mobs trail the columns from container format 2 onward; a v1 container has
  // none, so it decodes to an empty list.
  let mobs: MobSave[] = [];
  if (format >= 2) {
    const parsed: unknown = JSON.parse(r.str());
    if (!Array.isArray(parsed)) {
      throw new Error("deserializeSave: mobs blob is not a JSON array");
    }
    mobs = parsed as MobSave[];
  }

  return { version, seed, totalTicks, player, columns, mobs };
}

export {
  SIZE as COLUMN_SIZE,
  WORLD_HEIGHT as COLUMN_HEIGHT,
  SECTION_COUNT,
};
