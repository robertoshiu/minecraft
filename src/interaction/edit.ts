/**
 * edit.ts — break & place block edits driven by a raycast hit.
 *
 * v1 is INSTANT break (no hardness / break-time): a left-click breaks the hit
 * block immediately and adds it to the inventory as an item (block id reused as
 * item id); a right-click places the currently held block into the empty voxel
 * in front of the hit face, unless that would intersect the player's body.
 *
 * Each edit writes through {@link World.setBlock} and then notifies the
 * {@link WorldRenderer} so the affected section(s) remesh live.
 *
 * Pure logic apart from the World/renderer/inventory it is handed — NO Babylon.
 */

import { Blocks, type BlockId } from "../rules/mc-1.20";
import type { World } from "../world/world";
import type { RemeshNotifier } from "../rendering/world-renderer";
import type { RaycastHit } from "./raycast";
import type { Inventory } from "../inventory/inventory";
import { makeStack } from "../inventory/stack";
import { aabbFromFeet } from "../player/collision";
import type { Player } from "../player/controller";

/** Number of distinct block ids (0..BLOCK_COUNT-1). Used to gate placeables. */
const BLOCK_COUNT = Object.keys(Blocks).length;

/** Does the player's body box overlap the unit voxel at (bx, by, bz)? */
function intersectsPlayer(player: Player, bx: number, by: number, bz: number): boolean {
  const box = aabbFromFeet(player.feet);
  return (
    box.minX < bx + 1 &&
    box.maxX > bx &&
    box.minY < by + 1 &&
    box.maxY > by &&
    box.minZ < bz + 1 &&
    box.maxZ > bz
  );
}

/**
 * Break the block at the raycast hit. AIR and BEDROCK are no-ops. The broken
 * block is added to `inv` as a single item, and the owning section remeshes.
 */
export function breakBlock(
  world: World,
  hit: RaycastHit,
  renderer: RemeshNotifier,
  inv: Inventory,
): void {
  const { x, y, z } = hit.block;
  const id = world.getBlock(x, y, z);
  if (id === Blocks.AIR || id === Blocks.BEDROCK) return;

  world.setBlock(x, y, z, Blocks.AIR);
  inv.add(makeStack(id, 1));
  renderer.blockChanged(x, y, z);
}

/**
 * Place the held block into the empty voxel in front of the hit face
 * ({@link RaycastHit.previous}).
 *
 * No-op when: the hotbar slot is empty / count<=0, the held item is not a
 * placeable block id, or the target voxel would intersect the player's body.
 * On success the held stack is decremented and the target section remeshes.
 */
export function placeBlock(
  world: World,
  hit: RaycastHit,
  renderer: RemeshNotifier,
  player: Player,
): void {
  const slot = player.hotbar.selected;
  const held = player.inventory.get(slot);
  if (held === null || held.count <= 0) return;

  const itemId = held.itemId;
  // Only block ids are placeable (every current id is a block in 0..BLOCK_COUNT-1).
  if (itemId < 0 || itemId >= BLOCK_COUNT) return;
  if (itemId === Blocks.AIR) return;

  const { x, y, z } = hit.previous;
  if (intersectsPlayer(player, x, y, z)) return;

  world.setBlock(x, y, z, itemId as BlockId);
  player.inventory.removeFromSlot(slot, 1);
  renderer.blockChanged(x, y, z);
}
