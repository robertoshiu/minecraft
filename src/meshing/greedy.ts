/**
 * greedy.ts — production greedy mesher (Mikola Lysenko style).
 *
 * Converts a {@link Chunk} into renderer-ready {@link ChunkMesh} geometry,
 * merging coplanar same-tile faces into larger quads to minimize triangle
 * count. Faces are split into the `opaque` and `transparent` render groups.
 *
 * Algorithm (per face direction):
 *  1. Sweep the slices perpendicular to the face axis.
 *  2. For each slice, build a 2D mask over the two in-plane axes: each cell
 *     holds a packed (group, tileIndex) face descriptor if the voxel emits a
 *     face in this direction, else empty.
 *  3. Greedily merge mask cells that share the same descriptor into the widest
 *     run, then extend down as far as every row matches — one quad per region.
 *
 * Visibility (voxel B, neighbor voxel N one step in the face direction; N is
 * AIR when outside the chunk and no neighbor border is supplied):
 *  - B AIR                  -> no face.
 *  - B opaque               -> emit (opaque group) iff N is NOT opaque.
 *  - B transparent non-air  -> emit (transparent group) iff N is AIR or
 *                              N has a different block id than B (same-type
 *                              transparent surfaces cull against each other).
 */

import { Chunk, type FaceDir } from "../chunk/data";
import { Blocks, type BlockId } from "../rules/mc-1.20";
import { faceTile, isOpaque, isTransparent } from "../rules/block-registry";
import { emptyMeshData, type ChunkMesh, type MeshData, type NeighborBorders } from "./types";

const SIZE = 16;

/** Render group a face belongs to. */
type Group = "opaque" | "transparent";

/**
 * Per-direction sweep geometry. `d` is the axis the face points along (0=x,
 * 1=y, 2=z). `sign` is +1 for positive faces, -1 for negative. `u`/`v` are the
 * two in-plane axes (u fastest). `normal` is the outward unit normal.
 */
interface DirSpec {
  dir: FaceDir;
  d: 0 | 1 | 2;
  sign: 1 | -1;
  u: 0 | 1 | 2;
  v: 0 | 1 | 2;
  normal: readonly [number, number, number];
  /**
   * Whether to reverse the plane-corner order so the two emitted triangles wind
   * CCW when viewed from outside (geometric normal == outward normal). The
   * correct value depends on the (u,v) handedness for each axis, so it is
   * precomputed per direction rather than derived from `sign`.
   */
  reverse: boolean;
}

const DIRS: readonly DirSpec[] = [
  { dir: "px", d: 0, sign: 1, u: 2, v: 1, normal: [1, 0, 0], reverse: true },
  { dir: "nx", d: 0, sign: -1, u: 2, v: 1, normal: [-1, 0, 0], reverse: false },
  { dir: "py", d: 1, sign: 1, u: 0, v: 2, normal: [0, 1, 0], reverse: true },
  { dir: "ny", d: 1, sign: -1, u: 0, v: 2, normal: [0, -1, 0], reverse: false },
  { dir: "pz", d: 2, sign: 1, u: 0, v: 1, normal: [0, 0, 1], reverse: false },
  { dir: "nz", d: 2, sign: -1, u: 0, v: 1, normal: [0, 0, -1], reverse: true },
];

/**
 * Map a chunk-local coordinate on a boundary plane to the neighbor border
 * sub-index, matching the chunk module's border convention:
 *  - px/nx: y + z*16
 *  - py/ny: x + z*16
 *  - pz/nz: x + y*16
 */
function borderIndex(dir: FaceDir, x: number, y: number, z: number): number {
  switch (dir) {
    case "px":
    case "nx":
      return y + z * SIZE;
    case "py":
    case "ny":
      return x + z * SIZE;
    case "pz":
    case "nz":
      return x + y * SIZE;
  }
}

/**
 * Baked per-face directional brightness following Minecraft canonical values.
 * top (+Y) = 1.0, bottom (-Y) = 0.5, north/south (±Z) = 0.8, east/west (±X) = 0.6.
 */
function faceShadeForDir(dir: FaceDir): number {
  switch (dir) {
    case "py": return 1.0;
    case "ny": return 0.5;
    case "pz":
    case "nz": return 0.8;
    case "px":
    case "nx": return 0.6;
  }
}

