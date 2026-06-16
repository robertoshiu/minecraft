/**
 * mob-renderer-instanced.test.ts — coverage for the opt-in instanceMode path.
 * The composite path (and its pins) lives in mob-renderer.test.ts, which this
 * file does NOT touch. NullEngine returns no real thin-instance geometry, so we
 * assert structural invariants (no throw, mesh-count = live instances, shadow
 * sink registered once per species, free-list reuse), not pixels.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import { MobRenderer } from "./mob-renderer";
import { Mob } from "../mobs/entity";
import type { ShadowCasterSink } from "./world-renderer";

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

describe("MobRenderer instanceMode", () => {
  it("does not throw syncing live mobs in instance mode", () => {
    const r = new MobRenderer(scene, undefined, true);
    expect(() => {
      r.sync([
        new Mob(1, "cow", { x: 0, y: 64, z: 0 }),
        new Mob(2, "cow", { x: 2, y: 64, z: 0 }),
        new Mob(3, "zombie", { x: 4, y: 64, z: 0 }),
      ]);
    }).not.toThrow();
  });

  it("getMeshCount counts live instances, and drops on despawn", () => {
    const r = new MobRenderer(scene, undefined, true);
    r.sync([
      new Mob(1, "cow", { x: 0, y: 64, z: 0 }),
      new Mob(2, "cow", { x: 2, y: 64, z: 0 }),
    ]);
    expect(r.getMeshCount()).toBe(2);
    r.sync([new Mob(1, "cow", { x: 0, y: 64, z: 0 })]);
    expect(r.getMeshCount()).toBe(1);
  });

  it("registers ONE base mesh per species with the shadow sink", () => {
    const sink = makeMockSink();
    const r = new MobRenderer(scene, sink, true);
    r.sync([
      new Mob(1, "cow", { x: 0, y: 64, z: 0 }),
      new Mob(2, "cow", { x: 2, y: 64, z: 0 }), // same species → no extra base
      new Mob(3, "pig", { x: 4, y: 64, z: 0 }),
    ]);
    // Two species → exactly two base meshes registered (not one per mob).
    expect(sink.added.length).toBe(2);
    expect(sink.removed.length).toBe(0);
  });

  it("dispose removes every species base from the sink", () => {
    const sink = makeMockSink();
    const r = new MobRenderer(scene, sink, true);
    r.sync([
      new Mob(1, "cow", { x: 0, y: 64, z: 0 }),
      new Mob(2, "pig", { x: 2, y: 64, z: 0 }),
    ]);
    const baseCount = sink.added.length;
    r.dispose();
    expect(sink.removed.length).toBe(baseCount);
    expect(r.getMeshCount()).toBe(0);
  });

  it("reuses a freed instance index after despawn+respawn (no unbounded growth)", () => {
    const r = new MobRenderer(scene, undefined, true);
    r.sync([new Mob(1, "cow", { x: 0, y: 64, z: 0 })]);
    r.sync([]); // despawn → index freed
    r.sync([new Mob(2, "cow", { x: 5, y: 64, z: 0 })]); // should reuse index 0
    expect(r.getMeshCount()).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Load-bearing free-list invariants (catch slot collision + always-grow bugs)
  // -------------------------------------------------------------------------

  it("assigns DISTINCT slot indices to simultaneously live mobs (catches always-return-0 collision)", () => {
    const r = new MobRenderer(scene, undefined, true);
    const mob1 = new Mob(10, "cow", { x: 0, y: 64, z: 0 });
    const mob2 = new Mob(11, "cow", { x: 2, y: 64, z: 0 });
    const mob3 = new Mob(12, "cow", { x: 4, y: 64, z: 0 });

    r.sync([mob1, mob2, mob3]);

    const idx1 = r.instanceIndexOf(10);
    const idx2 = r.instanceIndexOf(11);
    const idx3 = r.instanceIndexOf(12);

    expect(idx1).not.toBeUndefined();
    expect(idx2).not.toBeUndefined();
    expect(idx3).not.toBeUndefined();

    // Every live mob must have a UNIQUE slot index.
    expect(idx1).not.toBe(idx2);
    expect(idx1).not.toBe(idx3);
    expect(idx2).not.toBe(idx3);
  });

  it("reuses the freed index (no always-grow): despawn mob1, respawn mob3 → mob3 gets index 0", () => {
    const r = new MobRenderer(scene, undefined, true);
    const mob1 = new Mob(20, "sheep", { x: 0, y: 64, z: 0 });
    const mob2 = new Mob(21, "sheep", { x: 2, y: 64, z: 0 });

    // First sync: mob1 → index 0, mob2 → index 1.
    r.sync([mob1, mob2]);
    const idx1 = r.instanceIndexOf(20);
    const idx2 = r.instanceIndexOf(21);
    expect(idx1).toBe(0);
    expect(idx2).toBe(1);

    // Despawn mob1 only; mob1's slot (0) should be freed.
    r.sync([mob2]);
    expect(r.instanceIndexOf(20)).toBeUndefined();

    // New mob3 must reuse slot 0 (the freed index), NOT grow to 2.
    const mob3 = new Mob(22, "sheep", { x: 4, y: 64, z: 0 });
    r.sync([mob2, mob3]);
    const idx3 = r.instanceIndexOf(22);
    expect(idx3).toBe(0); // reused, not 2 (always-grow would give 2)
    expect(idx3).not.toBe(idx2); // still distinct from mob2's slot
  });

  it("the default (no flag) renderer still uses the composite path", () => {
    const r = new MobRenderer(scene); // instanceMode undefined → false
    r.sync([new Mob(1, "cow", { x: 0, y: 64, z: 0 })]);
    // Composite path names roots mob_<id>.
    expect(scene.getTransformNodeByName("mob_1")).not.toBeNull();
    expect(r.getMeshCount()).toBe(1);
  });
});
