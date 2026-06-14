/**
 * chunk-mesh.ts — turn greedy-mesher {@link MeshData} into a Babylon {@link Mesh}.
 *
 * Two rendering paths are supported via the {@link USE_ATLAS} flag imported
 * from terrain-material:
 *
 *  - Atlas path (USE_ATLAS=true, default): positions/normals/uvs/indices are
 *    applied via VertexData, then a custom per-vertex float attribute "tileIndex"
 *    is set via setVerticesData. The AtlasMaterialPlugin on the shared material
 *    reads this attribute in the shader to look up the correct tile in the
 *    1024×1024 atlas. Vertex colors are NOT baked.
 *
 *  - Legacy path (USE_ATLAS=false): original vertex-color approach for fallback.
 *
 * Two shared materials are used for the whole world (one opaque, one
 * semi-transparent) — never one material per mesh.
 */

import type { Scene } from "@babylonjs/core/scene";
import type { Material } from "@babylonjs/core/Materials/material";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";

import type { MeshData } from "../meshing/types";
import { tileColor } from "./palette";
import { createTerrainMaterials as createAtlasTerrainMaterials, USE_ATLAS } from "./terrain-material";

/** Alpha used for the transparent (water/glass/leaves) render pass. */
const TRANSPARENT_ALPHA = 0.7;

/** The two shared materials used for every chunk mesh in the world. */
export interface TerrainMaterials {
  opaque: Material;
  transparent: Material;
}

/**
 * Build the single shared opaque + single shared transparent material used by
 * every chunk mesh.
 *
 * Delegates to the atlas-based implementation in terrain-material.ts when
 * `USE_ATLAS` is true (the default). Falls back to the legacy vertex-color
 * {@link StandardMaterial} path when `USE_ATLAS` is false.
 */
export function createTerrainMaterials(scene: Scene): TerrainMaterials {
  if (USE_ATLAS) {
    return createAtlasTerrainMaterials(scene);
  }

  // Legacy vertex-color fallback.
  const opaque = new StandardMaterial("terrain-opaque", scene);
  opaque.diffuseColor = new Color3(1, 1, 1);
  opaque.specularColor = new Color3(0, 0, 0);
  opaque.backFaceCulling = true;

  const transparent = new StandardMaterial("terrain-transparent", scene);
  transparent.diffuseColor = new Color3(1, 1, 1);
  transparent.specularColor = new Color3(0, 0, 0);
  transparent.alpha = TRANSPARENT_ALPHA;
  // Show both sides of thin transparent surfaces (water surface, glass, leaves).
  transparent.backFaceCulling = false;

  return { opaque, transparent };
}

/**
 * Build a per-vertex RGBA color buffer (4 floats per vertex, alpha = 1) from a
 * MeshData's tile indices, using {@link tileColor}. Used only in the legacy path.
 */
function buildVertexColors(data: MeshData): Float32Array {
  const vertexCount = data.positions.length / 3;
  const colors = new Float32Array(vertexCount * 4);
  for (let v = 0; v < vertexCount; v++) {
    const tile = data.tileIndices[v] ?? 0;
    const [r, g, b] = tileColor(tile);
    const o = v * 4;
    colors[o] = r;
    colors[o + 1] = g;
    colors[o + 2] = b;
    colors[o + 3] = 1;
  }
  return colors;
}

/**
 * Build a Babylon {@link Mesh} from one render group's {@link MeshData},
 * positioned at the section's world-space corner (originX, originY, originZ).
 *
 * Returns `null` for empty geometry (zero indices). The caller is responsible
 * for assigning a shared material via `mesh.material`.
 *
 * When USE_ATLAS is true:
 *  - Positions, normals, UVs, and indices are applied via VertexData.
 *  - A per-vertex float attribute "tileIndex" is set via setVerticesData so
 *    the AtlasMaterialPlugin can sample the correct atlas tile per fragment.
 *  - Vertex colors are NOT set (the plugin overrides baseColor directly).
 *
 * When USE_ATLAS is false:
 *  - The legacy vertex-color path is used (RGBA colors baked from palette).
 *
 * The mesh's world matrix is frozen (chunks never move) and culling is set to
 * the cheap bounding-sphere strategy.
 */
export function buildBabylonMesh(
  name: string,
  data: MeshData,
  scene: Scene,
  originX: number,
  originY: number,
  originZ: number,
): Mesh | null {
  if (data.indices.length === 0) return null;

  const mesh = new Mesh(name, scene);

  const vertexData = new VertexData();
  // Copy into plain arrays Babylon owns; the source typed arrays are reused.
  vertexData.positions = Array.from(data.positions);
  vertexData.normals = Array.from(data.normals);
  vertexData.uvs = Array.from(data.uvs);
  if (!USE_ATLAS) {
    vertexData.colors = Array.from(buildVertexColors(data));
  }
  vertexData.indices = Array.from(data.indices);
  vertexData.applyToMesh(mesh);

  if (USE_ATLAS) {
    // Set the custom per-vertex tileIndex attribute (1 float per vertex).
    // The AtlasMaterialPlugin reads this in the vertex shader and forwards
    // it to the fragment shader as a varying.
    mesh.setVerticesData("tileIndex", new Float32Array(data.tileIndices), false, 1);
    mesh.useVertexColors = false;
  } else {
    // Display the per-vertex colors we just baked.
    mesh.useVertexColors = true;
  }

  mesh.position.set(originX, originY, originZ);
  mesh.freezeWorldMatrix();
  mesh.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY;

  return mesh;
}
