import { describe, it, expect } from "vitest";
import { Blocks, type BlockId } from "../rules/mc-1.20";
import type { FaceDir } from "../chunk/data";
import { raycastVoxel, type BlockQuery, type Vec3 } from "./raycast";

const FACES: readonly FaceDir[] = ["px", "nx", "py", "ny", "pz", "nz"];

/** Encode integer voxel coords into a stable string key. */
function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * Build a BlockQuery that returns STONE for any voxel in `solids` and AIR
 * everywhere else.
 */
function world(solids: readonly Vec3[]): BlockQuery {
  const set = new Set<string>(solids.map((s) => key(s.x, s.y, s.z)));
  return (bx, by, bz): BlockId =>
    set.has(key(bx, by, bz)) ? Blocks.STONE : Blocks.AIR;
}

describe("raycastVoxel — Amanatides–Woo voxel DDA", () => {
  it("straight down hits the block from its top (py) face", () => {
    const getBlock = world([{ x: 0, y: 63, z: 0 }]);
    const hit = raycastVoxel({ x: 0.5, y: 67, z: 0.5 }, { x: 0, y: -1, z: 0 }, 6, getBlock);
    expect(hit).not.toBeNull();
    expect(hit?.block).toEqual({ x: 0, y: 63, z: 0 });
    expect(hit?.face).toBe("py");
    expect(hit?.previous).toEqual({ x: 0, y: 64, z: 0 });
  });

  it("straight ahead +z hits the block from its -z (nz) face", () => {
    const getBlock = world([{ x: 0, y: 64, z: 5 }]);
    const hit = raycastVoxel({ x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: 1 }, 10, getBlock);
    expect(hit).not.toBeNull();
    expect(hit?.block).toEqual({ x: 0, y: 64, z: 5 });
    expect(hit?.face).toBe("nz");
    expect(hit?.previous).toEqual({ x: 0, y: 64, z: 4 });
  });

  it("returns the nearest of two solids along the ray", () => {
    const getBlock = world([
      { x: 0, y: 64, z: 3 },
      { x: 0, y: 64, z: 6 },
    ]);
    const hit = raycastVoxel({ x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: 1 }, 20, getBlock);
    expect(hit?.block).toEqual({ x: 0, y: 64, z: 3 });
    expect(hit?.previous).toEqual({ x: 0, y: 64, z: 2 });
  });

  it("returns null when there are no solids in range", () => {
    const getBlock = world([]);
    const hit = raycastVoxel({ x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: 1 }, 10, getBlock);
    expect(hit).toBeNull();
  });

  it("returns null for a solid just beyond maxDistance", () => {
    // Origin z=0.5; solid at z=12 ⇒ its near face is at z=12, distance 11.5.
    const getBlock = world([{ x: 0, y: 64, z: 12 }]);
    const tooFar = raycastVoxel({ x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: 1 }, 11, getBlock);
    expect(tooFar).toBeNull();
    // Extending the range past the near face finds it.
    const reaches = raycastVoxel({ x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: 1 }, 12, getBlock);
    expect(reaches?.block).toEqual({ x: 0, y: 64, z: 12 });
  });

  it("normalizes a non-unit direction vector", () => {
    const getBlock = world([{ x: 0, y: 64, z: 5 }]);
    // dir length 3 on the z axis; maxDistance 10 must still be world units.
    const hit = raycastVoxel({ x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: 3 }, 10, getBlock);
    expect(hit?.block).toEqual({ x: 0, y: 64, z: 5 });
    expect(hit?.face).toBe("nz");
  });

  it("a diagonal ray hits the correct first voxel with a sensible face", () => {
    // Solid wall across z; a diagonal ray in the +x/+z plane should hit a voxel
    // and enter through one of its six faces, with previous one step away.
    const getBlock = world([
      { x: 2, y: 64, z: 2 },
      { x: 3, y: 64, z: 2 },
      { x: 2, y: 64, z: 3 },
      { x: 3, y: 64, z: 3 },
    ]);
    const dir = { x: 1, y: 0, z: 1 };
    const hit = raycastVoxel({ x: 0.5, y: 64.5, z: 0.5 }, dir, 20, getBlock);
    expect(hit).not.toBeNull();
    expect(hit && FACES.includes(hit.face)).toBe(true);
    // The voxel adjacent across the entered face must be air (pass-through).
    expect(hit && getBlock(hit.previous.x, hit.previous.y, hit.previous.z)).toBe(Blocks.AIR);
    // And the hit voxel must itself be solid.
    expect(hit && getBlock(hit.block.x, hit.block.y, hit.block.z)).not.toBe(Blocks.AIR);
  });

  it("previous is always exactly one step on a single axis from block", () => {
    const dirs: Vec3[] = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
      { x: 1, y: 1, z: 1 },
      { x: -2, y: 1, z: 3 },
    ];
    for (const dir of dirs) {
      // A single solid voxel placed a few units along the ray.
      const target = {
        x: Math.floor(50 + dir.x * 5),
        y: Math.floor(50 + dir.y * 5),
        z: Math.floor(50 + dir.z * 5),
      };
      const getBlock = world([target]);
      const hit = raycastVoxel({ x: 50.5, y: 50.5, z: 50.5 }, dir, 50, getBlock);
      expect(hit).not.toBeNull();
      if (!hit) continue;
      const ddx = Math.abs(hit.block.x - hit.previous.x);
      const ddy = Math.abs(hit.block.y - hit.previous.y);
      const ddz = Math.abs(hit.block.z - hit.previous.z);
      // Exactly one axis differs, and by exactly one.
      expect(ddx + ddy + ddz).toBe(1);
    }
  });

  it("returns null when the direction vector is zero", () => {
    const getBlock = world([{ x: 0, y: 64, z: 0 }]);
    expect(raycastVoxel({ x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: 0, z: 0 }, 10, getBlock)).toBeNull();
  });

  it("hits the +x face (px) when travelling in -x", () => {
    const getBlock = world([{ x: 0, y: 64, z: 0 }]);
    const hit = raycastVoxel({ x: 5.5, y: 64.5, z: 0.5 }, { x: -1, y: 0, z: 0 }, 10, getBlock);
    expect(hit?.block).toEqual({ x: 0, y: 64, z: 0 });
    expect(hit?.face).toBe("px");
    expect(hit?.previous).toEqual({ x: 1, y: 64, z: 0 });
  });
});
