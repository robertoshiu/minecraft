/**
 * arrow-renderer.ts — Babylon rendering for in-flight arrows (Phase 5). Mirrors
 * MobRenderer: a Map<number, record> of root TransformNode + one elongated box.
 * On each sync(arrows, nowMs?): create a box for new ids, reposition + orient
 * live ids along their velocity, dispose records whose id vanished. A single
 * shared brown material is used for all arrows (NOT the MobRenderer's cache).
 *
 * Per-instance disposal uses dispose(false, false): arrows die one-at-a-time and
 * share one material, so freeing the material per-arrow would break the others.
 * The shared material is freed once in dispose().
 */

import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Arrow } from "../arrows/entity";
import { ARROW } from "../rules/mc-1.20";
import type { ShadowCasterSink } from "./world-renderer";

interface ArrowRecord {
  root: TransformNode;
  mesh: Mesh;
}

export class ArrowRenderer {
  private readonly scene: Scene;
  private readonly records = new Map<number, ArrowRecord>();
  private readonly shadowSink: ShadowCasterSink | null;
  private material: StandardMaterial | null = null;

  constructor(scene: Scene, shadowSink?: ShadowCasterSink) {
    this.scene = scene;
    this.shadowSink = shadowSink ?? null;
  }

  private sharedMaterial(): StandardMaterial {
    if (this.material === null) {
      const mat = new StandardMaterial("arrow_mat", this.scene);
      mat.diffuseColor = new Color3(0.55, 0.4, 0.25); // wooden shaft
      this.material = mat;
    }
    return this.material;
  }

  /** Reconcile rendered arrows with the live list each frame. */
  sync(arrows: Arrow[], nowMs?: number): void {
    void nowMs; // arrows have no per-frame animation; param kept for symmetry
    const seen = new Set<number>();
    for (const arrow of arrows) {
      seen.add(arrow.id);
      let record = this.records.get(arrow.id);
      if (record === undefined) {
        const root = new TransformNode(`arrow_${arrow.id}`, this.scene);
        const mesh = CreateBox(
          `arrow_${arrow.id}_mesh`,
          { width: ARROW.WIDTH, height: ARROW.WIDTH, depth: ARROW.LENGTH },
          this.scene,
        );
        mesh.material = this.sharedMaterial();
        mesh.parent = root;
        this.shadowSink?.addShadowCaster(mesh);
        record = { root, mesh };
        this.records.set(arrow.id, record);
      }
      record.root.position.set(arrow.feet.x, arrow.feet.y, arrow.feet.z);
      // Orient along velocity: yaw from XZ, pitch from vy.
      const v = arrow.velocity;
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed > 1e-6) {
        record.root.rotation.y = Math.atan2(v.x, v.z);
        record.root.rotation.x = -Math.asin(Math.max(-1, Math.min(1, v.y / speed)));
      }
    }
    // Dispose arrows that are gone. dispose(false, false): recurse to free the
    // mesh/geometry but DO NOT dispose the SHARED material (freed once below).
    for (const [id, record] of this.records) {
      if (seen.has(id)) continue;
      this.shadowSink?.removeShadowCaster(record.mesh);
      record.root.dispose(false, false);
      this.records.delete(id);
    }
  }

  /** Tear down all records + the shared material. */
  dispose(): void {
    for (const [, record] of this.records) {
      this.shadowSink?.removeShadowCaster(record.mesh);
      record.root.dispose(false, false); // free meshes; shared material disposed once below
    }
    this.records.clear();
    this.material?.dispose();
    this.material = null;
  }
}
