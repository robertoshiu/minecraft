/**
 * particles.test.ts — tests for PARTICLE_CONFIGS, blockDebrisColor (pure),
 * and ParticleManager construction + burst under NullEngine.
 *
 * Visual simulation is not run under Node (BabylonJS NullEngine doesn't
 * render frames). We only assert that construction and method calls do not
 * throw, and that the active-particle cap is respected.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";

import { PARTICLE_CONFIGS, blockDebrisColor, ParticleManager } from "./particles";
import { Blocks } from "../rules/mc-1.20";

// ---------------------------------------------------------------------------
// Pure config tests
// ---------------------------------------------------------------------------

describe("PARTICLE_CONFIGS", () => {
  const EXPECTED_KEYS = ["break", "place", "footstep", "explosion", "mobHurt", "mobDeath"] as const;

  it("has all 6 required keys", () => {
    for (const key of EXPECTED_KEYS) {
      expect(PARTICLE_CONFIGS).toHaveProperty(key);
    }
  });

  it("every config has a positive count", () => {
    for (const key of EXPECTED_KEYS) {
      expect(PARTICLE_CONFIGS[key].count).toBeGreaterThan(0);
    }
  });

  it("every config has positive minLifeMs and maxLifeMs", () => {
    for (const key of EXPECTED_KEYS) {
      expect(PARTICLE_CONFIGS[key].minLifeMs).toBeGreaterThan(0);
      expect(PARTICLE_CONFIGS[key].maxLifeMs).toBeGreaterThan(0);
    }
  });

  it("maxLifeMs >= minLifeMs for every config", () => {
    for (const key of EXPECTED_KEYS) {
      expect(PARTICLE_CONFIGS[key].maxLifeMs).toBeGreaterThanOrEqual(
        PARTICLE_CONFIGS[key].minLifeMs,
      );
    }
  });

  it("break has the highest count among block events", () => {
    expect(PARTICLE_CONFIGS.break.count).toBeGreaterThan(PARTICLE_CONFIGS.place.count);
    expect(PARTICLE_CONFIGS.break.count).toBeGreaterThan(PARTICLE_CONFIGS.footstep.count);
  });

  it("explosion has the most particles overall", () => {
    const counts = Object.values(PARTICLE_CONFIGS).map((c) => c.count);
    expect(PARTICLE_CONFIGS.explosion.count).toBe(Math.max(...counts));
  });

  it("footstep count is small (<= 5)", () => {
    expect(PARTICLE_CONFIGS.footstep.count).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Pure blockDebrisColor tests
// ---------------------------------------------------------------------------

describe("blockDebrisColor", () => {
  it("returns an array of length 3", () => {
    expect(blockDebrisColor(Blocks.STONE).length).toBe(3);
  });

  it("all components are in [0, 1]", () => {
    for (const blockId of [Blocks.STONE, Blocks.GRASS, Blocks.DIRT, Blocks.SAND, Blocks.OAK_LOG]) {
      const [r, g, b] = blockDebrisColor(blockId);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });

  it("STONE is grayish (R ≈ G ≈ B, all mid-range)", () => {
    const [r, g, b] = blockDebrisColor(Blocks.STONE);
    // Stone tile color is (0.5, 0.5, 0.5) — exactly gray
    expect(Math.abs(r - g)).toBeLessThan(0.1);
    expect(Math.abs(g - b)).toBeLessThan(0.1);
    expect(r).toBeGreaterThan(0.3);
    expect(r).toBeLessThan(0.8);
  });

  it("GRASS top face is greenish (G > R)", () => {
    const grassColor = blockDebrisColor(Blocks.GRASS);
    // grass_top tile is (0.35, 0.55, 0.2) — green dominant
    expect(grassColor[1]).toBeGreaterThan(grassColor[0]);
  });

  it("SAND is pale tan (R high, B less than R)", () => {
    const sandColor = blockDebrisColor(Blocks.SAND);
    // sand tile is (0.85, 0.8, 0.62)
    expect(sandColor[0]).toBeGreaterThan(0.5);
    expect(sandColor[2]).toBeLessThan(sandColor[0]);
  });

  it("unknown block ID returns a fallback (array of 3 numbers in [0,1])", () => {
    const color = blockDebrisColor(9999);
    expect(color.length).toBe(3);
    const [r, g, b] = color;
    expect(r).toBeGreaterThanOrEqual(0);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// ParticleManager under NullEngine
// ---------------------------------------------------------------------------

let engine: NullEngine;
let scene: Scene;
let manager: ParticleManager;

beforeAll(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  manager = new ParticleManager(scene);
});

afterAll(() => {
  manager.dispose();
  scene.dispose();
  engine.dispose();
});

const POS = { x: 10, y: 64, z: 10 };

describe("ParticleManager construction (NullEngine)", () => {
  it("constructs without throwing", () => {
    expect(() => new ParticleManager(scene)).not.toThrow();
  });
});

describe("ParticleManager.blockBreak (NullEngine)", () => {
  it("does not throw", () => {
    expect(() => manager.blockBreak(POS, [0.5, 0.5, 0.5])).not.toThrow();
  });

  it("activeCount is >= 0 after blockBreak", () => {
    const count = manager.activeCount();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

describe("ParticleManager.explosion (NullEngine)", () => {
  it("does not throw", () => {
    expect(() => manager.explosion(POS)).not.toThrow();
  });
});

describe("ParticleManager.blockPlace (NullEngine)", () => {
  it("does not throw", () => {
    expect(() => manager.blockPlace(POS)).not.toThrow();
  });
});

describe("ParticleManager.footstep (NullEngine)", () => {
  it("does not throw", () => {
    expect(() => manager.footstep(POS, [0.5, 0.45, 0.35])).not.toThrow();
  });
});

describe("ParticleManager.mobHurt (NullEngine)", () => {
  it("does not throw", () => {
    expect(() => manager.mobHurt(POS, [0.2, 0.5, 0.15])).not.toThrow();
  });
});

describe("ParticleManager.mobDeath (NullEngine)", () => {
  it("does not throw", () => {
    expect(() => manager.mobDeath(POS, [0.2, 0.5, 0.15])).not.toThrow();
  });
});

describe("ParticleManager active-particle cap (NullEngine)", () => {
  /**
   * This test MUST fail when the cap gates on `activeCount()` (live Babylon
   * count, always 0 under NullEngine with no render frames) and MUST pass when
   * the cap gates on `_estimatedActive` (the synchronous per-burst increment).
   *
   * "break" emits 16 particles per burst; MAX_ACTIVE_PARTICLES = 250.
   * After ceil(250/16) = 16 bursts the estimate reaches/exceeds 256 >= 250,
   * so burst #17 onward is skipped.  Firing 100 bursts therefore creates at
   * most 16 ParticleSystems, not 100.
   */
  it("caps within-frame burst flood via _estimatedActive (not live Babylon count)", () => {
    const freshManager = new ParticleManager(scene);
    const BURST_COUNT = 100;
    for (let i = 0; i < BURST_COUNT; i++) {
      freshManager.blockBreak(POS, [0.5, 0.5, 0.5]);
    }

    // The number of live systems must be bounded — strictly less than the
    // total burst calls (otherwise the cap had no effect at all).
    const systems = freshManager.liveSystemCount();
    expect(systems).toBeGreaterThan(0);          // at least some bursts landed
    expect(systems).toBeLessThan(BURST_COUNT);   // cap prevented unbounded growth

    // Systems * 16 particles/system must not exceed MAX + one burst headroom.
    // (16 is break.count; one burst's worth of headroom accommodates the
    //  boundary burst that tips over 250.)
    const MAX_ACTIVE_PARTICLES = 250;
    const breakCount = PARTICLE_CONFIGS.break.count; // 16
    expect(systems * breakCount).toBeLessThanOrEqual(MAX_ACTIVE_PARTICLES + breakCount - 1);

    freshManager.dispose();
  });

  it("dispose does not throw", () => {
    const freshManager = new ParticleManager(scene);
    freshManager.blockBreak(POS, [0.5, 0.5, 0.5]);
    expect(() => freshManager.dispose()).not.toThrow();
  });
});
