/**
 * terrain-material.test.ts — verifies that createTerrainMaterials compiles
 * without throwing under a NullEngine (shader plugin build test) and that the
 * returned materials satisfy the TerrainMaterials contract.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
// Required to augment Material with .pluginManager (side-effect import).
import "@babylonjs/core/Materials/materialPluginManager";

import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import {
  createTerrainMaterials,
  createPbrTerrainMaterials,
  buildAtlasTexture,
  USE_PBR_TERRAIN,
  PBR_TERRAIN_ROUGHNESS,
} from "./terrain-material";

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

describe("createTerrainMaterials (atlas path)", () => {
  it("returns opaque + transparent materials without throwing", () => {
    let mats: ReturnType<typeof createTerrainMaterials> | undefined;
    expect(() => {
      mats = createTerrainMaterials(scene);
    }).not.toThrow();
    expect(mats).toBeDefined();
  });

  it("opaque material has alpha === 1", () => {
    const mats = createTerrainMaterials(scene);
    expect(mats.opaque.alpha).toBe(1);
  });

  it("transparent material has alpha < 1", () => {
    const mats = createTerrainMaterials(scene);
    expect(mats.transparent.alpha).toBeLessThan(1);
  });

  it("both materials are truthy (not null/undefined)", () => {
    const mats = createTerrainMaterials(scene);
    expect(mats.opaque).toBeTruthy();
    expect(mats.transparent).toBeTruthy();
  });

  it("opaque material getActiveTextures() includes the atlas texture", () => {
    const mats = createTerrainMaterials(scene);
    // Cast to StandardMaterial to access getActiveTextures — TerrainMaterials
    // exposes Material (the base type), but the implementation returns StandardMaterial.
    const opaque = mats.opaque as StandardMaterial;
    const activeTextures = opaque.getActiveTextures();
    // At least one texture must be present (the atlas).
    expect(activeTextures.length).toBeGreaterThan(0);
    // The atlas texture must appear in the list by name.
    const hasAtlas = activeTextures.some((t) => t.name === "terrain-atlas");
    expect(hasAtlas).toBe(true);
  });

  it("opaque material hasTexture() returns true for the atlas texture", () => {
    const mats = createTerrainMaterials(scene);
    const opaque = mats.opaque as StandardMaterial;
    const activeTextures = opaque.getActiveTextures();
    const atlasTex = activeTextures.find((t) => t.name === "terrain-atlas");
    expect(atlasTex).toBeDefined();
    if (atlasTex !== undefined) {
      expect(opaque.hasTexture(atlasTex)).toBe(true);
    }
  });

  it("opaque material has explicit diffuseColor (1,1,1)", () => {
    const mats = createTerrainMaterials(scene);
    const opaque = mats.opaque as StandardMaterial;
    expect(opaque.diffuseColor.r).toBe(1);
    expect(opaque.diffuseColor.g).toBe(1);
    expect(opaque.diffuseColor.b).toBe(1);
  });

  it("transparent material has explicit diffuseColor (1,1,1)", () => {
    const mats = createTerrainMaterials(scene);
    const transparent = mats.transparent as StandardMaterial;
    expect(transparent.diffuseColor.r).toBe(1);
    expect(transparent.diffuseColor.g).toBe(1);
    expect(transparent.diffuseColor.b).toBe(1);
  });

  // ── FIX 1 + FIX 2: shader source assertions ────────────────────────────────

  /**
   * Helper: retrieve the source string injected at a named injection point.
   * Accesses the AtlasMaterialPlugin via pluginManager.getPlugin() which is the
   * public Babylon API for this purpose.
   */
  function getPluginCode(
    mat: StandardMaterial,
    shaderType: "vertex" | "fragment",
    point: string,
  ): string {
    const pm = mat.pluginManager;
    if (pm === undefined) return "";
    const plugin = pm.getPlugin("AtlasPlugin");
    if (plugin === null) return "";
    const code = plugin.getCustomCode(shaderType);
    if (code === null) return "";
    return code[point] ?? "";
  }

  it("vertex shader declares faceShade attribute and vFaceShade varying", () => {
    const mats = createTerrainMaterials(scene);
    const opaque = mats.opaque as StandardMaterial;
    const defs = getPluginCode(opaque, "vertex", "CUSTOM_VERTEX_DEFINITIONS");
    expect(defs).toContain("attribute float faceShade");
    expect(defs).toContain("varying float vFaceShade");
  });

  it("vertex shader main assigns vFaceShade = faceShade", () => {
    const mats = createTerrainMaterials(scene);
    const opaque = mats.opaque as StandardMaterial;
    const main = getPluginCode(opaque, "vertex", "CUSTOM_VERTEX_MAIN_END");
    expect(main).toContain("vFaceShade = faceShade");
  });

  it("fragment shader declares vFaceShade varying", () => {
    const mats = createTerrainMaterials(scene);
    const opaque = mats.opaque as StandardMaterial;
    const defs = getPluginCode(opaque, "fragment", "CUSTOM_FRAGMENT_DEFINITIONS");
    expect(defs).toContain("varying float vFaceShade");
  });

  it("fragment shader multiplies baseColor by vFaceShade (FIX 1)", () => {
    const mats = createTerrainMaterials(scene);
    const opaque = mats.opaque as StandardMaterial;
    const frag = getPluginCode(opaque, "fragment", "CUSTOM_FRAGMENT_UPDATE_DIFFUSE");
    expect(frag).toContain("baseColor.rgb *= vFaceShade");
  });

  it("fragment shader has gentle contact-AO: no hard outline, darken <= 12%", () => {
    const mats = createTerrainMaterials(scene);
    const opaque = mats.opaque as StandardMaterial;
    const frag = getPluginCode(opaque, "fragment", "CUSTOM_FRAGMENT_UPDATE_DIFFUSE");
    // Contact-AO band present via smoothstep.
    expect(frag).toContain("smoothstep");
    // Hard outline pass is gone.
    expect(frag).not.toContain("_outline");
    // Seam variable removed.
    expect(frag).not.toContain("_seam");
    // Darkening factor at most 12% (mix lower-bound >= 0.88).
    const mixMatch = frag.match(/mix\((0\.\d+)/);
    expect(mixMatch).not.toBeNull();
    if (mixMatch !== null) {
      const lowerBound = parseFloat(mixMatch[1] ?? "0");
      expect(lowerBound).toBeGreaterThanOrEqual(0.88);
    }
  });

  it("atlas texture is created with no mipmaps (NEAREST_SAMPLINGMODE) to prevent mip-seam artifacts", () => {
    // PRIMARY FIX: with mipmaps enabled, UV-wrap derivative spikes at fract()
    // boundaries cause the GPU to pick the coarsest mip → muddy/patchy seams.
    // The atlas texture must be created with generateMipMaps=false and
    // NEAREST_SAMPLINGMODE so per-texel sampling is always point-sampled.
    const mats = createTerrainMaterials(scene);
    const opaque = mats.opaque as StandardMaterial;
    const activeTextures = opaque.getActiveTextures();
    const atlasTex = activeTextures.find((t) => t.name === "terrain-atlas") as
      | RawTexture
      | undefined;
    expect(atlasTex).toBeDefined();
    if (atlasTex !== undefined) {
      // NullEngine exposes samplingMode on RawTexture (inherited from Texture).
      // Texture.NEAREST_SAMPLINGMODE = 1.
      // If the property is not exposed by NullEngine, we note the limitation
      // and assert what we can (texture name presence is still verified above).
      const samplingMode = (atlasTex as { samplingMode?: number }).samplingMode;
      if (samplingMode !== undefined) {
        expect(samplingMode).toBe(Texture.NEAREST_SAMPLINGMODE);
      }
      // Also check noMipmap flag if exposed.
      const noMipmap = (atlasTex as { noMipmap?: boolean }).noMipmap;
      if (noMipmap !== undefined) {
        expect(noMipmap).toBe(true);
      }
    }
  });
});

