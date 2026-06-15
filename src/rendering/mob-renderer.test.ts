/**
 * mob-renderer.test.ts — tests for the composite-model MobRenderer.
 *
 * Invariants tested:
 *  - sync() creates one root TransformNode per mob (found via getTransformNodeByName).
 *  - Root position ≈ feet, rotation.y ≈ yaw.
 *  - The same root instance is reused across syncs (no churn).
 *  - getMeshCount() counts roots (mobs), not part meshes.
 *  - Despawned mobs: root removed, getMeshCount drops.
 *  - Material sharing: two mobs of the same type share part materials.
 *  - Shadow sink leak-safety: add/remove counts match; removed meshes are disposed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import { MobRenderer } from "./mob-renderer";
import { Mob } from "../mobs/entity";
import type { ShadowCasterSink } from "./world-renderer";

/** Mock shadow caster sink that records all add/remove calls. */
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

beforeEach(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterEach(() => {
  scene.dispose();
  engine.dispose();
});

// ---------------------------------------------------------------------------
// Core sync invariants
// ---------------------------------------------------------------------------

describe("MobRenderer.sync — core", () => {
  it("creates one root TransformNode per mob at feet position + yaw", () => {
    const r = new MobRenderer(scene);
    const cow = new Mob(1, "cow", { x: 5, y: 64, z: -3 });
    cow.yaw = 1.25;

    r.sync([cow]);

    expect(r.getMeshCount()).toBe(1);

    // Root is a TransformNode, NOT a Mesh.
    const root = scene.getTransformNodeByName("mob_1");
    expect(root).not.toBeNull();
    expect(root?.position.x).toBeCloseTo(5);
    expect(root?.position.y).toBeCloseTo(64);
    expect(root?.position.z).toBeCloseTo(-3);
    expect(root?.rotation.y).toBeCloseTo(1.25);
  });

  it("reuses the same root instance across syncs and repositions it", () => {
    const r = new MobRenderer(scene);
    const pig = new Mob(2, "pig", { x: 0, y: 64, z: 0 });

    r.sync([pig]);
    const first = scene.getTransformNodeByName("mob_2");
    expect(first).not.toBeNull();

    // Move the mob, re-sync.
    pig.feet = { x: 10, y: 70, z: 2 };
    r.sync([pig]);

    // Same root instance — no churn.
    expect(r.getMeshCount()).toBe(1);
    expect(scene.getTransformNodeByName("mob_2")).toBe(first);
    expect(first?.position.x).toBeCloseTo(10);
    expect(first?.position.y).toBeCloseTo(70);
  });

  it("disposes the root of a mob that is no longer present", () => {
    const r = new MobRenderer(scene);
    const a = new Mob(1, "sheep", { x: 0, y: 64, z: 0 });
    const b = new Mob(2, "chicken", { x: 1, y: 64, z: 1 });

    r.sync([a, b]);
    expect(r.getMeshCount()).toBe(2);

    // b despawns.
    r.sync([a]);
    expect(r.getMeshCount()).toBe(1);
    // b's root should be gone from the scene.
    expect(scene.getTransformNodeByName("mob_2")).toBeNull();
    // a's root still exists.
    expect(scene.getTransformNodeByName("mob_1")).not.toBeNull();
  });

  it("getMeshCount() counts mob roots, not part meshes", () => {
    const r = new MobRenderer(scene);
    r.sync([
      new Mob(1, "zombie", { x: 0, y: 64, z: 0 }),
      new Mob(2, "skeleton", { x: 2, y: 64, z: 0 }),
      new Mob(3, "creeper", { x: 4, y: 64, z: 0 }),
    ]);
    // Should be 3 (one per mob), not the sum of all part meshes.
    expect(r.getMeshCount()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Material sharing
// ---------------------------------------------------------------------------

describe("MobRenderer — material sharing", () => {
  it("two mobs of the same type share materials for same-colored parts", () => {
    const r = new MobRenderer(scene);
    const z1 = new Mob(1, "zombie", { x: 0, y: 64, z: 0 });
    const z2 = new Mob(2, "zombie", { x: 2, y: 64, z: 0 });

    r.sync([z1, z2]);

    const root1 = scene.getTransformNodeByName("mob_1");
    const root2 = scene.getTransformNodeByName("mob_2");
    expect(root1).not.toBeNull();
    expect(root2).not.toBeNull();

    const meshes1 = root1!.getChildMeshes(false);
    const meshes2 = root2!.getChildMeshes(false);
    expect(meshes1.length).toBeGreaterThan(0);
    expect(meshes2.length).toBeGreaterThan(0);

    // At least the first (body) part of each zombie should share the same material.
    const mat1 = meshes1[0]!.material;
    const mat2 = meshes2[0]!.material;
    expect(mat1).not.toBeNull();
    expect(mat1).toBe(mat2);
  });
});

// ---------------------------------------------------------------------------
// Shadow sink leak-safety
// ---------------------------------------------------------------------------

describe("MobRenderer — shadow sink leak-safety", () => {
  it("all part meshes are registered with the sink on first sync", () => {
    const sink = makeMockSink();
    const r = new MobRenderer(scene, sink);

    const a = new Mob(1, "zombie", { x: 0, y: 64, z: 0 });
    const b = new Mob(2, "cow",    { x: 2, y: 64, z: 0 });

    r.sync([a, b]);

    // Count actual child meshes across both roots to get the expected total.
    const rootA = scene.getTransformNodeByName("mob_1")!;
    const rootB = scene.getTransformNodeByName("mob_2")!;
    const expectedAdded =
      rootA.getChildMeshes(false).length +
      rootB.getChildMeshes(false).length;

    expect(sink.added.length).toBe(expectedAdded);
    expect(sink.added.length).toBeGreaterThan(0);
    expect(sink.removed.length).toBe(0);
  });

  it("all part meshes of a despawned mob are removed from the sink and disposed", () => {
    const sink = makeMockSink();
    const r = new MobRenderer(scene, sink);

    const a = new Mob(1, "sheep",   { x: 0, y: 64, z: 0 });
    const b = new Mob(2, "chicken", { x: 1, y: 64, z: 1 });

    r.sync([a, b]);

    const rootB = scene.getTransformNodeByName("mob_2")!;
    const bPartCount = rootB.getChildMeshes(false).length;
    const totalAdded = sink.added.length;

    // b despawns.
    r.sync([a]);

    // Exactly b's part meshes should have been removed.
    expect(sink.removed.length).toBe(bPartCount);

    // All removed meshes were previously in the added set.
    const addedSet = new Set(sink.added);
    for (const mesh of sink.removed) {
      expect(addedSet.has(mesh)).toBe(true);
    }

    // All removed meshes are disposed.
    for (const mesh of sink.removed) {
      expect(mesh.isDisposed()).toBe(true);
    }

    // a's meshes are still alive (not in removed).
    const rootA = scene.getTransformNodeByName("mob_1")!;
    const aMeshes = rootA.getChildMeshes(false);
    expect(aMeshes.length).toBe(totalAdded - bPartCount);
    for (const m of aMeshes) {
      expect(m.isDisposed()).toBe(false);
    }
  });

  it("despawning all mobs: removed count === added count and all meshes disposed", () => {
    const sink = makeMockSink();
    const r = new MobRenderer(scene, sink);

    r.sync([
      new Mob(1, "zombie",   { x: 0, y: 64, z: 0 }),
      new Mob(2, "skeleton", { x: 2, y: 64, z: 0 }),
      new Mob(3, "creeper",  { x: 4, y: 64, z: 0 }),
    ]);

    const totalAdded = sink.added.length;
    expect(totalAdded).toBeGreaterThan(0);

    // Despawn all.
    r.sync([]);

    expect(sink.removed.length).toBe(totalAdded);
    expect(r.getMeshCount()).toBe(0);

    const addedSet = new Set(sink.added);
    for (const mesh of sink.removed) {
      expect(addedSet.has(mesh)).toBe(true);
      expect(mesh.isDisposed()).toBe(true);
    }
  });

  it("dispose() removes all part meshes from sink and disposes them", () => {
    const sink = makeMockSink();
    const r = new MobRenderer(scene, sink);

    r.sync([
      new Mob(1, "cow", { x: 0, y: 64, z: 0 }),
      new Mob(2, "pig", { x: 1, y: 64, z: 0 }),
    ]);

    const totalAdded = sink.added.length;
    expect(totalAdded).toBeGreaterThan(0);

    r.dispose();

    expect(r.getMeshCount()).toBe(0);
    expect(sink.removed.length).toBe(totalAdded);

    // All removed meshes are disposed.
    for (const mesh of sink.removed) {
      expect(mesh.isDisposed()).toBe(true);
    }

    // Every removed mesh was in the added set.
    const addedSet = new Set(sink.added);
    for (const mesh of sink.removed) {
      expect(addedSet.has(mesh)).toBe(true);
    }
  });

  it("no sink call is made for static (non-leg) parts that are not re-added on sync", () => {
    const sink = makeMockSink();
    const r = new MobRenderer(scene, sink);

    const mob = new Mob(1, "pig", { x: 0, y: 64, z: 0 });
    r.sync([mob]);
    const addedAfterFirstSync = sink.added.length;

    // Sync again — same mob, no new meshes should be created.
    mob.feet = { x: 1, y: 64, z: 1 };
    r.sync([mob]);

    // No new adds or removes on re-sync of an existing mob.
    expect(sink.added.length).toBe(addedAfterFirstSync);
    expect(sink.removed.length).toBe(0);
  });
});
