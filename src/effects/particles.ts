/**
 * particles.ts — voxel particle effects subsystem.
 *
 * Architecture:
 *   - Pure config + color-mapping (PARTICLE_CONFIGS, blockDebrisColor) are
 *     Babylon-free and fully testable in Node/Vitest.
 *   - ParticleManager wraps Babylon ParticleSystem. Tests exercise it under
 *     NullEngine (construction only; no visual simulation).
 *   - Active-particle cap: new bursts are skipped when estimated active
 *     particles exceed MAX_ACTIVE_PARTICLES. Systems that have finished
 *     are disposed immediately (disposeOnStop=true).
 *
 * No image assets are loaded — the shared dot texture is fully procedural
 * (see particle-textures.ts).
 */

import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";

import { tileColor } from "../rendering/palette";
import { BLOCK_REGISTRY } from "../rules/block-registry";
import { createParticleTexture } from "./particle-textures";

// ---------------------------------------------------------------------------
// Pure config — Babylon-free, testable in Node
// ---------------------------------------------------------------------------

/** Configuration parameters for a particle burst event. */
export interface ParticleConfig {
  /** Number of particles to emit per burst. */
  count: number;
  /** Minimum particle lifetime in milliseconds. */
  minLifeMs: number;
  /** Maximum particle lifetime in milliseconds. */
  maxLifeMs: number;
  /** Minimum rendered size (world units). */
  minSize: number;
  /** Maximum rendered size (world units). */
  maxSize: number;
  /** Downward gravity acceleration (world units / s²). Positive = pulls down. */
  gravity: number;
  /** Base emit speed (world units/s) applied to the direction vector. */
  speed: number;
}

/**
 * Per-event particle configurations.
 * Values are tuned to feel like Minecraft debris/effects at 20 TPS.
 */
export const PARTICLE_CONFIGS: Record<
  "break" | "place" | "footstep" | "explosion" | "mobHurt" | "mobDeath" | "mobSpawn",
  ParticleConfig
> = {
  /** Block break: bright colour debris that arc up then fall. */
  break: {
    count: 16,
    minLifeMs: 400,
    maxLifeMs: 700,
    minSize: 0.07,
    maxSize: 0.18,
    gravity: 9.8,
    speed: 3.5,
  },
  /** Block place: small puff of dust at the placement point. */
  place: {
    count: 6,
    minLifeMs: 200,
    maxLifeMs: 350,
    minSize: 0.05,
    maxSize: 0.12,
    gravity: 4.0,
    speed: 1.5,
  },
  /** Footstep: subtle ground-dust kick. */
  footstep: {
    count: 3,
    minLifeMs: 150,
    maxLifeMs: 300,
    minSize: 0.04,
    maxSize: 0.10,
    gravity: 3.0,
    speed: 0.8,
  },
  /** Creeper explosion: large billowing smoke cloud. */
  explosion: {
    count: 50,
    minLifeMs: 700,
    maxLifeMs: 1400,
    minSize: 0.3,
    maxSize: 0.9,
    gravity: -1.0, // slight upward drift
    speed: 5.0,
  },
  /** Mob hurt: small blood/pain sparks. */
  mobHurt: {
    count: 8,
    minLifeMs: 200,
    maxLifeMs: 500,
    minSize: 0.06,
    maxSize: 0.14,
    gravity: 6.0,
    speed: 2.5,
  },
  /** Mob death: larger burst of particles. */
  mobDeath: {
    count: 14,
    minLifeMs: 400,
    maxLifeMs: 800,
    minSize: 0.08,
    maxSize: 0.2,
    gravity: 7.0,
    speed: 3.0,
  },
  /**
   * Mob spawn: small golden dust puff that signals a mob appearing.
   * Color matches DESIGN.md --accent (#d4a843) golden tone.
   * Slight upward motion (negative gravity = upward drift) so the dust
   * rises briefly before dispersing — visually reads as "materialise".
   */
  mobSpawn: {
    count: 6,
    minLifeMs: 300,
    maxLifeMs: 400,
    minSize: 0.05,
    maxSize: 0.12,
    gravity: -1.5, // slight upward drift
    speed: 1.2,
  },
};

