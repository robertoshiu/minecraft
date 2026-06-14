/**
 * terrain-material.test.ts — verifies that createTerrainMaterials compiles
 * without throwing under a NullEngine (shader plugin build test) and that the
 * returned materials satisfy the TerrainMaterials contract.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";

import { createTerrainMaterials } from "./terrain-material";

let engine: NullEngine;
let scene: Scene;

beforeAll(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterAll(() => {
  scene.dispose();
  engine.dispose();
});

describe("createTerrainMaterials (atlas path)", () => {
  it("returns opaque + transparent materials without throwing", () => {
    let mats: ReturnType<typeof createTerrainMaterials> | undefined;
    expect(() => {
      mats = createTerrainMaterials(scene);
    }).not.toThrow();
    expect(mats).toBeDefined();
  });

  it("opaque material has alpha === 1", () => {
    const mats = createTerrainMaterials(scene);
    expect(mats.opaque.alpha).toBe(1);
  });

  it("transparent material has alpha < 1", () => {
    const mats = createTerrainMaterials(scene);
    expect(mats.transparent.alpha).toBeLessThan(1);
  });

  it("both materials are truthy (not null/undefined)", () => {
    const mats = createTerrainMaterials(scene);
    expect(mats.opaque).toBeTruthy();
    expect(mats.transparent).toBeTruthy();
  });
});
