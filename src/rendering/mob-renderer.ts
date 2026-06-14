/**
 * mob-renderer.ts — flat-colored box renderer for live mobs.
 *
 * Mirrors the world's vertex-color aesthetic: NO atlas, NO PBR. Each mob is a
 * single unlit-ish {@link StandardMaterial} box sized to its type's hitbox
 * (width × height × width). One material is cached PER TYPE (not per mob), one
 * box {@link Mesh} per live mob keyed by mob id.
 *
 * {@link MobRenderer.sync} is called every frame against the current live-mob
 * snapshot: it creates a box for any new mob, repositions/rotates every live
 * box (box center = feet + height/2; rotation.y = mob.yaw), and disposes the
 * box of any mob whose id is no longer present. Mobs MOVE, so we never
 * `freezeWorldMatrix`.
 */

import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";

import type { Mob } from "../mobs/entity";
import { MOB_STATS, type MobType } from "../rules/mob-stats";
import type { ShadowCasterSink } from "./world-renderer";

/** Flat color per mob type (matches the vertex-color world; no textures). */
const MOB_COLORS: Record<MobType, string> = {
  zombie: "#3a7d3a",
  skeleton: "#d8d8d0",
  creeper: "#2f7d33",
  cow: "#6b4f3a",
  pig: "#e0a0a8",
  sheep: "#e8e8e0",
  chicken: "#f0e8c0",
};

/**
 * Renders one flat-colored box per live mob. Owns its meshes + a per-type
 * material cache; the caller owns the mob list and calls {@link sync} each frame.
 */
export class MobRenderer {
  private readonly scene: Scene;
  /** Live box meshes keyed by mob id. */
  private readonly meshes = new Map<number, Mesh>();
  /** One shared material per mob type (created on first use). */
  private readonly materials = new Map<MobType, StandardMaterial>();
  /** Optional shadow caster sink for CSM registration. */
  private shadowSink: ShadowCasterSink | null = null;

  constructor(scene: Scene, shadowSink?: ShadowCasterSink) {
    this.scene = scene;
    this.shadowSink = shadowSink ?? null;
  }

  /**
   * Set (or replace) the shadow caster sink. Existing mob meshes are NOT
   * retroactively registered — call this before the first sync.
   */
  setShadowSink(sink: ShadowCasterSink | null): void {
    this.shadowSink = sink;
  }

  /** The shared material for `type`, created + cached on first request. */
  private materialFor(type: MobType): StandardMaterial {
    const existing = this.materials.get(type);
    if (existing !== undefined) return existing;

    const mat = new StandardMaterial(`mob-${type}`, this.scene);
    const color = Color3.FromHexString(MOB_COLORS[type]);
    mat.diffuseColor = color;
    // Black specular keeps the boxes matte like the terrain (no plastic sheen).
    mat.specularColor = new Color3(0, 0, 0);
    this.materials.set(type, mat);
    return mat;
  }

  /** Create the box mesh for `mob`, sized to its type and colored per type. */
  private createMesh(mob: Mob): Mesh {
    const stats = MOB_STATS[mob.type];
    const box = CreateBox(
      `mob_${mob.id}`,
      { width: stats.width, height: stats.height, depth: stats.width },
      this.scene,
    );
    box.material = this.materialFor(mob.type);
    box.receiveShadows = true;
    // Register as a caster once on creation — NOT per-frame.
    this.shadowSink?.addShadowCaster(box);
    return box;
  }

  /**
   * Reconcile the rendered boxes with the live mob list:
   *  - create a box for any mob without one,
   *  - update every live box's position (center = feet + height/2) + yaw,
   *  - dispose any box whose mob id is gone.
   */
  sync(mobs: Mob[]): void {
    const seen = new Set<number>();

    for (const mob of mobs) {
      seen.add(mob.id);
      let mesh = this.meshes.get(mob.id);
      if (mesh === undefined) {
        mesh = this.createMesh(mob);
        this.meshes.set(mob.id, mesh);
      }

      const stats = MOB_STATS[mob.type];
      // Box center sits at the vertical middle of the hitbox; feet is the bottom.
      mesh.position.set(
        mob.feet.x,
        mob.feet.y + stats.height / 2,
        mob.feet.z,
      );
      mesh.rotation.y = mob.yaw;
    }

    // Dispose meshes for mobs that no longer exist — remove from shadow sink
    // BEFORE dispose so the sink never holds a reference to a disposed mesh.
    for (const [id, mesh] of this.meshes) {
      if (seen.has(id)) continue;
      this.shadowSink?.removeShadowCaster(mesh);
      mesh.dispose();
      this.meshes.delete(id);
    }
  }

  /** Number of live mob meshes currently rendered. */
  getMeshCount(): number {
    return this.meshes.size;
  }

  /** Dispose all mob meshes + the per-type materials. */
  dispose(): void {
    for (const mesh of this.meshes.values()) {
      this.shadowSink?.removeShadowCaster(mesh);
      mesh.dispose();
    }
    this.meshes.clear();
    for (const mat of this.materials.values()) mat.dispose();
    this.materials.clear();
  }
}