// ---------------------------------------------------------------------------
// Pure color mapping — Babylon-free, testable in Node
// ---------------------------------------------------------------------------

/**
 * Return the representative RGB colour for a block, used to tint debris
 * particles. Samples the block's top face tile (the most visible surface).
 * Falls back to a light-grey if the block has no registry entry.
 *
 * @param blockId  Numeric block ID (value from {@link Blocks}).
 * @returns        `[r, g, b]` each in `[0, 1]`.
 */
export function blockDebrisColor(blockId: number): [number, number, number] {
  const def = BLOCK_REGISTRY[blockId];
  if (def === undefined) return [0.7, 0.7, 0.7];
  const tileIndex = def.faceTiles["py"]; // top face
  return tileColor(tileIndex);
}

// ---------------------------------------------------------------------------
// ParticleManager — Babylon-aware
// ---------------------------------------------------------------------------

/** Maximum total estimated active particles before new bursts are skipped. */
const MAX_ACTIVE_PARTICLES = 250;

/**
 * Manages particle-effect bursts for game events.
 *
 * One shared procedural texture is created at construction and reused across
 * all burst systems to minimise GPU allocations. Each burst creates a short-
 * lived {@link ParticleSystem} with `disposeOnStop=true`; systems clean
 * themselves up automatically. An active-particle cap prevents perf spikes
 * from rapid repeated events.
 */
export class ParticleManager {
  private readonly scene: Scene;
  private readonly sharedTexture: Texture;

  /** Running estimate of particles across all live systems. */
  private _estimatedActive = 0;

  /** Live system set — only for counting and cap enforcement. */
  private readonly _liveSystems = new Set<ParticleSystem>();

  constructor(scene: Scene) {
    this.scene = scene;
    this.sharedTexture = createParticleTexture(scene);
  }

  // --- Public event methods ------------------------------------------------

  /** Debris burst when a block is broken. */
  blockBreak(pos: { x: number; y: number; z: number }, color: [number, number, number]): void {
    this._burst("break", pos, color);
  }

  /** Small puff when a block is placed. */
  blockPlace(pos: { x: number; y: number; z: number }): void {
    this._burst("place", pos, [0.8, 0.8, 0.75]);
  }

  /** Dust kick when the player takes a footstep. */
  footstep(pos: { x: number; y: number; z: number }, color: [number, number, number]): void {
    this._burst("footstep", pos, color);
  }

  /** Smoke/debris cloud from an explosion. */
  explosion(pos: { x: number; y: number; z: number }): void {
    this._burst("explosion", pos, [0.25, 0.25, 0.25]);
  }

  /** Sparks when a mob takes damage. */
  mobHurt(pos: { x: number; y: number; z: number }, color: [number, number, number]): void {
    this._burst("mobHurt", pos, color);
  }

  /** Larger burst when a mob dies. */
  mobDeath(pos: { x: number; y: number; z: number }, color: [number, number, number]): void {
    this._burst("mobDeath", pos, color);
  }

  /**
   * Small golden dust puff when a mob spawns. Color is fixed to the
   * DESIGN.md --accent gold (#d4a843 ≈ [0.831, 0.659, 0.263]).
   */
  mobSpawn(pos: { x: number; y: number; z: number }): void {
    // DESIGN.md --accent: #d4a843 → R=212/255, G=168/255, B=67/255
    this._burst("mobSpawn", pos, [0.831, 0.659, 0.263]);
  }

  // --- Introspection -------------------------------------------------------

