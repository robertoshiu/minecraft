import { describe, it, expect } from "vitest";
import { breakBlock, placeBlock } from "./edit";
import { World } from "../world/world";
import { ChunkColumn } from "../chunk/column";
import { Player } from "../player/controller";
import { Blocks } from "../rules/mc-1.20";
import { makeStack } from "../inventory/stack";
import type { RaycastHit } from "./raycast";
import type { RemeshNotifier } from "../rendering/world-renderer";

/** A renderer stub that records which blocks were flagged for remeshing. */
class FakeRenderer implements RemeshNotifier {
  changed: Array<{ x: number; y: number; z: number }> = [];
  blockChanged(wx: number, wy: number, wz: number): void {
    this.changed.push({ x: wx, y: wy, z: wz });
  }
}

/** EMPTY world (all-air pre-seeded columns) so reads/writes never generate terrain. */
function emptyWorld(): World {
  const columns = new Map<string, ChunkColumn>();
  for (let cx = -4; cx <= 4; cx++) {
    for (let cz = -4; cz <= 4; cz++) {
      columns.set(World.columnKey(cx, cz), new ChunkColumn(cx, cz));
    }
  }
  return new World(1, columns);
}

function hitAt(
  block: { x: number; y: number; z: number },
  previous: { x: number; y: number; z: number },
): RaycastHit {
  return { block, face: "py", previous };
}

describe("breakBlock", () => {
  it("breaks a stone block: world reads AIR and inventory gains 1 stone", () => {
    const world = emptyWorld();
    world.setBlock(5, 70, 5, Blocks.STONE);
    const renderer = new FakeRenderer();
    const player = new Player({ x: 0, y: 100, z: 0 });

    breakBlock(world, hitAt({ x: 5, y: 70, z: 5 }, { x: 5, y: 71, z: 5 }), renderer, player.inventory);

    expect(world.getBlock(5, 70, 5)).toBe(Blocks.AIR);
    expect(player.inventory.count(Blocks.STONE)).toBe(1);
    expect(renderer.changed).toContainEqual({ x: 5, y: 70, z: 5 });
  });

  it("bedrock and air are no-ops", () => {
    const world = emptyWorld();
    world.setBlock(0, 70, 0, Blocks.BEDROCK);
    const renderer = new FakeRenderer();
    const inv = new Player({ x: 0, y: 0, z: 0 }).inventory;

    breakBlock(world, hitAt({ x: 0, y: 70, z: 0 }, { x: 0, y: 71, z: 0 }), renderer, inv);
    expect(world.getBlock(0, 70, 0)).toBe(Blocks.BEDROCK);

    // Air target.
    breakBlock(world, hitAt({ x: 9, y: 70, z: 9 }, { x: 9, y: 71, z: 9 }), renderer, inv);
    expect(world.getBlock(9, 70, 9)).toBe(Blocks.AIR);
    expect(renderer.changed).toHaveLength(0);
  });
});

describe("placeBlock", () => {
  it("places from the held stack into the previous voxel and decrements it", () => {
    const world = emptyWorld();
    const renderer = new FakeRenderer();
    // Player far from the placement target so no self-intersection.
    const player = new Player({ x: 50, y: 70, z: 50 });
    player.inventory.set(0, makeStack(Blocks.OAK_PLANKS, 5));
    player.hotbar.select(0);

    // Hit a block at (5,70,5); place into the empty voxel above it (5,71,5).
    placeBlock(world, hitAt({ x: 5, y: 70, z: 5 }, { x: 5, y: 71, z: 5 }), renderer, player);

    expect(world.getBlock(5, 71, 5)).toBe(Blocks.OAK_PLANKS);
    expect(player.inventory.get(0)?.count).toBe(4);
    expect(renderer.changed).toContainEqual({ x: 5, y: 71, z: 5 });
  });

  it("does nothing when the hotbar slot is empty", () => {
    const world = emptyWorld();
    const renderer = new FakeRenderer();
    const player = new Player({ x: 50, y: 70, z: 50 });
    player.hotbar.select(0); // slot 0 empty

    placeBlock(world, hitAt({ x: 5, y: 70, z: 5 }, { x: 5, y: 71, z: 5 }), renderer, player);

    expect(world.getBlock(5, 71, 5)).toBe(Blocks.AIR);
    expect(renderer.changed).toHaveLength(0);
  });

  it("rejects placing a block inside the player's own AABB", () => {
    const world = emptyWorld();
    const renderer = new FakeRenderer();
    // Feet at (0.5, 64, 0.5); body box spans y [64, 65.8], x/z [0.2, 0.8].
    const player = new Player({ x: 0.5, y: 64, z: 0.5 });
    player.inventory.set(0, makeStack(Blocks.STONE, 5));
    player.hotbar.select(0);

    // Target voxel (0,64,0) overlaps the player body → rejected.
    placeBlock(world, hitAt({ x: 0, y: 63, z: 0 }, { x: 0, y: 64, z: 0 }), renderer, player);

    expect(world.getBlock(0, 64, 0)).toBe(Blocks.AIR);
    expect(player.inventory.get(0)?.count).toBe(5);
    expect(renderer.changed).toHaveLength(0);
  });
});
