import { describe, it, expect } from "vitest";
import { Player, type InputState } from "./controller";
import { World } from "../world/world";
import { ChunkColumn } from "../chunk/column";
import { Blocks } from "../rules/mc-1.20";

const SEED = 1;

/** No movement intent. */
function noInput(): InputState {
  return { forward: false, back: false, left: false, right: false, jump: false, sprint: false };
}

/**
 * An EMPTY world (pre-seeded with all-air columns over a small grid) so
 * `setBlock` does not lazily generate real terrain — we control every block.
 */
function emptyWorld(): World {
  const columns = new Map<string, ChunkColumn>();
  // Cover the columns a few blocks around the origin span.
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
      columns.set(World.columnKey(cx, cz), new ChunkColumn(cx, cz));
    }
  }
  return new World(SEED, columns);
}

/**
 * A flat floor world: a solid stone plane at worldY = floorY (block occupies
 * [floorY, floorY+1]) over an otherwise-empty world. Everything else is air.
 */
function flatFloor(floorY: number, half = 4): World {
  const world = emptyWorld();
  for (let x = -half; x <= half; x++) {
    for (let z = -half; z <= half; z++) {
      world.setBlock(x, floorY, z, Blocks.STONE);
    }
  }
  return world;
}

describe("Player.update — gravity & landing", () => {
  it("settles onto a floor: onGround true and feet rest at the floor top", () => {
    const floorY = 63; // block [63,64]; standing feet.y should be 64.
    const world = flatFloor(floorY);
    const player = new Player({ x: 0.5, y: 70, z: 0.5 });

    for (let i = 0; i < 200; i++) {
      player.update(noInput(), 0, world);
    }

    expect(player.physics.onGround).toBe(true);
    expect(player.feet.y).toBeCloseTo(64, 2);
  });
});

describe("Player.update — wall collision", () => {
  it("walking into a wall does not pass through it", () => {
    const world = flatFloor(63, 8);
    // A wall plane at x = 2 spanning the player's body height.
    for (let y = 64; y <= 66; y++) {
      for (let z = -2; z <= 2; z++) {
        world.setBlock(2, y, z, Blocks.STONE);
      }
    }
    const player = new Player({ x: 0.5, y: 64, z: 0.5 });

    // Yaw 0 → forward is -Z; we want +X movement, which is "right".
    const moveRight: InputState = {
      ...noInput(),
      right: true,
    };
    for (let i = 0; i < 120; i++) {
      player.update(moveRight, 0, world);
    }

    // Body half-width is 0.3; max x can't exceed the wall face at x=2.
    expect(player.feet.x + 0.3).toBeLessThanOrEqual(2 + 1e-6);
  });
});

describe("Player.update — fall damage", () => {
  it("falling a moderate distance reduces health but is survivable", () => {
    // Floor at y=63 (feet rest at 64); spawn ~14 blocks up → hurts, not lethal.
    const floorY = 63;
    const world = flatFloor(floorY, 4);
    const player = new Player({ x: 0.5, y: 78, z: 0.5 });

    for (let i = 0; i < 400; i++) {
      player.update(noInput(), 0, world);
      if (player.physics.onGround) break;
    }

    expect(player.physics.onGround).toBe(true);
    expect(player.feet.y).toBeCloseTo(64, 2);
    expect(player.health).toBeGreaterThan(0);
    expect(player.health).toBeLessThan(20);
  });
});

describe("Player.eyePosition", () => {
  it("is feet plus the 1.62 eye-height offset", () => {
    const player = new Player({ x: 1, y: 64, z: 2 });
    const eye = player.eyePosition();
    expect(eye.x).toBeCloseTo(1);
    expect(eye.y).toBeCloseTo(65.62);
    expect(eye.z).toBeCloseTo(2);
  });
});

it("update applies an optional speed multiplier (Swiftness hook)", () => {
  const world = flatFloor(63); // real World; floor top at y=64
  const input = { ...noInput(), forward: true }; // copy the file's InputState shape
  const base = new Player({ x: 0, y: 65, z: 0 });
  const fast = new Player({ x: 0, y: 65, z: 0 });
  for (let i = 0; i < 20; i++) {
    base.update(input, 0, world);
    fast.update(input, 0, world, 1.5);
  }
  const baseDist = Math.hypot(base.feet.x, base.feet.z);
  const fastDist = Math.hypot(fast.feet.x, fast.feet.z);
  expect(fastDist).toBeGreaterThan(baseDist);
});