  /**
   * Live count of particles reported by Babylon across all managed systems.
   * NOTE: Babylon only populates `getActiveCount()` after `scene.render()`, so
   * this returns 0 until the first frame — it is NOT used for cap enforcement.
   * Exposed for external probing (e.g. `__TEST__` usage).
   */
  activeCount(): number {
    let total = 0;
    for (const sys of this._liveSystems) {
      total += sys.getActiveCount();
    }
    return total;
  }

  /**
   * Number of {@link ParticleSystem} instances currently tracked by this
   * manager. Useful for white-box tests that need a frame-independent count.
   */
  liveSystemCount(): number {
    return this._liveSystems.size;
  }

  /** Dispose the shared texture and all live particle systems. */
  dispose(): void {
    for (const sys of this._liveSystems) {
      sys.dispose();
    }
    this._liveSystems.clear();
    this._estimatedActive = 0;
    this.sharedTexture.dispose();
  }

  // --- Internal burst builder ----------------------------------------------

  private _burst(
    key: keyof typeof PARTICLE_CONFIGS,
    pos: { x: number; y: number; z: number },
    color: [number, number, number],
  ): void {
    // Enforce active-particle cap using the synchronous estimate so that
    // same-frame floods (where Babylon's getActiveCount() is still 0) are
    // also bounded.  _estimatedActive is incremented AFTER this gate, so a
    // burst that is skipped here never inflates the counter.
    if (this._estimatedActive >= MAX_ACTIVE_PARTICLES) return;

    const cfg = PARTICLE_CONFIGS[key];

    // Capacity = particle count with a small headroom factor.
    const capacity = Math.ceil(cfg.count * 1.5);
    const sys = new ParticleSystem(`fx_${key}_${Date.now()}`, capacity, this.scene);

    // Shared procedural texture (alpha blending).
    sys.particleTexture = this.sharedTexture;

    // Emit position.
    sys.emitter = new Vector3(pos.x, pos.y, pos.z);

    // Emit spread: a tight sphere around the position.
    sys.createSphereEmitter(0.3);

    // Direction range — sprayed upward with lateral spread.
    sys.direction1 = new Vector3(-1, 0.5, -1);
    sys.direction2 = new Vector3(1, 2.0, 1);

    // Lifetimes in seconds.
    sys.minLifeTime = cfg.minLifeMs / 1000;
    sys.maxLifeTime = cfg.maxLifeMs / 1000;

    // Sizes.
    sys.minSize = cfg.minSize;
    sys.maxSize = cfg.maxSize;

    // Gravity (Y axis; negative = upward for explosion smoke).
    sys.gravity = new Vector3(0, -cfg.gravity, 0);

    // Speed.
    sys.minEmitPower = cfg.speed * 0.5;
    sys.maxEmitPower = cfg.speed;

    // Color: tint the white dot texture with the supplied block/mob colour.
    const [r, g, b] = color;
    sys.color1 = new Color4(r, g, b, 1.0);
    sys.color2 = new Color4(
      Math.min(1, r + 0.15),
      Math.min(1, g + 0.15),
      Math.min(1, b + 0.15),
      0.8,
    );
    sys.colorDead = new Color4(r * 0.5, g * 0.5, b * 0.5, 0.0);

    // One-shot burst: emit exactly `count` particles then stop.
    sys.manualEmitCount = cfg.count;
    sys.emitRate = cfg.count;

    // Let the system auto-dispose when all particles have died.
    sys.disposeOnStop = true;

    // Track the system; remove from set when it disposes itself.
    this._liveSystems.add(sys);
    this._estimatedActive += cfg.count;

    // Clean up our reference when Babylon fires its onDisposeObservable.
    sys.onDisposeObservable.addOnce(() => {
      this._liveSystems.delete(sys);
      this._estimatedActive = Math.max(0, this._estimatedActive - cfg.count);
    });

    sys.start();

    // Use targetStopDuration so the system stops after emitting its burst.
    // Set to max life + a small buffer so all particles can die naturally.
    sys.targetStopDuration = cfg.maxLifeMs / 1000 + 0.1;
  }
}
