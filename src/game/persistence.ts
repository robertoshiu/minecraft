/**
 * persistence.ts — glue between the live game (World + Player + Clock) and the
 * pure save system (src/save). Builds a {@link WorldSave} snapshot, writes it
 * atomically, and reads + migrates it back. All failures are swallowed and
 * logged so persistence can NEVER crash the running game.
 *
 * The pure encode/decode/migration/atomic-write logic all lives in src/save;
 * this module only assembles the snapshot and calls those functions.
 */

import { World } from "../world/world";
import type { Player } from "../player/controller";
import type { Clock } from "../time/clock";
import { Inventory } from "../inventory/inventory";
import type { ItemStack } from "../inventory/stack";
import {
  serializeSave,
  deserializeSave,
  serializeColumn,
  type WorldSave,
  type PlayerSave,
  type ItemStackSave,
} from "../save/serialize";
import { migrate, SAVE_VERSION } from "../save/migration";
import { atomicWrite, safeRead, type SaveStore } from "../save/store";
import { serializeMobs } from "../mobs/persistence";
import type { MobManager } from "../mobs/manager";
import { type Equipment, ARMOR_SLOTS } from "../inventory/equipment";

/** The canonical key the single-world save lives under in the store. */
export const SAVE_KEY = "world";

/** The view angles the camera owns (the Player body doesn't track these). */
export interface ViewAngles {
  yaw: number;
  pitch: number;
}

/** Convert a live {@link ItemStack} into its serializable shape. */
function toItemSave(stack: ItemStack): ItemStackSave {
  const save: ItemStackSave = {
    itemId: stack.itemId,
    count: stack.count,
    maxStack: stack.maxStack,
  };
  if (stack.durability !== undefined && stack.maxDurability !== undefined) {
    save.durability = stack.durability;
    save.maxDurability = stack.maxDurability;
  }
  return save;
}

/** Snapshot the 4 armor slots [helmet, chestplate, leggings, boots] into save shape. */
function snapshotEquipment(eq: Equipment): (ItemStackSave | null)[] {
  return ARMOR_SLOTS.map((slot) => {
    const stack = eq.get(slot);
    return stack === null ? null : toItemSave(stack);
  });
}

/** Snapshot all 36 inventory slots into save shape (empty slots → null). */
function snapshotInventory(inv: Inventory): (ItemStackSave | null)[] {
  const slots: (ItemStackSave | null)[] = [];
  for (let i = 0; i < Inventory.SLOTS; i++) {
    const stack = inv.get(i);
    slots.push(stack === null ? null : toItemSave(stack));
  }
  return slots;
}

/**
 * Assemble a {@link WorldSave} from the live game state. Position is the
 * player's feet; view angles come from the camera (the body doesn't track
 * them). Every currently-loaded column is serialized.
 */
export function buildWorldSave(
  world: World,
  player: Player,
  clock: Clock,
  view: ViewAngles,
  mobs?: MobManager,
): WorldSave {
  const s = player.survival;
  const sp = player.spawnPoint;
  const playerSave: PlayerSave = {
    x: player.feet.x,
    y: player.feet.y,
    z: player.feet.z,
    yaw: view.yaw,
    pitch: view.pitch,
    health: s.health,
    food: s.food,
    saturation: s.saturation,
    selectedSlot: player.hotbar.selected,
    inventory: snapshotInventory(player.inventory),
    spawnX: sp.x,
    spawnY: sp.y,
    spawnZ: sp.z,
    equipment: snapshotEquipment(player.equipment),
  };

  const columns: Record<string, Uint8Array> = {};
  for (const [key, column] of world.columns) {
    columns[key] = serializeColumn(column);
  }

  return {
    version: SAVE_VERSION,
    seed: world.seed,
    totalTicks: clock.totalTicks,
    player: playerSave,
    columns,
    mobs: mobs === undefined ? [] : serializeMobs(mobs.all()),
  };
}

/**
 * Serialize + atomically persist the current game state. Returns true on
 * success; any error is caught and logged (never re-thrown) so a failed save
 * cannot take down the game.
 */
export async function saveGame(
  store: SaveStore,
  world: World,
  player: Player,
  clock: Clock,
  view: ViewAngles,
  mobs?: MobManager,
): Promise<boolean> {
  try {
    const save = buildWorldSave(world, player, clock, view, mobs);
    const bytes = serializeSave(save);
    await atomicWrite(store, SAVE_KEY, bytes);
    return true;
  } catch (err) {
    console.error("[persistence] saveGame failed:", err);
    return false;
  }
}

/**
 * Read + decode + migrate the persisted world, or `null` when nothing is stored
 * or anything goes wrong (corrupt bytes, unsupported version, …). Never throws.
 */
export async function loadGame(store: SaveStore): Promise<WorldSave | null> {
  try {
    const bytes = await safeRead(store, SAVE_KEY);
    if (bytes === null || bytes.byteLength === 0) return null;
    const decoded = deserializeSave(bytes);
    return migrate(decoded);
  } catch (err) {
    console.error("[persistence] loadGame failed:", err);
    return null;
  }
}
