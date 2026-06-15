/**
 * types.ts — public mesh data contract for the greedy mesher.
 *
 * The mesher converts a {@link Chunk} into renderer-ready geometry. Geometry is
 * split into two render groups: `opaque` (the depth-sorted solid pass) and
 * `transparent` (the alpha pass — water/glass/leaves/torch).
 *
 * Vertex layout (parallel arrays, all indexed by vertex):
 *  - `positions`   3 floats per vertex (x, y, z) in chunk-local block space.
 *  - `normals`     3 floats per vertex — the face's outward unit normal.
 *  - `uvs`         2 floats per vertex. A merged W×H quad spans uv (0..W, 0..H)
 *                  so the atlas shader can tile a single tile across the quad
 *                  via `fract(uv)`; the integer part is the repeat count.
 *  - `tileIndices` 1 float per vertex — the atlas tile index (0..255) from
 *                  {@link faceTile}; constant across the four verts of a quad.
 *  - `indices`     3 indices per triangle, CCW front faces (two tris per quad).
 */

import type { FaceDir } from "../chunk/data";

export type { FaceDir };

/** Renderer-ready geometry for one render group. See file header for layout. */
export interface MeshData {
  /** 3 floats per vertex (x, y, z), chunk-local. */
  positions: Float32Array;
  /** 3 floats per vertex — outward unit normal. */
  normals: Float32Array;
  /** 2 floats per vertex — spans the merged quad (0..width, 0..height). */
  uvs: Float32Array;
  /** 1 float per vertex — atlas tile index (0..255). */
  tileIndices: Float32Array;
  /**
   * 1 float per vertex — baked per-face directional brightness (Minecraft
   * canonical values): top +Y = 1.0, bottom -Y = 0.5, ±Z = 0.8, ±X = 0.6.
   * Constant across the four verts of each quad; greedy merging is unaffected.
   */
  faceShades: Float32Array;
  /** 3 indices per triangle, CCW front faces. */
  indices: Uint32Array;
}

/** The two render groups produced for a chunk. */
export interface ChunkMesh {
  opaque: MeshData;
  transparent: MeshData;
}

/**
 * Opposing-face neighbor slices for cross-chunk face culling, keyed by the
 * direction that points toward the neighbor. Each slice is the 256-length
 * border of blocks immediately OUTSIDE this chunk in that direction (indexed
 * by the chunk's border convention). A missing/`null` entry is treated as AIR.
 */
export type NeighborBorders = Partial<Record<FaceDir, Uint16Array | null>>;

/** A {@link MeshData} with zero-length arrays (no geometry). */
export function emptyMeshData(): MeshData {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    uvs: new Float32Array(0),
    tileIndices: new Float32Array(0),
    faceShades: new Float32Array(0),
    indices: new Uint32Array(0),
  };
}
