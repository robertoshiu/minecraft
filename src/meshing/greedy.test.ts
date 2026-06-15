import { describe, it, expect } from "vitest";
import { Chunk, type FaceDir } from "../chunk/data";
import { Blocks } from "../rules/mc-1.20";
import { faceTile } from "../rules/block-registry";
import { meshChunk } from "./greedy";
import type { NeighborBorders } from "./types";

/** Count vertices in a MeshData (positions has 3 floats per vertex). */
function vertCount(positions: Float32Array): number {
  return positions.length / 3;
}

/** Build a 256-length border slice filled with a single block id. */
function uniformBorder(id: number): Uint16Array {
  return new Uint16Array(256).fill(id);
}

/** All six neighbor borders filled with the same block id. */
function allBorders(id: number): NeighborBorders {
  const b = uniformBorder(id);
  const dirs: FaceDir[] = ["px", "nx", "py", "ny", "pz", "nz"];
  const out: NeighborBorders = {};
  for (const d of dirs) out[d] = new Uint16Array(b);
  return out;
}

describe("meshChunk — greedy mesher", () => {
  it("empty chunk (all AIR) produces no geometry in either group", () => {
    const c = new Chunk();
    const mesh = meshChunk(c);
    expect(mesh.opaque.positions.length).toBe(0);
    expect(mesh.opaque.indices.length).toBe(0);
    expect(mesh.transparent.positions.length).toBe(0);
    expect(mesh.transparent.indices.length).toBe(0);
  });

  it("fully solid STONE chunk with NO neighbors greedily merges to exactly 6 quads", () => {
    const c = new Chunk();
    c.fill(Blocks.STONE);
    const mesh = meshChunk(c);
    // 6 outer faces, each one merged quad: 6 * 4 verts, 6 * 2 tris.
    expect(mesh.opaque.positions.length).toBe(6 * 4 * 3); // 72
    expect(mesh.opaque.normals.length).toBe(6 * 4 * 3); // 72
    expect(mesh.opaque.uvs.length).toBe(6 * 4 * 2); // 48
    expect(mesh.opaque.tileIndices.length).toBe(6 * 4); // 24
    expect(mesh.opaque.indices.length).toBe(6 * 2 * 3); // 36
    expect(mesh.transparent.positions.length).toBe(0);
    expect(mesh.transparent.indices.length).toBe(0);
  });

  it("merged outer quad spans the full 16x16 face in UV (tiling)", () => {
    const c = new Chunk();
    c.fill(Blocks.STONE);
    const mesh = meshChunk(c);
    // Every UV component is 0 or 16 (corners of a 16x16 merged quad).
    for (let i = 0; i < mesh.opaque.uvs.length; i++) {
      const u = mesh.opaque.uvs[i] ?? -1;
      expect(u === 0 || u === 16).toBe(true);
    }
  });

  it("solid STONE chunk surrounded by opaque STONE neighbors culls every face", () => {
    const c = new Chunk();
    c.fill(Blocks.STONE);
    const mesh = meshChunk(c, allBorders(Blocks.STONE));
    expect(mesh.opaque.positions.length).toBe(0);
    expect(mesh.opaque.indices.length).toBe(0);
    expect(mesh.transparent.positions.length).toBe(0);
  });

  it("single STONE block in empty chunk emits exactly 6 faces", () => {
    const c = new Chunk();
    c.set(8, 8, 8, Blocks.STONE);
    const mesh = meshChunk(c);
    expect(vertCount(mesh.opaque.positions)).toBe(6 * 4); // 24
    expect(mesh.opaque.indices.length).toBe(6 * 2 * 3); // 36
  });

  it("a full-height GLASS column lands in the transparent group, opaque empty", () => {
    const c = new Chunk();
    for (let y = 0; y < 16; y++) c.set(4, y, 4, Blocks.GLASS);
    const mesh = meshChunk(c);
    expect(mesh.opaque.positions.length).toBe(0);
    expect(mesh.transparent.positions.length).toBeGreaterThan(0);
    expect(mesh.transparent.indices.length).toBeGreaterThan(0);
  });

  it("two adjacent GLASS blocks cull their shared internal face (same-type cull)", () => {
    // Reference: two GLASS blocks placed apart so nothing is culled or merged.
    const apart = new Chunk();
    apart.set(2, 8, 8, Blocks.GLASS);
    apart.set(12, 8, 8, Blocks.GLASS);
    const apartMesh = meshChunk(apart);
    const apartQuads = apartMesh.transparent.indices.length / 6; // 2 tris per quad
    expect(apartQuads).toBe(12); // 6 faces each, none merged

    // Adjacent pair: the shared +x/-x interface is culled (same-type cull) and
    // the four perpendicular face pairs each greedily merge into one quad.
    const pair = new Chunk();
    pair.set(8, 8, 8, Blocks.GLASS);
    pair.set(9, 8, 8, Blocks.GLASS);
    const pairMesh = meshChunk(pair);
    const pairQuads = pairMesh.transparent.indices.length / 6;

    // Strictly fewer than the unculled, unmerged reference.
    expect(pairQuads).toBeLessThan(apartQuads);
    // 2 end-cap quads (+x, -x) + 4 merged spanning quads (top/bottom/front/back).
    expect(pairQuads).toBe(6);
    expect(pairMesh.opaque.positions.length).toBe(0);
  });

  it("per-face tile index matches faceTile() and differs top vs bottom for GRASS", () => {
    const c = new Chunk();
    c.set(8, 8, 8, Blocks.GRASS);
    const mesh = meshChunk(c);

    const pyTile = faceTile(Blocks.GRASS, "py");
    const nyTile = faceTile(Blocks.GRASS, "ny");
    expect(pyTile).not.toBe(nyTile);

    // Find a vertex whose normal is +Y and check its tile index.
    const n = mesh.opaque.normals;
    const t = mesh.opaque.tileIndices;
    let pyTileSeen: number | undefined;
    let nyTileSeen: number | undefined;
    for (let v = 0; v < vertCount(mesh.opaque.positions); v++) {
      const ny = n[v * 3 + 1] ?? 0;
      if (ny > 0.5) pyTileSeen = t[v];
      if (ny < -0.5) nyTileSeen = t[v];
    }
    expect(pyTileSeen).toBe(pyTile);
    expect(nyTileSeen).toBe(nyTile);
  });

  it("+Y face normal points up (0,1,0)", () => {
    const c = new Chunk();
    c.set(8, 8, 8, Blocks.STONE);
    const mesh = meshChunk(c);
    const n = mesh.opaque.normals;
    let found = false;
    for (let v = 0; v < vertCount(mesh.opaque.positions); v++) {
      const nx = n[v * 3 + 0] ?? 0;
      const ny = n[v * 3 + 1] ?? 0;
      const nz = n[v * 3 + 2] ?? 0;
      if (ny > 0.5) {
        found = true;
        expect(Math.abs(nx)).toBeLessThan(1e-6);
        expect(Math.abs(ny - 1)).toBeLessThan(1e-6);
        expect(Math.abs(nz)).toBeLessThan(1e-6);
      }
    }
    expect(found).toBe(true);
  });

  it("triangles are wound CCW so the +Y face points outward", () => {
    const c = new Chunk();
    c.set(8, 8, 8, Blocks.STONE);
    const mesh = meshChunk(c);
    const p = mesh.opaque.positions;
    const idx = mesh.opaque.indices;
    let checked = false;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] ?? 0;
      const b = idx[t + 1] ?? 0;
      const cc = idx[t + 2] ?? 0;
      const ax = p[a * 3] ?? 0, ay = p[a * 3 + 1] ?? 0, az = p[a * 3 + 2] ?? 0;
      const bx = p[b * 3] ?? 0, by = p[b * 3 + 1] ?? 0, bz = p[b * 3 + 2] ?? 0;
      const cx = p[cc * 3] ?? 0, cy = p[cc * 3 + 1] ?? 0, cz = p[cc * 3 + 2] ?? 0;
      // Triangle on the top plane (all y == 9).
      if (ay === 9 && by === 9 && cy === 9) {
        // Cross product of edges; geometric normal should point +Y for CCW.
        const e1 = [bx - ax, by - ay, bz - az] as const;
        const e2 = [cx - ax, cy - ay, cz - az] as const;
        const ny = e1[2] * e2[0] - e1[0] * e2[2]; // y-component of cross(e1,e2)
        expect(ny).toBeGreaterThan(0);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });

  it("meshes a solid 16^3 chunk in under 50ms", () => {
    const c = new Chunk();
    c.fill(Blocks.STONE);
    // Warm up.
    meshChunk(c);
    const start = performance.now();
    meshChunk(c);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  // ── FIX 1: per-face baked shading ──────────────────────────────────────────

  it("faceShades length equals positions.length / 3 (one shade per vertex)", () => {
    const c = new Chunk();
    c.set(8, 8, 8, Blocks.STONE);
    const mesh = meshChunk(c);
    const vertexCount = mesh.opaque.positions.length / 3;
    expect(mesh.opaque.faceShades.length).toBe(vertexCount);
  });

  it("top face (+Y normal) carries faceShade = 1.0", () => {
    const c = new Chunk();
    c.set(8, 8, 8, Blocks.STONE);
    const mesh = meshChunk(c);
    const n = mesh.opaque.normals;
    const s = mesh.opaque.faceShades;
    for (let v = 0; v < mesh.opaque.positions.length / 3; v++) {
      const ny = n[v * 3 + 1] ?? 0;
      if (ny > 0.5) {
        expect(s[v]).toBeCloseTo(1.0, 5);
      }
    }
  });

  it("bottom face (-Y normal) carries faceShade = 0.5", () => {
    const c = new Chunk();
    c.set(8, 8, 8, Blocks.STONE);
    const mesh = meshChunk(c);
    const n = mesh.opaque.normals;
    const s = mesh.opaque.faceShades;
    for (let v = 0; v < mesh.opaque.positions.length / 3; v++) {
      const ny = n[v * 3 + 1] ?? 0;
      if (ny < -0.5) {
        expect(s[v]).toBeCloseTo(0.5, 5);
      }
    }
  });

  it("east/west face (±X normal) carries faceShade = 0.6", () => {
    const c = new Chunk();
    c.set(8, 8, 8, Blocks.STONE);
    const mesh = meshChunk(c);
    const n = mesh.opaque.normals;
    const s = mesh.opaque.faceShades;
    for (let v = 0; v < mesh.opaque.positions.length / 3; v++) {
      const nx = n[v * 3 + 0] ?? 0;
      if (Math.abs(nx) > 0.5) {
        expect(s[v]).toBeCloseTo(0.6, 5);
      }
    }
  });

  it("north/south face (±Z normal) carries faceShade = 0.8", () => {
    const c = new Chunk();
    c.set(8, 8, 8, Blocks.STONE);
    const mesh = meshChunk(c);
    const n = mesh.opaque.normals;
    const s = mesh.opaque.faceShades;
    for (let v = 0; v < mesh.opaque.positions.length / 3; v++) {
      const nz = n[v * 3 + 2] ?? 0;
      if (Math.abs(nz) > 0.5) {
        expect(s[v]).toBeCloseTo(0.8, 5);
      }
    }
  });

  it("all four vertices of a single merged top face carry the same faceShade", () => {
    const c = new Chunk();
    c.fill(Blocks.STONE);
    const mesh = meshChunk(c);
    // The fully-solid chunk produces 6 one-quad faces; each quad has 4 verts.
    // All 4 verts of the +Y face must carry shade 1.0.
    const n = mesh.opaque.normals;
    const s = mesh.opaque.faceShades;
    const topShades: number[] = [];
    for (let v = 0; v < mesh.opaque.positions.length / 3; v++) {
      const ny = n[v * 3 + 1] ?? 0;
      if (ny > 0.5) topShades.push(s[v] ?? -1);
    }
    expect(topShades.length).toBe(4);
    for (const shade of topShades) expect(shade).toBeCloseTo(1.0, 5);
  });

  it("empty chunk faceShades array has length 0", () => {
    const c = new Chunk();
    const mesh = meshChunk(c);
    expect(mesh.opaque.faceShades.length).toBe(0);
    expect(mesh.transparent.faceShades.length).toBe(0);
  });
});
