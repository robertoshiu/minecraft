import { describe, it, expect } from "vitest";
import { World } from "../world/world";
import { Mob, type Vec3 } from "./entity";
import { explosionDamageAt, explode, type ExplosionHooks } from "./explosion";
import { Blocks } from "../rules/mc-1.20";

describe("explosionDamageAt", () => {
  it("deals large damage at distance 0", () => {
    expect(explosionDamageAt(0, 3)).toBeGreaterThan(0);
    // (1^2 + 1) * 3.5 * 3 = 21
    expect(explosionDamageAt(0, 3)).toBe(21);
  });

  it("deals exactly 0 at distance >= 2*power", () => {
    expect(explosionDamageAt(6, 3)).toBe(0); // 2*power exactly
    expect(explosionDamageAt(10, 3)).toBe(0); // beyond
    expect(explosionDamageAt(8, 4)).toBe(0); // 2*power for TNT
  });

  it("is monotonically non-increasing in distance", () => {
    const power = 4;
    let prev = explosionDamageAt(0, power);
    for (let d = 0.25; d <= 2 * power + 1; d += 0.25) {
      const cur = explosionDamageAt(d, power);
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });

  it("never returns negative damage", () => {
    for (let d = 0; d <= 30; d += 0.5) {
      expect(explosionDamageAt(d, 3)).toBeGreaterThanOrEqual(0);
    }
  });
});

/**
 * Build a World whose entire region is filled with one block id by overriding
 * getBlock; setBlock writes into a sparse override map so destruction is
 * observable. This is a lightweight stub over the real World class.
 */
function fillWorld(fill: number): {
  world: World;
  overrides: Map<string, number>;
} {
  const overrides = new Map<string, number>();
  const world = new World(0);
  const key = (x: number, y: number, z: number): string => `${x},${y},${z}`;
  world.getBlock = (x: number, y: number, z: number) => {
    const o = overrides.get(key(x, y, z));
    return (o ?? fill) as ReturnType<World["getBlock"]>;
  };
  world.setBlock = (x: number, y: number, z: number, id: number) => {
    overrides.set(key(x, y, z), id);
  };
  return { world, overrides };
}

function makeHooks(playerPos: Vec3): {
  hooks: ExplosionHooks;
  damage: () => number;
} {
  let total = 0;
  const hooks: ExplosionHooks = {
    damagePlayer: (n) => {
      total += n;
    },
    playerPos: () => playerPos,
  };
  return { hooks, damage: () => total };
}

describe("explode — block destruction", () => {
  it("sets solid blocks within radius to AIR and returns them", () => {
    const { world } = fillWorld(Blocks.STONE);
    const center: Vec3 = { x: 8.5, y: 64.5, z: 8.5 };
    const { hooks } = makeHooks({ x: 1000, y: 1000, z: 1000 });

    const result = explode(world, center, 3, [], hooks, 0);

    expect(result.destroyed.length).toBeGreaterThan(0);
    // The center block itself must be destroyed.
    expect(world.getBlock(8, 64, 8)).toBe(Blocks.AIR);
    // Every reported coord is now AIR.
    for (const c of result.destroyed) {
      expect(world.getBlock(c.x, c.y, c.z)).toBe(Blocks.AIR);
    }
  });

  it("leaves BEDROCK intact", () => {
    const { world } = fillWorld(Blocks.BEDROCK);
    const center: Vec3 = { x: 8.5, y: 64.5, z: 8.5 };
    const { hooks } = makeHooks({ x: 1000, y: 1000, z: 1000 });

    const result = explode(world, center, 3, [], hooks, 0);

    expect(result.destroyed.length).toBe(0);
    expect(world.getBlock(8, 64, 8)).toBe(Blocks.BEDROCK);
  });

  it("works against a real World (stone column carved out)", () => {
    const world = new World(1234);
    // Lay down a solid stone region around the blast center.
    for (let x = 5; x <= 11; x++) {
      for (let y = 61; y <= 67; y++) {
        for (let z = 5; z <= 11; z++) {
          world.setBlock(x, y, z, Blocks.STONE);
        }
      }
    }
    const center: Vec3 = { x: 8.5, y: 64.5, z: 8.5 };
    const { hooks } = makeHooks({ x: 1000, y: 1000, z: 1000 });

    const result = explode(world, center, 3, [], hooks, 0);

    expect(result.destroyed.length).toBeGreaterThan(0);
    expect(world.getBlock(8, 64, 8)).toBe(Blocks.AIR);
  });
});

describe("explode — entity damage", () => {
  it("damages the player at the center but not a far-away player", () => {
    const { world } = fillWorld(Blocks.AIR);
    const center: Vec3 = { x: 8.5, y: 64.5, z: 8.5 };

    const near = makeHooks({ x: 8.5, y: 64.5, z: 8.5 });
    explode(world, center, 3, [], near.hooks, 0);
    expect(near.damage()).toBeGreaterThan(0);

    const far = makeHooks({ x: 8.5 + 100, y: 64.5, z: 8.5 });
    explode(world, center, 3, [], far.hooks, 0);
    expect(far.damage()).toBe(0);
  });

  it("damages a nearby mob via takeDamage", () => {
    const { world } = fillWorld(Blocks.AIR);
    const center: Vec3 = { x: 8.5, y: 64.5, z: 8.5 };
    const { hooks } = makeHooks({ x: 1000, y: 1000, z: 1000 });

    const mob = new Mob(1, "cow", { x: 8.5, y: 64, z: 8.5 });
    const before = mob.health;

    explode(world, center, 3, [mob], hooks, 42);

    expect(mob.health).toBeLessThan(before);
    expect(mob.lastDamageTick).toBe(42);
  });

  it("does not damage a far-away mob", () => {
    const { world } = fillWorld(Blocks.AIR);
    const center: Vec3 = { x: 8.5, y: 64.5, z: 8.5 };
    const { hooks } = makeHooks({ x: 1000, y: 1000, z: 1000 });

    const mob = new Mob(1, "cow", { x: 100, y: 64, z: 8.5 });
    const before = mob.health;

    explode(world, center, 3, [mob], hooks, 0);

    expect(mob.health).toBe(before);
  });
});
