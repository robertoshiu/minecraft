/**
 * splash-renderer.ts — Babylon rendering for in-flight splash potions (Phase
 * 6b). Mirrors ArrowRenderer: a Map<number, record> of root TransformNode +
 * one sphere mesh. On each sync(potions, nowMs?): create a sphere for new ids,
 * reposition live ids, dispose records whose id vanished. A single shared
 * translucent purple StandardMaterial is used for all potions (NOT per-mesh),
 * so one potion's burst never frees the shared material.
 *
 * Per-instance disposal uses dispose(false, false): potions die one-at-a-time
 * and share one material, so freeing the material per-burst would break the
 * others. The shared material is freed once in dispose().
 */

import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { SplashPotion } from "../potions/entity";
import type { ShadowCasterSink } from "./world-renderer";

interface SplashRecord {
  root: TransformNode;
  mesh: Mesh;
}

export class SplashPotionRenderer {
  private readonly scene: Scene;
  private readonly records = new Map<number, SplashRecord>();
  private readonly shadowSink: ShadowCasterSink | null;
  private material: StandardMaterial | null = null;

  constructor(scene: Scene, shadowSink?: ShadowCasterSink) {
    this.scene = scene;
    this.shadowSink = shadowSink ?? null;
  }

  private sharedMaterial(): StandardMaterial {
    if (this.material === null) {
      const mat = new StandardMaterial("splash_potion_mat", this.scene);
      mat.diffuseColor = new Color3(0.55, 0.1, 0.9); // translucent purple
      mat.alpha = 0.6;
      this.material = mat;
    }
    return this.material;
  }

  /** Reconcile rendered potions with the live list each frame. */
  sync(potions: SplashPotion[], nowMs?: number): void {
    void nowMs; // no per-frame animation; param kept for symmetry with ArrowRenderer
    const seen = new Set<number>();
    for (const potion of potions) {
      seen.add(potion.id);
      let record = this.records.get(potion.id);
      if (record === undefined) {
        const root = new TransformNode(`splash_${potion.id}`, this.scene);
        const mesh = CreateSphere(
          `splash_${potion.id}_mesh`,
          { diameter: 0.3 },
          this.scene,
        );
        mesh.material = this.sharedMaterial();
        mesh.parent = root;
        this.shadowSink?.addShadowCaster(mesh);
        record = { root, mesh };
        this.records.set(potion.id, record);
      }
      record.root.position.set(potion.feet.x, potion.feet.y, potion.feet.z);
    }
    // Dispose potions that are gone. dispose(false, false): recurse to free the
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
