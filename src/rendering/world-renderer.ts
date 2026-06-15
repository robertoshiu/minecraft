/**
 * world-renderer.ts — stateful {@link WorldRenderer} with live remeshing.
 *
 * Owns the Babylon mesh representation of a {@link World}. The world is meshed
 * one 16³ section at a time (each section produces at most one opaque + one
 * transparent {@link Mesh}); sections are keyed by `"cx,sy,cz"` so any single
 * section can be re-meshed in place when a block changes.
 *
 * Cross-section / cross-column face culling uses each neighbor section's
 * opposing border slice (same convention as before): for this section's `px`
 * face we read the +x neighbor's `nx` face, etc. An absent neighbor → null →
 * treated as AIR (the boundary face renders).
 *
 * All chunk meshes share exactly two materials (opaque + transparent) — the
 * existing vertex-color {@link TerrainMaterials}. NO atlas / PBR / shader.
 */

import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

import type { Chunk, FaceDir } from "../chunk/data";
import { meshChunk } from "../meshing/greedy";
import type { NeighborBorders } from "../meshing/types";
import { World } from "../world/world";
import { buildBabylonMesh, createTerrainMaterials, type TerrainMaterials } from "./chunk-mesh";

/**
 * Minimal interface that a shadow generator must implement to participate in
 * leak-safe caster registration. Babylon's CascadedShadowGenerator and
 * ShadowGenerator both satisfy this interface. Tests can inject a mock.
 */
export interface ShadowCasterSink {
  addShadowCaster(mesh: AbstractMesh, includeDescendants?: boolean): unknown;
  removeShadowCaster(mesh: AbstractMesh, includeDescendants?: boolean): unknown;
}

/** Number of stacked sections in a column (world Y 0..255). */
const SECTION_COUNT = 16;
/** Edge length of a section / column in blocks. */
const SECTION_SIZE = 16;

/** The pair of meshes a single section may own (either may be null). */
interface SectionMeshes {
  opaque: Mesh | null;
  transparent: Mesh | null;
}

/** Map key for a section at (cx, sy, cz). */
function sectionKey(cx: number, sy: number, cz: number): string {
  return `${cx},${sy},${cz}`;
}

/**
 * The minimal remesh-notification surface block edits depend on. {@link
 * WorldRenderer} implements it; tests can supply a lightweight stub so the
 * edit logic stays free of any Babylon dependency.
 */
export interface RemeshNotifier {
  blockChanged(wx: number, wy: number, wz: number): void;
}

/**
 * The OPPOSING face direction: the face of a neighbor section that touches this
 * section's `dir` face. For this section's `px` neighbor we want the neighbor's
 * `nx` face (the blocks just outside this section's +x boundary), etc.
 */
const OPPOSING: Record<FaceDir, FaceDir> = {
  px: "nx",
  nx: "px",
  py: "ny",
  ny: "py",
  pz: "nz",
  nz: "pz",
};

/**
 * Look up a section from the world, or `null` if the column is absent or `sy`
 * is out of range. Does NOT generate the column (callers ensure existence).
 */
function sectionAt(world: World, cx: number, sy: number, cz: number): Chunk | null {
  if (sy < 0 || sy >= SECTION_COUNT) return null;
  const column = world.getColumn(cx, cz);
  if (column === undefined) return null;
  return column.sections[sy] ?? null;
}

/**
 * Build the {@link NeighborBorders} for the section at (cx, sy, cz): for each
 * present neighbor pass its OPPOSING-face border slice; absent neighbors are
 * left out (treated as AIR → boundary face renders).
 */
function buildNeighborBorders(world: World, cx: number, sy: number, cz: number): NeighborBorders {
  const borders: NeighborBorders = {};

  const neighborOf: Record<FaceDir, Chunk | null> = {
    px: sectionAt(world, cx + 1, sy, cz),
    nx: sectionAt(world, cx - 1, sy, cz),
    pz: sectionAt(world, cx, sy, cz + 1),
    nz: sectionAt(world, cx, sy, cz - 1),
    py: sectionAt(world, cx, sy + 1, cz),
    ny: sectionAt(world, cx, sy - 1, cz),
  };

  (Object.keys(neighborOf) as FaceDir[]).forEach((dir) => {
    const neighbor = neighborOf[dir];
    borders[dir] = neighbor === null ? null : neighbor.getNeighborBorder(OPPOSING[dir]);
  });

  return borders;
}

/**
 * Stateful renderer that meshes a {@link World} section-by-section and supports
 * in-place live remeshing on block edits.
 */
export class WorldRenderer implements RemeshNotifier {
  private readonly scene: Scene;
  private readonly world: World;
  private readonly materials: TerrainMaterials;
  /** Live meshes keyed by section key `"cx,sy,cz"`. */
  private readonly sections = new Map<string, SectionMeshes>();
  /** Optional shadow caster sink — set before buildInitial for CSM support. */
  private shadowSink: ShadowCasterSink | null = null;

  constructor(scene: Scene, world: World, materials: TerrainMaterials, shadowSink?: ShadowCasterSink) {
    this.scene = scene;
    this.world = world;
    this.materials = materials;
    this.shadowSink = shadowSink ?? null;
  }

  /**
   * Set (or replace) the shadow caster sink. Mesh registrations that have
   * already happened are NOT retroactively updated — call this before
   * buildInitial so all meshes are registered from the start.
   */
  setShadowSink(sink: ShadowCasterSink | null): void {
    this.shadowSink = sink;
  }

