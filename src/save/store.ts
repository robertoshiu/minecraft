/**
 * store.ts — storage abstraction + TRUE atomic write (review U3).
 *
 * IndexedDB has NO rename primitive, so the classic "write temp, rename over
 * target" atomicity trick is impossible. Instead {@link atomicWrite} performs a
 * multi-key dance that keeps a recoverable copy at every moment:
 *
 *   1. write `${key}.tmp`            (new value parked aside)
 *   2. if `${key}` exists, copy it → `${key}.bak`   (preserve the old good copy)
 *   3. write `${key}` = value        (commit)
 *   4. delete `${key}.tmp`           (cleanup)
 *
 * If a crash interrupts step 3, the previous good value survives at `${key}`
 * (untouched) AND at `${key}.bak`. {@link safeRead} reads `${key}` and falls
 * back to `${key}.bak` if the primary is missing/empty, so a torn write is
 * always recoverable.
 */

/** Minimal key→bytes store. All ops async (mirrors IndexedDB). */
export interface SaveStore {
  put(key: string, value: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// MemoryStore — for tests and ephemeral use
// ---------------------------------------------------------------------------

/** In-memory {@link SaveStore} backed by a `Map`. Values are defensively copied. */
export class MemoryStore implements SaveStore {
  private readonly map = new Map<string, Uint8Array>();

  put(key: string, value: Uint8Array): Promise<void> {
    // Copy so external mutation of the source array can't corrupt the store.
    this.map.set(key, new Uint8Array(value));
    return Promise.resolve();
  }

  get(key: string): Promise<Uint8Array | null> {
    const v = this.map.get(key);
    return Promise.resolve(v === undefined ? null : new Uint8Array(v));
  }

  delete(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.map.keys()]);
  }
}

// ---------------------------------------------------------------------------
// Atomic write + safe read
// ---------------------------------------------------------------------------

/** Suffix for the in-flight temp copy. */
const TMP_SUFFIX = ".tmp";
/** Suffix for the backup of the previous good copy. */
const BAK_SUFFIX = ".bak";

/**
 * Atomically write `value` to `key` using the .tmp → .bak → final → delete
 * dance described in the module header. Safe against mid-write crashes when
 * paired with {@link safeRead}.
 */
export async function atomicWrite(
  store: SaveStore,
  key: string,
  value: Uint8Array,
): Promise<void> {
  const tmpKey = key + TMP_SUFFIX;
  const bakKey = key + BAK_SUFFIX;

  // (1) Park the new value aside.
  await store.put(tmpKey, value);

  // (2) Preserve the current good copy as a backup, if one exists.
  const existing = await store.get(key);
  if (existing !== null && existing.byteLength > 0) {
    await store.put(bakKey, existing);
  }

  // (3) Commit the new value to the canonical key.
  await store.put(key, value);

  // (4) Clean up the temp copy. The .bak intentionally remains as the
  //     last-known-good fallback for the next write / a crash before then.
  await store.delete(tmpKey);
}

/**
 * Read `key`, falling back to `${key}.bak` if the primary is missing or empty
 * (the recovery path for a write torn during {@link atomicWrite} step 3).
 */
export async function safeRead(
  store: SaveStore,
  key: string,
): Promise<Uint8Array | null> {
  const primary = await store.get(key);
  if (primary !== null && primary.byteLength > 0) {
    return primary;
  }
  return store.get(key + BAK_SUFFIX);
}

/**
 * Load a value from the store using {@link safeRead}, parse it with `parse`,
 * and return `fallback()` on absence, empty bytes, or any parse error.
 * Never throws.
 */
export async function loadOrDefault<T>(
  store: SaveStore,
  key: string,
  parse: (bytes: Uint8Array) => T,
  fallback: () => T,
): Promise<T> {
  try {
    const bytes = await safeRead(store, key);
    if (bytes === null || bytes.byteLength === 0) return fallback();
    return parse(bytes);
  } catch {
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// IndexedDbStore — production backing (NOT unit-tested headlessly)
// ---------------------------------------------------------------------------

const DB_NAME = "mc-clone";
const STORE_NAME = "kv";
const DB_VERSION = 1;

/**
 * IndexedDB-backed {@link SaveStore}. Opens DB `mc-clone`, object store `kv`,
 * and uses `{ durability: 'strict' }` on every read/write transaction so the
 * UA must flush to disk before reporting success (matters for the atomic-write
 * guarantees above).
 *
 * NOTE: this class cannot be exercised under node/vitest (no `indexedDB`
 * global). Construction is guarded so merely importing this module never
 * touches `indexedDB`; the global is only read lazily when an operation runs.
 * It is therefore implemented carefully against the IDB API but intentionally
 * left out of the unit suite.
 */
export class IndexedDbStore implements SaveStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly dbName: string = DB_NAME,
    private readonly storeName: string = STORE_NAME,
  ) {}

  /** Lazily resolve the IndexedDB factory; throws clearly if unavailable. */
  private getFactory(): IDBFactory {
    const g: { indexedDB?: IDBFactory } = globalThis as unknown as {
      indexedDB?: IDBFactory;
    };
    const idb = g.indexedDB;
    if (idb === undefined) {
      throw new Error(
        "IndexedDbStore: `indexedDB` is not available in this environment.",
      );
    }
    return idb;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise !== null) {
      return this.dbPromise;
    }
    const factory = this.getFactory();
    const storeName = this.storeName;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = (): void => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      req.onsuccess = (): void => resolve(req.result);
      req.onerror = (): void =>
        reject(req.error ?? new Error("IndexedDbStore: open failed"));
    });
    return this.dbPromise;
  }

  /** Run `fn` inside a strict-durability transaction and await its completion. */
  private async tx<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return await new Promise<T>((resolve, reject) => {
      // `durability` is part of IDBTransactionOptions; cast through the typed
      // options shape (lib.dom may lag) without resorting to `any`.
      const options: IDBTransactionOptions = { durability: "strict" };
      const transaction = db.transaction(this.storeName, mode, options);
      const store = transaction.objectStore(this.storeName);
      const request = fn(store);
      let result: T;
      request.onsuccess = (): void => {
        result = request.result;
      };
      request.onerror = (): void =>
        reject(request.error ?? new Error("IndexedDbStore: request failed"));
      transaction.oncomplete = (): void => resolve(result);
      transaction.onabort = (): void =>
        reject(transaction.error ?? new Error("IndexedDbStore: tx aborted"));
      transaction.onerror = (): void =>
        reject(transaction.error ?? new Error("IndexedDbStore: tx error"));
    });
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    // Store an independent copy so later mutation of `value` can't bleed in.
    const copy = new Uint8Array(value);
    await this.tx<IDBValidKey>("readwrite", (store) => store.put(copy, key));
  }

  async get(key: string): Promise<Uint8Array | null> {
    const raw = await this.tx<unknown>("readonly", (store) => store.get(key));
    if (raw === undefined || raw === null) {
      return null;
    }
    if (raw instanceof Uint8Array) {
      return raw;
    }
    if (raw instanceof ArrayBuffer) {
      return new Uint8Array(raw);
    }
    throw new Error(
      `IndexedDbStore.get(${key}): stored value has unexpected type`,
    );
  }

  async delete(key: string): Promise<void> {
    await this.tx<undefined>("readwrite", (store) => store.delete(key));
  }

  async keys(): Promise<string[]> {
    const raw = await this.tx<IDBValidKey[]>("readonly", (store) =>
      store.getAllKeys(),
    );
    return raw.map((k) => String(k));
  }
}
