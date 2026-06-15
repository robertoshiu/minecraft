/**
 * terrain-material.ts — atlas-based terrain material for the voxel world.
 *
 * Creates a pair of Babylon {@link StandardMaterial}s (opaque + transparent)
 * augmented with a {@link MaterialPluginBase} that:
 *
 *  1. Accepts a per-vertex float attribute "tileIndex" (0..255).
 *  2. Passes it to the fragment shader as a varying `vTileIndex`.
 *  3. In the fragment shader, computes the atlas UV from the mesh UV (which
 *     spans 0..W / 0..H for a greedy-merged W×H quad), takes `fract()` to
 *     tile within the quad, maps to the correct 64×64 cell in the 1024×1024
 *     atlas, samples the atlas texture, and writes the result into `baseColor`
 *     at the `CUSTOM_FRAGMENT_UPDATE_DIFFUSE` injection point — so Babylon's
 *     standard directional + hemispheric lighting applies on top.
 *
 * A one-line constant `USE_ATLAS = true` controls the code path. If `false`,
 * `createTerrainMaterials` returns the legacy vertex-color materials so the
 * old path remains trivially re-activatable.
 *
 * Babylon lighting (DirectionalLight + HemisphericLight) is preserved intact
 * because we extend {@link StandardMaterial} rather than replacing it.
 */

import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Material } from "@babylonjs/core/Materials/material";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";

import { generateAtlasRGBA, ATLAS_PX } from "./atlas";

/** Flip to `false` to fall back to the old vertex-color path. */
export const USE_ATLAS = true;

/** Alpha used for the transparent (water/glass/leaves) render pass. */
const TRANSPARENT_ALPHA = 0.7;

// ---------------------------------------------------------------------------
// MaterialPluginBase sub-class
// ---------------------------------------------------------------------------

/**
 * A {@link MaterialPluginBase} that plugs a procedural texture-atlas lookup
 * into a {@link StandardMaterial}'s GLSL at the `CUSTOM_FRAGMENT_UPDATE_DIFFUSE`
 * injection point. This keeps Babylon's full lighting pipeline intact.
 */
class AtlasMaterialPlugin extends MaterialPluginBase {
  /** The atlas texture bound in `bindForSubMesh`. Set before the first draw. */
  private _atlasTex: RawTexture;

  constructor(material: Material, atlasTex: RawTexture) {
    // Priority 200: runs after default UV/color code but well before post-processing.
    super(material, "AtlasPlugin", 200, {}, true, true);
    this._atlasTex = atlasTex;
  }

  override getClassName(): string {
    return "AtlasMaterialPlugin";
  }

  /** Register the custom "tileIndex" and "faceShade" vertex attributes. */
  override getAttributes(attributes: string[], _scene: Scene, _mesh: AbstractMesh): void {
    attributes.push("tileIndex");
    attributes.push("faceShade");
  }

  /** Register the atlas sampler so Babylon includes it in the effect. */
  override getSamplers(samplers: string[]): void {
    samplers.push("atlasSampler");
  }

  /** Bind the atlas texture every time a sub-mesh is drawn. */
  override bindForSubMesh(
    _uniformBuffer: UniformBuffer,
    _scene: Scene,
    _engine: AbstractEngine,
    subMesh: SubMesh,
  ): void {
    const effect = subMesh.effect;
    if (effect === null) return;
    effect.setTexture("atlasSampler", this._atlasTex);
  }

  override isReadyForSubMesh(
    _defines: MaterialDefines,
    _scene: Scene,
    _engine: AbstractEngine,
    _subMesh: SubMesh,
  ): boolean {
    return true;
  }

  /**
   * Tell Babylon's material readiness system about the atlas texture so
   * `material.getActiveTextures()` returns it and `textureCount` is > 0.
   * Without this override, Babylon sees textureCount=0 and may keep the
   * material in a "not ready" state.
   */
  override getActiveTextures(activeTextures: BaseTexture[]): void {
    activeTextures.push(this._atlasTex);
  }

  /**
   * Tell Babylon's texture-dependency tracker that the atlas is used by this
   * plugin. Required for `material.hasTexture(tex)` to return true.
   */
  override hasTexture(texture: BaseTexture): boolean {
    return texture === this._atlasTex;
  }

  /**
   * Force Babylon to include UV1 attribute in the compiled vertex shader even
   * though no native diffuseTexture is assigned to the StandardMaterial.
   * Without this, `defines._needUVs` stays `false`, `UV1` is excluded from
   * the shader, and `uvUpdated` is always `vec2(0, 0)` — causing every
   * fragment to sample the same atlas corner texel (flat colours, no texture).
   */
  override prepareDefinesBeforeAttributes(
    defines: MaterialDefines,
    _scene: Scene,
    _mesh: AbstractMesh,
  ): void {
    defines._needUVs = true;
  }

