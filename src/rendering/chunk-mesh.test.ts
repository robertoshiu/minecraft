import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";

import { Chunk } from "../chunk/data";
import { Blocks } from "../rules/mc-1.20";
import { meshChunk } from "../meshing/greedy";
import { emptyMeshData } from "../meshing/types";
import { buildBabylonMesh, createTerrainMaterials } from "./chunk-mesh";

let engine: NullEngine;
let scene: Scene;

beforeAll(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
});

afterAll(() => {
  scene.dispose();
  engine.dispose();
});

describe("buildBabylonMesh", () => {
  it("returns null for empty MeshData (zero indices)", () => {
    const mesh = buildBabylonMesh("empty", emptyMeshData(), scene, 0, 0, 0);
    expect(mesh).toBeNull();
  });

  it("builds a Mesh with the expected vertex count and a tileIndex buffer", () => {
    // A single solid STONE section greedily merges to 6 quads = 24 vertices.
    const chunk = new Chunk();
    chunk.fill(Blocks.STONE);
    const { opaque } = meshChunk(chunk);

    const expectedVerts = opaque.positions.length / 3;
    expect(expectedVerts).toBe(24);

    const mesh = buildBabylonMesh("stone", opaque, scene, 16, 32, -16);
    expect(mesh).not.toBeNull();
    if (mesh === null) return; // narrow for TS

    const positions = mesh.getVerticesData("position");
    expect(positions).not.toBeNull();
    expect(positions?.length).toBe(expectedVerts * 3);

    // Atlas path: the mesh exposes a per-vertex float "tileIndex" buffer
    // (1 float per vertex) instead of a vertex-color buffer.
    const tileIndices = mesh.getVerticesData("tileIndex");
    expect(tileIndices).not.toBeNull();
    // 1 float per vertex.
    expect(tileIndices?.length).toBe(expectedVerts);

    // UVs should still be present (2 floats per vertex).
    const uvs = mesh.getVerticesData("uv");
    expect(uvs).not.toBeNull();
    expect(uvs?.length).toBe(expectedVerts * 2);

    // Positioned at the supplied world-space corner.
    expect(mesh.position.x).toBe(16);
    expect(mesh.position.y).toBe(32);
    expect(mesh.position.z).toBe(-16);

    mesh.dispose();
  });
});

describe("createTerrainMaterials", () => {
  it("returns one opaque + one transparent material; transparent has alpha < 1", () => {
    const mats = createTerrainMaterials(scene);
    expect(mats.opaque).toBeDefined();
    expect(mats.transparent).toBeDefined();
    expect(mats.opaque.alpha).toBe(1);
    expect(mats.transparent.alpha).toBeLessThan(1);
  });
});
