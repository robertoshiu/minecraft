/**
 * migration.ts — versioned save migration pipeline (review D3).
 *
 * The cardinal rule: NEVER hard-fail on a version mismatch when a path exists,
 * and NEVER silently corrupt when one doesn't. Migrations are applied
 * sequentially (k → k+1) from the save's `version` up to the target. A missing
 * step throws a clear, version-named error so the failure is diagnosable rather
 * than producing garbage data.
 */

import { type WorldSave } from "./serialize";

/** The current on-disk save version this build writes and reads natively. */
export const SAVE_VERSION = 3;

/** Transforms a save from version `k` to version `k+1`. */
export type Migration = (data: WorldSave) => WorldSave;

/**
 * Registry of forward migrations, keyed by SOURCE version. `MIGRATIONS[k]`
 * upgrades a v`k` save to v`k+1`.
 *
 * - `MIGRATIONS[1]` (v1 -> v2): adds the `mobs` field. v1 saves predate mobs, so
 *   the upgrade simply seeds an empty mob list.
 * - `MIGRATIONS[2]` (v2 -> v3): adds spawnX/spawnY/spawnZ to the player record.
 *   v2 saves predate bed-spawn, so the upgrade defaults spawn to the player's
 *   current position (x, y, z) — the same behavior as the binary reader for
 *   older container formats.
 */
export const MIGRATIONS: Record<number, Migration> = {
  1: (data) => ({ ...data, version: 2, mobs: [] }),
  2: (data) => ({
    ...data,
    version: 3,
    player: {
      ...data.player,
      spawnX: data.player.x,
      spawnY: data.player.y,
      spawnZ: data.player.z,
    },
  }),
};

/**
 * Migrate `data` forward to `target` (default {@link SAVE_VERSION}).
 *
 * - At the target version already: returns `data` unchanged (no-op).
 * - For each intermediate version, applies the registered migration; the result
 *   is expected to carry the bumped `version`. If a step is missing, throws a
 *   clear error naming both the missing source version and the overall span.
 * - Refuses to "migrate" a save that is NEWER than `target` (would require a
 *   downgrade, which has no registered path) — throws rather than corrupt.
 */
export function migrate(data: WorldSave, target: number = SAVE_VERSION): WorldSave {
  if (data.version === target) {
    return data;
  }
  if (data.version > target) {
    throw new Error(
      `Cannot migrate save: data version ${data.version} is newer than target ${target}. ` +
        `No downgrade path exists; this save was written by a newer build.`,
    );
  }

  let current = data;
  while (current.version < target) {
    const from = current.version;
    const step = MIGRATIONS[from];
    if (step === undefined) {
      throw new Error(
        `Missing migration for save version ${from} -> ${from + 1} ` +
          `(while migrating ${data.version} -> ${target}). ` +
          `Register MIGRATIONS[${from}] to upgrade this save.`,
      );
    }
    const next = step(current);
    if (next.version <= from) {
      throw new Error(
        `Migration MIGRATIONS[${from}] did not advance the version ` +
          `(stayed at ${next.version}); refusing to loop forever.`,
      );
    }
    current = next;
  }

  return current;
}
