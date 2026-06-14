import { describe, it, expect, afterEach } from "vitest";
import {
  SAVE_VERSION,
  MIGRATIONS,
  migrate,
  type Migration,
} from "./migration";
import { type WorldSave, type PlayerSave } from "./serialize";

function emptyPlayer(): PlayerSave {
  return {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    health: 20,
    food: 20,
    saturation: 5,
    selectedSlot: 0,
    inventory: [],
    spawnX: 0,
    spawnY: 0,
    spawnZ: 0,
  };
}

function saveAt(version: number, seed = 1): WorldSave {
  return {
    version,
    seed,
    totalTicks: 100,
    player: emptyPlayer(),
    columns: {},
  };
}

describe("migration pipeline (D3: never hard-fail when a path exists, never corrupt)", () => {
  // The MIGRATIONS registry is a module singleton; clean up any fakes a test
  // installs so cases stay isolated. We snapshot the prior value of each key so
  // a fake that shadows a REAL migration (e.g. the real v1->v2 step) is restored
  // afterward rather than deleted.
  const saved: { from: number; prev: Migration | undefined }[] = [];
  function install(from: number, fn: Migration): void {
    saved.push({ from, prev: MIGRATIONS[from] });
    MIGRATIONS[from] = fn;
  }
  /** Temporarily remove a (possibly real) migration; restored in afterEach. */
  function uninstall(from: number): void {
    saved.push({ from, prev: MIGRATIONS[from] });
    delete MIGRATIONS[from];
  }
  afterEach(() => {
    // Restore in reverse install order so nested shadows unwind correctly.
    for (let i = saved.length - 1; i >= 0; i--) {
      const entry = saved[i];
      if (entry === undefined) continue;
      if (entry.prev === undefined) delete MIGRATIONS[entry.from];
      else MIGRATIONS[entry.from] = entry.prev;
    }
    saved.length = 0;
  });

  it("migrating a save already at SAVE_VERSION is a no-op (returns equivalent)", () => {
    const data = saveAt(SAVE_VERSION, 777);
    const out = migrate(data);
    expect(out.version).toBe(SAVE_VERSION);
    expect(out).toBe(data); // unchanged, same reference
    expect(out.seed).toBe(777);
  });

  it("applies a registered v0 -> v1 migration to reach the target", () => {
    // Fake migration: bump version and tag the seed so we can prove it ran.
    install(0, (d) => ({ ...d, version: 1, seed: d.seed + 1000 }));
    const v0 = saveAt(0, 5);
    const out = migrate(v0, 1);
    expect(out.version).toBe(1);
    expect(out.seed).toBe(1005);
  });

  it("applies migrations sequentially across multiple versions", () => {
    install(0, (d) => ({ ...d, version: 1, totalTicks: d.totalTicks + 1 }));
    install(1, (d) => ({ ...d, version: 2, totalTicks: d.totalTicks + 10 }));
    const v0 = saveAt(0);
    const out = migrate(v0, 2);
    expect(out.version).toBe(2);
    expect(out.totalTicks).toBe(100 + 1 + 10);
  });

  it("throws a clear, version-named error when a needed migration is missing", () => {
    const v0 = saveAt(0);
    // No MIGRATIONS[0] registered -> must throw, not silently corrupt.
    expect(() => migrate(v0, 1)).toThrow(/0 -> 1/);
    expect(() => migrate(v0, 1)).toThrow(/MIGRATIONS\[0\]/);
  });

  it("throws clearly when only part of the chain is registered", () => {
    install(0, (d) => ({ ...d, version: 1 }));
    // MIGRATIONS[1] (the real v1->v2 step) is intentionally removed here.
    uninstall(1);
    const v0 = saveAt(0);
    expect(() => migrate(v0, 2)).toThrow(/1 -> 2/);
  });

  it("refuses to downgrade a save newer than the target (no corruption)", () => {
    const future = saveAt(SAVE_VERSION + 5);
    expect(() => migrate(future)).toThrow(/newer than target/);
  });

  it("guards against a migration that fails to advance the version", () => {
    install(0, (d) => ({ ...d, version: 0 })); // buggy: no advance
    expect(() => migrate(saveAt(0), 1)).toThrow(/did not advance/);
  });

  it("exposes SAVE_VERSION = 3 and a MIGRATIONS registry", () => {
    expect(SAVE_VERSION).toBe(3);
    expect(typeof MIGRATIONS).toBe("object");
  });

  it("migrates a v1 save to v2, seeding an empty mob list", () => {
    const v1 = saveAt(1, 123);
    expect(v1.mobs).toBeUndefined();
    const out = migrate(v1, 2); // target explicitly v2
    expect(out.version).toBe(2);
    expect(out.mobs).toEqual([]);
    expect(out.seed).toBe(123); // other fields preserved
  });

  it("migrates a v2 save to v3, defaulting spawn to player position", () => {
    const v2 = saveAt(2, 456);
    // v2 player has x/y/z; spawn fields are absent.
    v2.player.x = 10;
    v2.player.y = 64;
    v2.player.z = -5;
    const out = migrate(v2); // default target = SAVE_VERSION (3)
    expect(out.version).toBe(3);
    expect(out.player.spawnX).toBe(10);
    expect(out.player.spawnY).toBe(64);
    expect(out.player.spawnZ).toBe(-5);
    expect(out.seed).toBe(456);
  });
});
