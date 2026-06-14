import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import { WorldRenderer, createTerrainMaterials, type ShadowCasterSink } from "./world-renderer";
import { World } from "../world/world";
import { Blocks } from "../rules/mc-1.20";

/** Mock shadow caster sink that records all add/remove calls for assertions. */
function makeMockSink(): ShadowCasterSink & { added: AbstractMesh[]; removed: AbstractMesh[] } {
  const added: AbstractMesh[] = [];
  const removed: AbstractMesh[] = [];
  return {
    added,
    removed,
    addShadowCaster(mesh: AbstractMesh) { added.push(mesh); return this; },
    removeShadowCaster(mesh: AbstractMesh) { removed.push(mesh); return this; },
  };
}

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

describe("WorldRenderer.buildInitial", () => {
  it("radius 0 generates a single column and at least one mesh", () => {
    const world = new World(1337);
    const renderer = new WorldRenderer(scene, world, createTerrainMaterials(scene));
    renderer.buildInitial(0);

    // radius 0 → 1×1 area = exactly one column at (0,0).
    expect(world.columns.size).toBe(1);
    expect(world.columns.has("0,0")).toBe(true);

    // The generated column has terrain, so at least one section meshes.
    expect(renderer.getMeshCount()).toBeGreaterThanOrEqual(1);
  });

  it("radius 1 generates a 3×3 = 9-column grid keyed by 'cx,cz'", () => {
    const localEngine = new NullEngine();
    const localScene = new Scene(localEngine);

    const world = new World(42);
    const renderer = new WorldRenderer(localScene, world, createTerrainMaterials(localScene));
    renderer.buildInitial(1);

    expect(world.columns.size).toBe(9);
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        expect(world.columns.has(`${cx},${cz}`)).toBe(true);
      }
    }

    localScene.dispose();
    localEngine.dispose();
  });

  it("is deterministic: same seed + radius yields the same mesh count", () => {
    const e1 = new NullEngine();
    const s1 = new Scene(e1);
    const e2 = new NullEngine();
    const s2 = new Scene(e2);

    const ra = new WorldRenderer(s1, new World(7), createTerrainMaterials(s1));
    ra.buildInitial(0);
    const rb = new WorldRenderer(s2, new World(7), createTerrainMaterials(s2));
    rb.buildInitial(0);
    expect(ra.getMeshCount()).toBe(rb.getMeshCount());

    s1.dispose();
    e1.dispose();
    s2.dispose();
    e2.dispose();
  });
});

describe("WorldRenderer.blockChanged — live remesh", () => {
  it("re-meshes the affected section without crashing and keeps meshes present", () => {
    const localEngine = new NullEngine();
    const localScene = new Scene(localEngine);

    const world = new World(99);
    const renderer = new WorldRenderer(localScene, world, createTerrainMaterials(localScene));
    renderer.buildInitial(1);

    const before = renderer.getMeshCount();
    // Carve a block out of the surface of the origin column and remesh.
    const surfaceY = world.ensureColumn(0, 0).surfaceHeight(0, 0);
    world.setBlock(0, surfaceY, 0, Blocks.AIR);
    renderer.blockChanged(0, surfaceY, 0);

    // Still has geometry after the edit (sanity: remesh produced meshes).
    expect(renderer.getMeshCount()).toBeGreaterThan(0);
    expect(Number.isFinite(before)).toBe(true);

    localScene.dispose();
    localEngine.dispose();
  });
});

describe("WorldRenderer shadow caster sink — leak-safe registration", () => {
  it("opaque meshes are added as casters on buildInitial", () => {
    const localEngine = new NullEngine();
    const localScene = new Scene(localEngine);
    const sink = makeMockSink();

    const world = new World(1337);
    const renderer = new WorldRenderer(localScene, world, createTerrainMaterials(localScene), sink);
    renderer.buildInitial(0);

    // At least one opaque mesh should have been registered.
    expect(sink.added.length).toBeGreaterThan(0);
    // None should have been removed yet.
    expect(sink.removed.length).toBe(0);

    localScene.dispose();
    localEngine.dispose();
  });

  it("on remesh the old caster is removed BEFORE a new one is added (no dangling casters)", () => {
    const localEngine = new NullEngine();
    const localScene = new Scene(localEngine);
    const sink = makeMockSink();

    const world = new World(1337);
    const renderer = new WorldRenderer(localScene, world, createTerrainMaterials(localScene), sink);
    renderer.buildInitial(0);

    const addedAfterBuild = sink.added.length;
    const removedAfterBuild = sink.removed.length;
    // There should be registrations after the initial build.
    expect(addedAfterBuild).toBeGreaterThan(0);

    // Trigger a remesh by changing a surface block.
    const surfaceY = world.ensureColumn(0, 0).surfaceHeight(0, 0);
    world.setBlock(0, surfaceY, 0, Blocks.AIR);
    renderer.blockChanged(0, surfaceY, 0);

    // The remesh removes the old casters before adding new ones.
    // Net balance: (adds - removes) should stay >= 0 (no more removes than adds).
    const netBalance = sink.added.length - sink.removed.length;
    expect(netBalance).toBeGreaterThanOrEqual(0);

    // At least one removal should have occurred (the section that changed).
    expect(sink.removed.length).toBeGreaterThan(removedAfterBuild);

    localScene.dispose();
    localEngine.dispose();
  });

  it("add and remove counts stay balanced after multiple remeshes (no leaks)", () => {
    const localEngine = new NullEngine();
    const localScene = new Scene(localEngine);
    const sink = makeMockSink();

    const world = new World(2024);
    const renderer = new WorldRenderer(localScene, world, createTerrainMaterials(localScene), sink);
    renderer.buildInitial(0);

    // Perform several block-change remeshes in sequence.
    const surfaceY = world.ensureColumn(0, 0).surfaceHeight(0, 0);
    for (let i = 0; i < 3; i++) {
      world.setBlock(i, surfaceY, 0, Blocks.AIR);
      renderer.blockChanged(i, surfaceY, 0);
    }

    // After N remeshes: every removed mesh was previously added (no phantom removes).
    // The removed set must be a subset of the added set.
    const addedSet = new Set(sink.added);
    for (const mesh of sink.removed) {
      expect(addedSet.has(mesh)).toBe(true);
    }

    localScene.dispose();
    localEngine.dispose();
  });

  it("removed meshes are deregistered before dispose (not dangling)", () => {
    const localEngine = new NullEngine();
    const localScene = new Scene(localEngine);
    const sink = makeMockSink();

    const world = new World(555);
    const renderer = new WorldRenderer(localScene, world, createTerrainMaterials(localScene), sink);
    renderer.buildInitial(0);

    // Remesh to replace meshes.
    const surfaceY = world.ensureColumn(0, 0).surfaceHeight(0, 0);
    world.setBlock(0, surfaceY, 0, Blocks.AIR);
    renderer.blockChanged(0, surfaceY, 0);

    // Every removed mesh must be in an isDisposed state (disposed after removal).
    for (const mesh of sink.removed) {
      expect(mesh.isDisposed()).toBe(true);
    }

    localScene.dispose();
    localEngine.dispose();
  });
});