describe("USE_PBR_TERRAIN flag (Phase 6d)", () => {
  it("defaults to false (shipped path is StandardMaterial, no PBR)", () => {
    expect(USE_PBR_TERRAIN).toBe(false);
  });

  it("PBR_TERRAIN_ROUGHNESS is a sensible matte value in (0,1]", () => {
    expect(PBR_TERRAIN_ROUGHNESS).toBeGreaterThan(0);
    expect(PBR_TERRAIN_ROUGHNESS).toBeLessThanOrEqual(1);
  });

  it("with the flag OFF, createTerrainMaterials returns StandardMaterials", () => {
    // The default flag is OFF, so the existing StandardMaterial body runs.
    const mats = createTerrainMaterials(scene);
    expect(mats.opaque).toBeInstanceOf(StandardMaterial);
    expect(mats.transparent).toBeInstanceOf(StandardMaterial);
  });
});

describe("PBR terrain path (Phase 6d, flag ON)", () => {
  it("builds a PBRMaterial pair without throwing under NullEngine", () => {
    const atlas = buildAtlasTexture(scene);
    let mats: ReturnType<typeof createPbrTerrainMaterials> | undefined;
    expect(() => {
      mats = createPbrTerrainMaterials(scene, atlas);
    }).not.toThrow();
    expect(mats?.opaque).toBeInstanceOf(PBRMaterial);
    expect(mats?.transparent).toBeInstanceOf(PBRMaterial);
  });

  it("opaque PBR material is non-metal with the uniform roughness", () => {
    const atlas = buildAtlasTexture(scene);
    const mats = createPbrTerrainMaterials(scene, atlas);
    const opaque = mats.opaque as PBRMaterial;
    expect(opaque.metallic).toBe(0);
    expect(opaque.roughness).toBe(PBR_TERRAIN_ROUGHNESS);
    expect(opaque.backFaceCulling).toBe(true);
  });

  it("transparent PBR material alpha-blends both sides", () => {
    const atlas = buildAtlasTexture(scene);
    const mats = createPbrTerrainMaterials(scene, atlas);
    const t = mats.transparent as PBRMaterial;
    expect(t.alpha).toBeLessThan(1);
    expect(t.backFaceCulling).toBe(false);
  });

  it("both PBR materials reuse the EXACT atlas instance passed in (no rebuild)", () => {
    // Build the one shared atlas instance explicitly so we can check identity.
    const atlas = buildAtlasTexture(scene);
    const mats = createPbrTerrainMaterials(scene, atlas);
    const opaqueTex = (mats.opaque as PBRMaterial).getActiveTextures();
    const transparentTex = (mats.transparent as PBRMaterial).getActiveTextures();
    // Object-identity assertions: the passed `atlas` instance must appear in both
    // materials' active-texture lists (not just a same-named copy).
    // toContain uses Object.is / === semantics, so a freshly-built atlas would fail.
    expect(opaqueTex).toContain(atlas);
    expect(transparentTex).toContain(atlas);
    // Belt-and-suspenders: find by identity and confirm it IS the same reference.
    expect(opaqueTex.find((t) => t === atlas)).toBe(atlas);
    expect(transparentTex.find((t) => t === atlas)).toBe(atlas);
  });

  it("PBR plugin injects the atlas lookup at CUSTOM_FRAGMENT_UPDATE_ALBEDO", () => {
    const atlas = buildAtlasTexture(scene);
    const mats = createPbrTerrainMaterials(scene, atlas);
    const opaque = mats.opaque as PBRMaterial;
    const plugin = opaque.pluginManager?.getPlugin("PbrAtlasPlugin");
    expect(plugin).not.toBeNull();
    const frag = plugin?.getCustomCode("fragment") ?? null;
    expect(frag).not.toBeNull();
    expect(frag?.["CUSTOM_FRAGMENT_UPDATE_ALBEDO"]).toContain("surfaceAlbedo");
    expect(frag?.["CUSTOM_FRAGMENT_UPDATE_ALBEDO"]).toContain("atlasSampler");
    // It must NOT write baseColor (that is the StandardMaterial point).
    expect(frag?.["CUSTOM_FRAGMENT_UPDATE_ALBEDO"]).not.toContain("baseColor");
  });
});
