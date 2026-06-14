import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import { MobRenderer } from "./mob-renderer";
import { Mob } from "../mobs/entity";
import { MOB_STATS } from "../rules/mob-stats";
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

describe("MobRenderer.sync", () => {
  it("creates one box per live mob and positions it at feet + height/2", () => {
    const r = new MobRenderer(scene);
    const cow = new Mob(1, "cow", { x: 5, y: 64, z: -3 });
    cow.yaw = 1.25;

    r.sync([cow]);

    expect(r.getMeshCount()).toBe(1);
    const mesh = scene.getMeshByName("mob_1");
    expect(mesh).not.toBeNull();
    const height = MOB_STATS.cow.height;
    expect(mesh?.position.x).toBeCloseTo(5);
    expect(mesh?.position.y).toBeCloseTo(64 + height / 2);
    expect(mesh?.position.z).toBeCloseTo(-3);
    expect(mesh?.rotation.y).toBeCloseTo(1.25);
  });

  it("reuses the same mesh across syncs and updates its position", () => {
    const r = new MobRenderer(scene);
    const pig = new Mob(2, "pig", { x: 0, y: 64, z: 0 });

    r.sync([pig]);
    const first = scene.getMeshByName("mob_2");
    expect(first).not.toBeNull();

    pig.feet = { x: 10, y: 70, z: 2 };
    r.sync([pig]);

    // Same mesh instance reused (no churn), repositioned.
    expect(r.getMeshCount()).toBe(1);
    expect(scene.getMeshByName("mob_2")).toBe(first);
    expect(first?.position.x).toBeCloseTo(10);
  });

  it("disposes the box of a mob that is no longer present", () => {
    const r = new MobRenderer(scene);
    const a = new Mob(1, "sheep", { x: 0, y: 64, z: 0 });
    const b = new Mob(2, "chicken", { x: 1, y: 64, z: 1 });

    r.sync([a, b]);
    expect(r.getMeshCount()).toBe(2);

    // b leaves the world.
    r.sync([a]);
    expect(r.getMeshCount()).toBe(1);
    expect(scene.getMeshByName("mob_2")).toBeNull();
    expect(scene.getMeshByName("mob_1")).not.toBeNull();
  });

  it("shares ONE material per type across multiple mobs of that type", () => {
    const r = new MobRenderer(scene);
    const z1 = new Mob(1, "zombie", { x: 0, y: 64, z: 0 });
    const z2 = new Mob(2, "zombie", { x: 2, y: 64, z: 0 });

    r.sync([z1, z2]);

    const m1 = scene.getMeshByName("mob_1");
    const m2 = scene.getMeshByName("mob_2");
    expect(m1?.material).toBe(m2?.material);
  });

  it("dispose() removes every mob mesh", () => {
    const r = new MobRenderer(scene);
    r.sync([
      new Mob(1, "cow", { x: 0, y: 64, z: 0 }),
      new Mob(2, "pig", { x: 1, y: 64, z: 0 }),
    ]);
    expect(r.getMeshCount()).toBe(2);

    r.dispose();
    expect(r.getMeshCount()).toBe(0);
  });
});

describe("MobRenderer shadow caster sink — leak-safe registration", () => {
  it("mob meshes are added as casters when synced for the first time", () => {
    const sink = makeMockSink();
    const r = new MobRenderer(scene, sink);

    r.sync([
      new Mob(1, "zombie", { x: 0, y: 64, z: 0 }),
      new Mob(2, "cow", { x: 1, y: 64, z: 0 }),
    ]);

    // Both mobs should have been registered as casters.
    expect(sink.added.length).toBe(2);
    expect(sink.removed.length).toBe(0);
  });

  it("a mesh is removed from the sink when the mob despawns (before dispose)", () => {
    const sink = makeMockSink();
    const r = new MobRenderer(scene, sink);

    const a = new Mob(1, "sheep", { x: 0, y: 64, z: 0 });
    const b = new Mob(2, "pig", { x: 1, y: 64, z: 0 });

    r.sync([a, b]);
    expect(sink.added.length).toBe(2);

    // b despawns.
    r.sync([a]);
    expect(sink.removed.length).toBe(1);

    // The removed mesh should be disposed.
    const removedMesh = sink.removed[0];
    expect(removedMesh).toBeDefined();
    if (removedMesh !== undefined) {
      expect(removedMesh.isDisposed()).toBe(true);
    }
  });

  it("add and remove counts stay balanced — no caster leaks after despawns", () => {
    const sink = makeMockSink();
    const r = new MobRenderer(scene, sink);

    const mobs = [
      new Mob(1, "zombie", { x: 0, y: 64, z: 0 }),
      new Mob(2, "skeleton", { x: 2, y: 64, z: 0 }),
      new Mob(3, "creeper", { x: 4, y: 64, z: 0 }),
    ];

    r.sync(mobs);
    expect(sink.added.length).toBe(3);

    // Despawn all mobs.
    r.sync([]);
    expect(sink.removed.length).toBe(3);

    // Every removed mesh was previously added.
    const addedSet = new Set(sink.added);
    for (const mesh of sink.removed) {
      expect(addedSet.has(mesh)).toBe(true);
    }
  });

  it("dispose() removes all mob meshes from sink before disposing them", () => {
    const sink = makeMockSink();
    const r = new MobRenderer(scene, sink);

    r.sync([
      new Mob(1, "cow", { x: 0, y: 64, z: 0 }),
      new Mob(2, "pig", { x: 1, y: 64, z: 0 }),
    ]);
    expect(sink.added.length).toBe(2);

    r.dispose();
    expect(sink.removed.length).toBe(2);

    // All removed meshes are disposed.
    for (const mesh of sink.removed) {
      expect(mesh.isDisposed()).toBe(true);
    }
  });
});