/** Accumulates vertices/indices for one render group, flushed to a MeshData. */
class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly tileIndices: number[] = [];
  private readonly faceShades: number[] = [];
  private readonly indices: number[] = [];
  private vertexCount = 0;

  /**
   * Append a single quad. `verts` is the four corners in CCW-from-outside order,
   * each paired with its merged-quad uv (0..width, 0..height) so the atlas
   * shader tiles via `fract()`. `normal` is the outward unit normal; `tile` the
   * atlas tile index; `shade` is the baked per-face directional brightness.
   * Triangulated (0,1,2)+(0,2,3), preserving the CCW winding.
   */
  addQuad(
    verts: readonly {
      pos: readonly [number, number, number];
      uv: readonly [number, number];
    }[],
    normal: readonly [number, number, number],
    tile: number,
    shade: number,
  ): void {
    const base = this.vertexCount;
    for (let i = 0; i < 4; i++) {
      const vert = verts[i];
      if (vert === undefined) continue;
      this.positions.push(vert.pos[0], vert.pos[1], vert.pos[2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.uvs.push(vert.uv[0], vert.uv[1]);
      this.tileIndices.push(tile);
      this.faceShades.push(shade);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.vertexCount += 4;
  }

  build(): MeshData {
    if (this.vertexCount === 0) return emptyMeshData();
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      uvs: new Float32Array(this.uvs),
      tileIndices: new Float32Array(this.tileIndices),
      faceShades: new Float32Array(this.faceShades),
      indices: new Uint32Array(this.indices),
    };
  }
}

/** Read a voxel by axis-addressed coordinate (a along d, plus u/v offsets). */
function readVoxel(chunk: Chunk, x: number, y: number, z: number): BlockId {
  return chunk.get(x, y, z);
}

/**
 * The neighbor block one step in `dir` from chunk-local (x,y,z). If the step
 * leaves the chunk, consult the neighbor border (AIR when absent/null).
 */
function neighborBlock(
  chunk: Chunk,
  neighbors: NeighborBorders | undefined,
  spec: DirSpec,
  x: number,
  y: number,
  z: number,
): BlockId {
  const nx = x + (spec.d === 0 ? spec.sign : 0);
  const ny = y + (spec.d === 1 ? spec.sign : 0);
  const nz = z + (spec.d === 2 ? spec.sign : 0);
  const inside = nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && nz >= 0 && nz < SIZE;
  if (inside) return readVoxel(chunk, nx, ny, nz);
  const border = neighbors?.[spec.dir];
  if (border === undefined || border === null) return Blocks.AIR;
  const i = borderIndex(spec.dir, x, y, z);
  return (border[i] ?? Blocks.AIR) as BlockId;
}

/**
 * Face descriptor for a mask cell. `group` selects the render group; `tile` is
 * the atlas tile index. Two cells merge only if both fields are equal.
 */
interface FaceCell {
  group: Group;
  tile: number;
}

/** True iff two mask cells are mergeable (same group + tile). */
function sameCell(a: FaceCell | null, b: FaceCell | null): boolean {
  if (a === null || b === null) return false;
  return a.group === b.group && a.tile === b.tile;
}

/**
 * Determine whether voxel B emits a face in `dir` against neighbor N, and into
 * which group. Returns `null` when no face is emitted.
 */
function faceFor(b: BlockId, n: BlockId, dir: FaceDir): FaceCell | null {
  if (b === Blocks.AIR) return null;
  if (isOpaque(b)) {
    if (isOpaque(n)) return null;
    return { group: "opaque", tile: faceTile(b, dir) };
  }
  if (isTransparent(b)) {
    // B is a non-air transparent block (air handled above).
    if (n === Blocks.AIR || n !== b) {
      return { group: "transparent", tile: faceTile(b, dir) };
    }
    return null;
  }
  return null;
}

/** Build the chunk-local position of a mask corner for the given direction. */
function cornerPosition(
  spec: DirSpec,
  slice: number,
  uCoord: number,
  vCoord: number,
): [number, number, number] {
  const p: [number, number, number] = [0, 0, 0];
  // Plane position along d: outer surface sits at slice+1 for +faces.
  p[spec.d] = spec.sign === 1 ? slice + 1 : slice;
  p[spec.u] = uCoord;
  p[spec.v] = vCoord;
  return p;
}

/**
 * Mesh a single face direction into the supplied builders, greedily merging
 * coplanar same-tile faces.
 */
function meshDirection(
  chunk: Chunk,
  neighbors: NeighborBorders | undefined,
  spec: DirSpec,
  opaque: MeshBuilder,
  transparent: MeshBuilder,
): void {
  const coord: [number, number, number] = [0, 0, 0];

  // Sweep each slice perpendicular to the face axis.
  for (let slice = 0; slice < SIZE; slice++) {
    coord[spec.d] = slice;

    // Build the visibility mask for this slice: mask[u + v*SIZE].
    const mask: (FaceCell | null)[] = new Array<FaceCell | null>(SIZE * SIZE).fill(null);
    for (let v = 0; v < SIZE; v++) {
      for (let u = 0; u < SIZE; u++) {
        coord[spec.u] = u;
        coord[spec.v] = v;
        const x = coord[0];
        const y = coord[1];
        const z = coord[2];
        const b = readVoxel(chunk, x, y, z);
        const n = neighborBlock(chunk, neighbors, spec, x, y, z);
        mask[u + v * SIZE] = faceFor(b, n, spec.dir);
      }
    }

    // Greedy merge: scan the mask, expand each face into the widest run then
    // the tallest block of identical rows, emit one quad, and clear the region.
    for (let v = 0; v < SIZE; v++) {
      for (let u = 0; u < SIZE; ) {
        const start = mask[u + v * SIZE] ?? null;
        if (start === null) {
          u++;
          continue;
        }
        // Expand width along u.
        let width = 1;
        while (u + width < SIZE && sameCell(mask[u + width + v * SIZE] ?? null, start)) {
          width++;
        }
        // Expand height along v: every cell in the next row across [u, u+width)
        // must match.
        let height = 1;
        outer: while (v + height < SIZE) {
          for (let k = 0; k < width; k++) {
            if (!sameCell(mask[u + k + (v + height) * SIZE] ?? null, start)) break outer;
          }
          height++;
        }
        // Clear the merged region so it is not re-emitted.
        for (let dv = 0; dv < height; dv++) {
          for (let du = 0; du < width; du++) {
            mask[u + du + (v + dv) * SIZE] = null;
          }
        }
        emitQuad(spec, slice, u, v, width, height, start, opaque, transparent);
        u += width;
      }
    }
  }
}

/**
 * Emit one merged quad. `u`/`v` are the region origin in the plane; `width` is
 * the extent along `u`, `height` along `v`. Winding is CCW when viewed from the
 * outside (along the outward normal).
 */
function emitQuad(
  spec: DirSpec,
  slice: number,
  u: number,
  v: number,
  width: number,
  height: number,
  cell: FaceCell,
  opaque: MeshBuilder,
  transparent: MeshBuilder,
): void {
  // The four plane corners with their merged-quad UVs. The UV (0..width,
  // 0..height) lets the atlas shader tile one tile across the quad via fract().
  const v0 = { pos: cornerPosition(spec, slice, u, v), uv: [0, 0] as const };
  const v1 = { pos: cornerPosition(spec, slice, u + width, v), uv: [width, 0] as const };
  const v2 = { pos: cornerPosition(spec, slice, u + width, v + height), uv: [width, height] as const };
  const v3 = { pos: cornerPosition(spec, slice, u, v + height), uv: [0, height] as const };

  // Orient winding so the two triangles wind CCW from outside (front face
  // points along the outward normal). `reverse` is precomputed per direction.
  // Reversal keeps each corner paired with its UV.
  const verts = spec.reverse ? [v0, v3, v2, v1] : [v0, v1, v2, v3];

  // Baked per-face directional brightness: constant across all 4 vertices of
  // this quad so greedy merging is entirely unaffected.
  const shade = faceShadeForDir(spec.dir);

  const builder = cell.group === "opaque" ? opaque : transparent;
  builder.addQuad(verts, spec.normal, cell.tile, shade);
}

/**
 * Greedy-mesh a chunk into opaque + transparent geometry.
 *
 * @param chunk     the 16³ section to mesh.
 * @param neighbors optional opposing-face border slices for cross-chunk face
 *                  culling; a missing/`null` side is treated as AIR (face
 *                  emitted).
 */
export function meshChunk(chunk: Chunk, neighbors?: NeighborBorders): ChunkMesh {
  const opaque = new MeshBuilder();
  const transparent = new MeshBuilder();
  for (const spec of DIRS) {
    meshDirection(chunk, neighbors, spec, opaque, transparent);
  }
  return { opaque: opaque.build(), transparent: transparent.build() };
}
