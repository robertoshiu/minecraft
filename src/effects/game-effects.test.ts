/**
 * game-effects.test.ts — tests for GameEffects using a mock ParticleManager.
 *
 * No Babylon, no NullEngine. The ParticleManager is replaced by a mock that
 * records which methods were called and with what arguments.
 */
import { describe, it, expect, vi } from "vitest";
import { GameEffects } from "./game-effects";
import type { ParticleManager } from "./particles";
import { Blocks } from "../rules/mc-1.20";

// ---------------------------------------------------------------------------
// Mock ParticleManager
// ---------------------------------------------------------------------------

type Pos3 = { x: number; y: number; z: number };
type RGB = [number, number, number];

interface MockManager {
  blockBreakCalls: Array<{ pos: Pos3; color: RGB }>;
  blockPlaceCalls: Array<{ pos: Pos3 }>;
  footstepCalls: Array<{ pos: Pos3; color: RGB }>;
  explosionCalls: Array<{ pos: Pos3 }>;
  mobHurtCalls: Array<{ pos: Pos3; color: RGB }>;
  mobDeathCalls: Array<{ pos: Pos3; color: RGB }>;
}

function makeMockManager(): ParticleManager & MockManager {
  const blockBreakCalls: Array<{ pos: Pos3; color: RGB }> = [];
  const blockPlaceCalls: Array<{ pos: Pos3 }> = [];
  const footstepCalls: Array<{ pos: Pos3; color: RGB }> = [];
  const explosionCalls: Array<{ pos: Pos3 }> = [];
  const mobHurtCalls: Array<{ pos: Pos3; color: RGB }> = [];
  const mobDeathCalls: Array<{ pos: Pos3; color: RGB }> = [];

  return {
    blockBreakCalls,
    blockPlaceCalls,
    footstepCalls,
    explosionCalls,
    mobHurtCalls,
    mobDeathCalls,
    blockBreak: vi.fn().mockImplementation((pos: Pos3, color: RGB) => {
      blockBreakCalls.push({ pos, color });
    }),
    blockPlace: vi.fn().mockImplementation((pos: Pos3) => {
      blockPlaceCalls.push({ pos });
    }),
    footstep: vi.fn().mockImplementation((pos: Pos3, color: RGB) => {
      footstepCalls.push({ pos, color });
    }),
    explosion: vi.fn().mockImplementation((pos: Pos3) => {
      explosionCalls.push({ pos });
    }),
    mobHurt: vi.fn().mockImplementation((pos: Pos3, color: RGB) => {
      mobHurtCalls.push({ pos, color });
    }),
    mobDeath: vi.fn().mockImplementation((pos: Pos3, color: RGB) => {
      mobDeathCalls.push({ pos, color });
    }),
    activeCount: vi.fn().mockReturnValue(0),
    dispose: vi.fn(),
  } as unknown as ParticleManager & MockManager;
}

const POS = { x: 10, y: 64, z: 10 };

// ---------------------------------------------------------------------------
// onBreak
// ---------------------------------------------------------------------------

describe("GameEffects.onBreak", () => {
  it("calls manager.blockBreak with a grayish color for STONE", () => {
    const mgr = makeMockManager();
    const ge = new GameEffects(mgr);
    ge.onBreak(Blocks.STONE, POS);

    expect(mgr.blockBreakCalls.length).toBe(1);
    const call = mgr.blockBreakCalls[0];
    expect(call).toBeDefined();
    const [r, g, b] = call!.color;
    // Stone is approximately (0.5, 0.5, 0.5) — channels should be close
    expect(Math.abs(r - g)).toBeLessThan(0.15);
    expect(Math.abs(g - b)).toBeLessThan(0.15);
  });

  it("calls manager.blockBreak with a greenish color for GRASS", () => {
    const mgr = makeMockManager();
    const ge = new GameEffects(mgr);
    ge.onBreak(Blocks.GRASS, POS);

    expect(mgr.blockBreakCalls.length).toBe(1);
    const call = mgr.blockBreakCalls[0];
    expect(call).toBeDefined();
    const [r, g] = call!.color;
    expect(g).toBeGreaterThan(r);
  });

  it("passes the correct position to blockBreak", () => {
    const mgr = makeMockManager();
    const ge = new GameEffects(mgr);
    ge.onBreak(Blocks.STONE, POS);

    const call = mgr.blockBreakCalls[0];
    expect(call?.pos).toEqual(POS);
  });
});

