import { describe, it, expect } from "vitest";
import { withinRadius, splashTargets } from "./aoe";
import { Mob } from "../mobs/entity";

function mobAt(x: number, y: number, z: number): Mob {
  const m = new Mob(1, "zombie", { x, y, z });
  return m;
}

describe("withinRadius", () => {
  it("inclusive at the boundary", () => {
    expect(withinRadius({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, 4)).toBe(true);
    expect(withinRadius({ x: 0, y: 0, z: 0 }, { x: 4.1, y: 0, z: 0 }, 4)).toBe(false);
  });
});

describe("splashTargets", () => {
  it("selects only mobs within radius and flags player range", () => {
    const center = { x: 0, y: 0, z: 0 };
    const near = mobAt(1, 0, 0);
    const far = mobAt(20, 0, 0);
    const out = splashTargets(center, { x: 2, y: 0, z: 0 }, [near, far], 4);
    expect(out.mobs).toEqual([near]);
    expect(out.playerInRange).toBe(true);
  });
  it("player out of range → false", () => {
    const out = splashTargets({ x: 0, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, [], 4);
    expect(out.playerInRange).toBe(false);
    expect(out.mobs).toEqual([]);
  });
});