  /**
   * Inject GLSL into both the vertex and fragment shaders. The vertex shader
   * receives the per-vertex `tileIndex` attribute and forwards it to the
   * fragment as `vTileIndex`. The fragment shader reads the mesh UV (which
   * spans 0..W × 0..H for a greedy-merged W×H quad), takes `fract()` to tile
   * within the block, maps to the correct 64×64 cell in the 1024×1024 atlas,
   * samples the atlas, and writes the result into `baseColor.rgb` — the
   * StandardMaterial then multiplies this by the lighting result.
   *
   * Injection points (see default.vertex.js / default.fragment.js):
   *  - CUSTOM_VERTEX_DEFINITIONS  — global declarations before main()
   *  - CUSTOM_VERTEX_MAIN_END     — end of main(), after uvUpdated is set
   *  - CUSTOM_FRAGMENT_DEFINITIONS — global declarations before main()
   *  - CUSTOM_FRAGMENT_UPDATE_DIFFUSE — inside main(), after baseColor is set
   */
  override getCustomCode(
    shaderType: string,
  ): { [pointName: string]: string } | null {
    if (shaderType === "vertex") {
      return {
        // Declare attributes + varyings before main().
        CUSTOM_VERTEX_DEFINITIONS: `
attribute float tileIndex;
varying float vTileIndex;
varying vec2 vAtlasUV;
attribute float faceShade;
varying float vFaceShade;
`,
        // At the end of main(), write the varyings.
        // `uv` is the raw attribute (vec2); the default shader exposes it as
        // `uvUpdated` inside main() after morph targets have been applied.
        CUSTOM_VERTEX_MAIN_END: `
vTileIndex = tileIndex;
vAtlasUV = uvUpdated;
vFaceShade = faceShade;
`,
      };
    }

    if (shaderType === "fragment") {
      return {
        // Declare varyings + sampler before main().
        CUSTOM_FRAGMENT_DEFINITIONS: `
varying float vTileIndex;
varying vec2 vAtlasUV;
uniform sampler2D atlasSampler;
varying float vFaceShade;
`,
        // After baseColor has been written (either from diffuseSampler or as
        // the default white vec4), override it with the atlas sample.
        // The greedy mesher emits uvs that span (0..width, 0..height), so
        // fract() gives the per-block tile coordinate in [0,1).
        // We clamp to [0.02, 0.98] to avoid bleeding at tile edges.
        //
        // Atlas layout: 16 columns × 16 rows of 64px tiles in a 1024px atlas.
        // atlas UV = (vec2(tileCol, tileRow) + tileUV) / 16.0
        //
        // CHEAP HARDENING: snap tile index to nearest integer before col/row
        // math to guard against sub-integer vTileIndex interpolation artifacts
        // (WebGL1-safe; does not add a flat qualifier).
        //
        // FIX 1: multiply by vFaceShade for per-face directional brightness.
        //   top=1.0, bottom=0.5, ±Z=0.8, ±X=0.6 (Minecraft canonical).
        //
        // FIX 2: per-block edge grooves using fract(vAtlasUV) (block-space
        //   coords). smoothstep at border → ~20% darkening at each cube edge.
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
{
  float _tileIdx = floor(vTileIndex + 0.5);
  float _col = mod(_tileIdx, 16.0);
  float _row = floor(_tileIdx / 16.0);
  vec2 _tileUV = clamp(fract(vAtlasUV), 0.02, 0.98);
  vec2 _atlasUV = (vec2(_col, _row) + _tileUV) / 16.0;
  vec4 _atlasSample = texture2D(atlasSampler, _atlasUV);
  baseColor.rgb = _atlasSample.rgb;
  // FIX 1: baked per-face directional brightness (top bright, bottom dark).
  baseColor.rgb *= vFaceShade;
  // FIX 2: per-block edge groove using the per-block UV from fract(vAtlasUV).
  // _g is in [0,1) per block; _edge is distance to nearest block border;
  // smoothstep produces 0 at border, 1 in interior.
  vec2 _g = fract(vAtlasUV);
  float _edge = min(min(_g.x, 1.0 - _g.x), min(_g.y, 1.0 - _g.y));
  float _seam = smoothstep(0.0, 0.06, _edge);
  baseColor.rgb *= mix(0.80, 1.0, _seam);
  // --- Cube definition: soft edge AO band + crisp per-block outline ---
  // _bd = distance (in block-UV units) to the nearest block border, 0 at edge.
  float _bd = _edge;
  // Soft AO: darken up to ~22% within a wide band near every block edge → depth.
  float _ao = smoothstep(0.0, 0.32, _bd);
  baseColor.rgb *= mix(0.78, 1.0, _ao);
  // Crisp thin outline: a hard dark line right at the block border → visible grid.
  float _outline = 1.0 - smoothstep(0.0, 0.03, _bd);
  baseColor.rgb = mix(baseColor.rgb, baseColor.rgb * 0.5, _outline);
}
`,
      };
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The two shared materials used for every chunk mesh in the world. */
export interface TerrainMaterials {
  opaque: Material;
  transparent: Material;
}

/**
 * Create the single shared opaque + transparent material pair used by all
 * chunk meshes.
 *
 * When `USE_ATLAS` is `true` (the default), both materials are
 * {@link StandardMaterial}s augmented with {@link AtlasMaterialPlugin} so the
 * atlas texture is sampled per-fragment while Babylon's full directional +
 * hemispheric lighting pipeline is preserved.
 *
 * When `USE_ATLAS` is `false`, falls back to the legacy vertex-color path
 * (plain StandardMaterial with `useVertexColors`, no texture).
 */
export function createTerrainMaterials(scene: Scene): TerrainMaterials {
  if (!USE_ATLAS) {
    // Legacy vertex-color fallback.
    const opaque = new StandardMaterial("terrain-opaque", scene);
    opaque.diffuseColor = new Color3(1, 1, 1);
    opaque.specularColor = new Color3(0, 0, 0);
    opaque.backFaceCulling = true;

    const transparent = new StandardMaterial("terrain-transparent", scene);
    transparent.diffuseColor = new Color3(1, 1, 1);
    transparent.specularColor = new Color3(0, 0, 0);
    transparent.alpha = TRANSPARENT_ALPHA;
    transparent.backFaceCulling = false;

    return { opaque, transparent };
  }

  // Build the atlas texture once, shared by both materials.
  // PRIMARY FIX: generateMipMaps=false + NEAREST_SAMPLINGMODE
  //
  // With generateMipMaps=true + NEAREST_NEAREST_MIPLINEAR, the GPU spikes
  // the derivative at every per-block UV wrap boundary (fract() causes a
  // discontinuity) and selects the coarsest mip, averaging neighbouring atlas
  // cells (including any debug-colored regions) → muddy / patchy seams.
  //
  // Disabling mipmaps entirely (NEAREST_SAMPLINGMODE) keeps the crisp voxel
  // look and removes the mip-averaging artifact. The atlas is 1024px with 64px
  // tiles, so there is no aliasing concern at typical play distances.
  const atlasData = generateAtlasRGBA();
  const atlasTex = new RawTexture(
    atlasData,
    ATLAS_PX,
    ATLAS_PX,
    // TEXTUREFORMAT_RGBA = 5
    5,
    scene,
    /* generateMipMaps */ false,
    /* invertY */ false,
    // Texture.NEAREST_SAMPLINGMODE = 1 — point/nearest with no mip stage.
    Texture.NEAREST_SAMPLINGMODE,
  );
  atlasTex.name = "terrain-atlas";

  // Opaque material: full backface culling.
  // diffuseColor(1,1,1) ensures the constructor default is explicit — the
  // StandardMaterial constructor leaves diffuseColor at white but relying on
  // that implicit default is a latent footgun if the constructor ever changes.
  // ambientColor(1,1,1) opts this material into scene.ambientColor so the
  // global ambient floor (set in main.ts) provides a legible brightness minimum
  // on all faces without touching the atlas/plugin shader logic.
  const opaque = new StandardMaterial("terrain-opaque", scene);
  opaque.diffuseColor = new Color3(1, 1, 1);
  opaque.specularColor = new Color3(0, 0, 0);
  opaque.ambientColor = new Color3(1, 1, 1);
  opaque.backFaceCulling = true;
  new AtlasMaterialPlugin(opaque, atlasTex);

  // Transparent material: alpha pass, both faces rendered (water, glass, leaves).
  const transparent = new StandardMaterial("terrain-transparent", scene);
  transparent.diffuseColor = new Color3(1, 1, 1);
  transparent.specularColor = new Color3(0, 0, 0);
  transparent.ambientColor = new Color3(1, 1, 1);
  transparent.alpha = TRANSPARENT_ALPHA;
  transparent.backFaceCulling = false;
  new AtlasMaterialPlugin(transparent, atlasTex);

  return { opaque, transparent };
}
