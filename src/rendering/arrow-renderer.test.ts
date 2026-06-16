import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { ArrowRenderer } from "./arrow-renderer";
import { Arrow } from "../arrows/entity";

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});
afterEach(() => {
  scene.dispose();
  engine.dispose();
});

describe("ArrowRenderer", () => {
  it("creates a mesh for a new arrow and disposes it when gone", () => {
    const r = new ArrowRenderer(scene);
    const a = new Arrow(1, { x: 0, y: 80, z: 0 }, { x: 1, y: 0, z: 0 });
    r.sync([a]);
    const before = scene.meshes.length;
    expect(before).toBeGreaterThan(0);
    r.sync([]);
    expect(scene.meshes.length).toBeLessThan(before);
  });
  it("shares ONE material across all arrows", () => {
    const r = new ArrowRenderer(scene);
    r.sync([
      new Arrow(1, { x: 0, y: 80, z: 0 }, { x: 1, y: 0, z: 0 }),
      new Arrow(2, { x: 1, y: 80, z: 0 }, { x: 1, y: 0, z: 0 }),
    ]);
    const arrowMats = scene.materials.filter((m) => m.name === "arrow_mat");
    expect(arrowMats).toHaveLength(1);
  });
  it("keeps the shared material alive when ONE of several arrows is removed", () => {
    const r = new ArrowRenderer(scene);
    r.sync([
      new Arrow(1, { x: 0, y: 80, z: 0 }, { x: 1, y: 0, z: 0 }),
      new Arrow(2, { x: 1, y: 80, z: 0 }, { x: 1, y: 0, z: 0 }),
    ]);
    // Arrow 1 lands/despawns; arrow 2 still flying.
    r.sync([new Arrow(2, { x: 2, y: 80, z: 0 }, { x: 1, y: 0, z: 0 })]);
    // A disposed material is removed from scene.materials; still finding it
    // with length 1 proves it was NOT disposed by arrow 1's removal.
    const mat = scene.materials.filter((m) => m.name === "arrow_mat");
    expect(mat).toHaveLength(1); // still present → NOT disposed by arrow 1's removal
  });
});