  /**
   * Generate + mesh every column in [-radius..radius]² around the origin. All
   * columns are ensured first so neighbor borders are available for culling.
   */
  buildInitial(radiusColumns: number): void {
    for (let cx = -radiusColumns; cx <= radiusColumns; cx++) {
      for (let cz = -radiusColumns; cz <= radiusColumns; cz++) {
        this.world.ensureColumn(cx, cz);
      }
    }

    for (let cx = -radiusColumns; cx <= radiusColumns; cx++) {
      for (let cz = -radiusColumns; cz <= radiusColumns; cz++) {
        for (let sy = 0; sy < SECTION_COUNT; sy++) {
          this.remeshSection(cx, sy, cz);
        }
      }
    }
  }

  /**
   * Rebuild exactly one section's meshes: dispose the old pair, re-mesh against
   * current neighbor borders, and store the result. Empty sections store a
   * null/null entry (and contribute no geometry).
   *
   * Shadow caster registration is leak-safe: existing casters are removed from
   * the sink BEFORE dispose so they never linger in the shadow render list.
   * Newly created opaque meshes are registered as casters; transparent meshes
   * only receive shadows (alpha-shadow cost avoided).
   */
  remeshSection(cx: number, sy: number, cz: number): void {
    const key = sectionKey(cx, sy, cz);

    // Dispose any existing meshes for this section — remove from shadow sink
    // BEFORE dispose so the sink never holds a reference to a disposed mesh.
    const existing = this.sections.get(key);
    if (existing !== undefined) {
      if (existing.opaque !== null) {
        this.shadowSink?.removeShadowCaster(existing.opaque);
        existing.opaque.dispose();
      }
      if (existing.transparent !== null) {
        existing.transparent.dispose();
      }
    }

    const section = sectionAt(this.world, cx, sy, cz);
    if (section === null || section.isEmpty()) {
      this.sections.set(key, { opaque: null, transparent: null });
      return;
    }

    const neighbors = buildNeighborBorders(this.world, cx, sy, cz);
    const chunkMesh = meshChunk(section, neighbors);

    const originX = cx * SECTION_SIZE;
    const originY = sy * SECTION_SIZE;
    const originZ = cz * SECTION_SIZE;
    const baseName = `chunk_${cx}_${sy}_${cz}`;

    const opaque = buildBabylonMesh(
      `${baseName}_opaque`,
      chunkMesh.opaque,
      this.scene,
      originX,
      originY,
      originZ,
    );
    if (opaque !== null) {
      opaque.material = this.materials.opaque;
      opaque.receiveShadows = true;
      // Register as a caster once on creation — NOT per-frame.
      this.shadowSink?.addShadowCaster(opaque);
    }

    const transparent = buildBabylonMesh(
      `${baseName}_transparent`,
      chunkMesh.transparent,
      this.scene,
      originX,
      originY,
      originZ,
    );
    if (transparent !== null) {
      transparent.material = this.materials.transparent;
      // Transparent meshes receive shadows but do NOT cast them (avoid alpha-shadow cost).
      transparent.receiveShadows = true;
    }

    this.sections.set(key, { opaque, transparent });
  }

  /**
   * Notify the renderer that the block at absolute world coords changed.
   * Re-meshes the owning section and any neighbor section whose border is
   * touched (i.e. when the changed block sits on a section boundary plane).
   */
  blockChanged(wx: number, wy: number, wz: number): void {
    const cx = Math.floor(wx / SECTION_SIZE);
    const sy = Math.floor(wy / SECTION_SIZE);
    const cz = Math.floor(wz / SECTION_SIZE);

    this.remeshSection(cx, sy, cz);

    // Local coords within the section; a 0 or 15 means the change is on a
    // boundary plane and the adjacent section's culling must be refreshed.
    const lx = ((wx % SECTION_SIZE) + SECTION_SIZE) % SECTION_SIZE;
    const ly = ((wy % SECTION_SIZE) + SECTION_SIZE) % SECTION_SIZE;
    const lz = ((wz % SECTION_SIZE) + SECTION_SIZE) % SECTION_SIZE;

    if (lx === 0) this.remeshSection(cx - 1, sy, cz);
    if (lx === SECTION_SIZE - 1) this.remeshSection(cx + 1, sy, cz);
    if (ly === 0) this.remeshSection(cx, sy - 1, cz);
    if (ly === SECTION_SIZE - 1) this.remeshSection(cx, sy + 1, cz);
    if (lz === 0) this.remeshSection(cx, sy, cz - 1);
    if (lz === SECTION_SIZE - 1) this.remeshSection(cx, sy, cz + 1);
  }

  /**
   * Dispose all current section meshes (removing shadow casters first), then
   * rebuild the world at the new radius. Safe to call with a different radius
   * than the original {@link buildInitial} call.
   */
  rebuild(radiusColumns: number): void {
    // Dispose all existing sections — remove shadow casters BEFORE dispose.
    for (const { opaque, transparent } of this.sections.values()) {
      if (opaque !== null) {
        this.shadowSink?.removeShadowCaster(opaque);
        opaque.dispose();
      }
      if (transparent !== null) {
        transparent.dispose();
      }
    }
    this.sections.clear();

    // Re-build at the new radius.
    this.buildInitial(radiusColumns);
  }

  /** Total number of live (non-null) meshes across all sections. */
  getMeshCount(): number {
    let count = 0;
    for (const { opaque, transparent } of this.sections.values()) {
      if (opaque !== null) count++;
      if (transparent !== null) count++;
    }
    return count;
  }

  /**
   * Return the first live opaque mesh found in the sections map, or null if
   * none exist yet. Used by the readiness diagnostic to pass a real mesh to
   * `material.isReady(mesh)` — PushMaterial always returns false when called
   * with no mesh argument, giving a spurious "material not ready" diagnostic.
   */
  getFirstOpaqueMesh(): Mesh | null {
    for (const { opaque } of this.sections.values()) {
      if (opaque !== null) return opaque;
    }
    return null;
  }
}

export { createTerrainMaterials };
