import { describe, it, expect } from "vitest";
import { arrowStep } from "./physics";
import { Arrow } from "./entity";
import { Mob } from "../mobs/entity";
import { Blocks, type BlockId } from "../rules/mc-1.20";
import type { BlockQuery } from "../interaction/raycast";

const AIR: BlockQuery = () => Blocks.AIR;

describe("arrowStep", () => {
  it("applies gravity: a horizontally-launched arrow drops over ticks", () => {
    const a = new Arrow(1, { x: 0, y: 80, z: 0 }, { x: 1, y: 0, z: 0 });
    const startY = a.feet.y;
    arrowStep(a, AIR, []);
    arrowStep(a, AIR, []);
    expect(a.feet.y).toBeLessThan(startY);
    expect(a.feet.x).toBeGreaterThan(0);
  });

  it("lands on a solid block without tunneling through it", () => {
    const solidWall: BlockQuery = (bx): BlockId => (bx >= 2 ? Blocks.STONE : Blocks.AIR);
    const a = new Arrow(2, { x: 0, y: 80, z: 0 }, { x: 3, y: 0, z: 0 });
    const hit = arrowStep(a, solidWall, []);
    expect(hit.kind).toBe("block");
    expect(a.landed).toBe(true);
    expect(a.feet.x).toBeLessThan(2);
  });

  it("hits a mob in the path", () => {
    const mob = new Mob(7, "zombie", { x: 2, y: 80, z: 0 });
    const a = new Arrow(3, { x: 0, y: 80.9, z: 0 }, { x: 3, y: 0, z: 0 });
    const hit = arrowStep(a, AIR, [mob]);
    expect(hit.kind).toBe("mob");
    if (hit.kind === "mob") expect(hit.mob.id).toBe(7);
    expect(a.hitMob).toBe(true);
  });

  it("prefers the block when it is nearer than the mob", () => {
    const wall: BlockQuery = (bx): BlockId => (bx >= 1 ? Blocks.STONE : Blocks.AIR);
    const mob = new Mob(8, "zombie", { x: 3, y: 80, z: 0 });
    const a = new Arrow(4, { x: 0, y: 80.9, z: 0 }, { x: 4, y: 0, z: 0 });
    const hit = arrowStep(a, wall, [mob]);
    expect(hit.kind).toBe("block");
  });

  it("returns none and advances when nothing is hit", () => {
    const a = new Arrow(5, { x: 0, y: 80, z: 0 }, { x: 1, y: 0, z: 0 });
    const hit = arrowStep(a, AIR, []);
    expect(hit.kind).toBe("none");
    expect(a.feet.x).toBeGreaterThan(0);
  });
});