// ---------------------------------------------------------------------------
// onPlace
// ---------------------------------------------------------------------------

describe("GameEffects.onPlace", () => {
  it("calls manager.blockPlace with the given position", () => {
    const mgr = makeMockManager();
    const ge = new GameEffects(mgr);
    ge.onPlace(POS);

    expect(mgr.blockPlaceCalls.length).toBe(1);
    expect(mgr.blockPlaceCalls[0]?.pos).toEqual(POS);
  });
});

// ---------------------------------------------------------------------------
// onFootstep
// ---------------------------------------------------------------------------

describe("GameEffects.onFootstep", () => {
  it("calls manager.footstep with STONE block color", () => {
    const mgr = makeMockManager();
    const ge = new GameEffects(mgr);
    ge.onFootstep(Blocks.STONE, POS);

    expect(mgr.footstepCalls.length).toBe(1);
    const call = mgr.footstepCalls[0];
    expect(call?.pos).toEqual(POS);
    // Stone is grayish
    const [r, g, b] = call!.color;
    expect(Math.abs(r - g)).toBeLessThan(0.15);
    expect(Math.abs(g - b)).toBeLessThan(0.15);
  });
});

// ---------------------------------------------------------------------------
// onExplosion
// ---------------------------------------------------------------------------

describe("GameEffects.onExplosion", () => {
  it("calls manager.explosion with the given position", () => {
    const mgr = makeMockManager();
    const ge = new GameEffects(mgr);
    ge.onExplosion(POS);

    expect(mgr.explosionCalls.length).toBe(1);
    expect(mgr.explosionCalls[0]?.pos).toEqual(POS);
  });
});

// ---------------------------------------------------------------------------
// onMobHurt
// ---------------------------------------------------------------------------

describe("GameEffects.onMobHurt", () => {
  it("calls manager.mobHurt with a greenish color for zombie", () => {
    const mgr = makeMockManager();
    const ge = new GameEffects(mgr);
    ge.onMobHurt("zombie", POS);

    expect(mgr.mobHurtCalls.length).toBe(1);
    const call = mgr.mobHurtCalls[0];
    const [r, , b] = call!.color;
    // zombie tint is (0.2, 0.5, 0.15) — G dominates
    expect(call!.color[1]).toBeGreaterThan(r);
    expect(call!.color[1]).toBeGreaterThan(b);
  });

  it("calls manager.mobHurt with a whitish color for skeleton", () => {
    const mgr = makeMockManager();
    const ge = new GameEffects(mgr);
    ge.onMobHurt("skeleton", POS);

    const call = mgr.mobHurtCalls[0];
    const [r, g, b] = call!.color;
    expect(r).toBeGreaterThan(0.7);
    expect(g).toBeGreaterThan(0.7);
    expect(b).toBeGreaterThan(0.7);
  });
});

// ---------------------------------------------------------------------------
// onMobDeath
// ---------------------------------------------------------------------------

describe("GameEffects.onMobDeath", () => {
  it("calls manager.mobDeath for zombie", () => {
    const mgr = makeMockManager();
    const ge = new GameEffects(mgr);
    ge.onMobDeath("zombie", POS);

    expect(mgr.mobDeathCalls.length).toBe(1);
    expect(mgr.mobDeathCalls[0]?.pos).toEqual(POS);
  });

  it("calls manager.mobDeath for creeper with greenish tint", () => {
    const mgr = makeMockManager();
    const ge = new GameEffects(mgr);
    ge.onMobDeath("creeper", POS);

    const call = mgr.mobDeathCalls[0];
    const [r, g, b] = call!.color;
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });
});
