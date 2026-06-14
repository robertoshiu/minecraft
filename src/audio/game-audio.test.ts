/**
 * game-audio.test.ts — unit tests for GameAudio using a mock AudioEngineLike.
 */
import { describe, it, expect, vi } from "vitest";
import { GameAudio } from "./game-audio";
import type { AudioEngineLike } from "./game-audio";
import { Blocks } from "../rules/mc-1.20";

interface SfxCall {
  name: string;
  position: { x: number; y: number; z: number } | undefined;
}

function makeMockEngine(): AudioEngineLike & {
  playSfxCalls: SfxCall[];
  startAmbientCalls: string[];
  stopAmbientCalled: number;
} {
  const playSfxCalls: SfxCall[] = [];
  const startAmbientCalls: string[] = [];
  let stopAmbientCalled = 0;

  return {
    playSfxCalls,
    startAmbientCalls,
    get stopAmbientCalled() {
      return stopAmbientCalled;
    },
    playSfx: vi.fn().mockImplementation((name: string, opts?: { position?: { x: number; y: number; z: number } }) => {
      playSfxCalls.push({ name, position: opts?.position });
    }),
    startAmbient: vi.fn().mockImplementation((name: string) => {
      startAmbientCalls.push(name);
    }),
    stopAmbient: vi.fn().mockImplementation(() => {
      stopAmbientCalled++;
    }),
    updateListener: vi.fn(),
  };
}

const POS = { x: 10, y: 64, z: 10 };

describe("GameAudio.onBreak", () => {
  it("calls playSfx(break_stone, {position}) for STONE", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onBreak(Blocks.STONE, POS);
    expect(engine.playSfxCalls[0]?.name).toBe("break_stone");
    expect(engine.playSfxCalls[0]?.position).toEqual(POS);
  });

  it("calls playSfx(break_wood, {position}) for OAK_LOG", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onBreak(Blocks.OAK_LOG, POS);
    expect(engine.playSfxCalls[0]?.name).toBe("break_wood");
    expect(engine.playSfxCalls[0]?.position).toEqual(POS);
  });

  it("calls playSfx(break_glass, {position}) for GLASS", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onBreak(Blocks.GLASS, POS);
    expect(engine.playSfxCalls[0]?.name).toBe("break_glass");
  });

  it("calls playSfx(break_dirt, {position}) for DIRT", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onBreak(Blocks.DIRT, POS);
    expect(engine.playSfxCalls[0]?.name).toBe("break_dirt");
  });

  it("calls playSfx(break_grass, {position}) for GRASS", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onBreak(Blocks.GRASS, POS);
    expect(engine.playSfxCalls[0]?.name).toBe("break_grass");
  });
});

describe("GameAudio.onPlace", () => {
  it("calls playSfx(place_block, {position})", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onPlace(POS);
    expect(engine.playSfxCalls[0]?.name).toBe("place_block");
    expect(engine.playSfxCalls[0]?.position).toEqual(POS);
  });
});

describe("GameAudio.onFootstep", () => {
  it("calls playSfx(footstep_stone) for STONE underfoot", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onFootstep(Blocks.STONE, POS);
    expect(engine.playSfxCalls[0]?.name).toBe("footstep_stone");
  });

  it("calls playSfx(footstep_grass) for GRASS underfoot", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onFootstep(Blocks.GRASS, POS);
    expect(engine.playSfxCalls[0]?.name).toBe("footstep_grass");
  });

  it("calls playSfx(footstep_sand) for SAND underfoot", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onFootstep(Blocks.SAND, POS);
    expect(engine.playSfxCalls[0]?.name).toBe("footstep_sand");
  });
});

describe("GameAudio.onMobSpawn", () => {
  it("plays mob_zombie for zombie spawn at position", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onMobSpawn("zombie", POS);
    expect(engine.playSfxCalls[0]?.name).toBe("mob_zombie");
    expect(engine.playSfxCalls[0]?.position).toEqual(POS);
  });

  it("plays mob_creeper_hiss for creeper spawn", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onMobSpawn("creeper", POS);
    expect(engine.playSfxCalls[0]?.name).toBe("mob_creeper_hiss");
  });

  it("plays mob_cow for cow spawn", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onMobSpawn("cow", POS);
    expect(engine.playSfxCalls[0]?.name).toBe("mob_cow");
  });
});

describe("GameAudio.onMobHurt", () => {
  it("calls playSfx(mob_hurt, {position})", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onMobHurt(POS);
    expect(engine.playSfxCalls[0]?.name).toBe("mob_hurt");
    expect(engine.playSfxCalls[0]?.position).toEqual(POS);
  });
});

describe("GameAudio.onMobDeath", () => {
  it("calls playSfx(mob_death) for zombie death", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onMobDeath("zombie", POS);
    expect(engine.playSfxCalls[0]?.name).toBe("mob_death");
    expect(engine.playSfxCalls[0]?.position).toEqual(POS);
  });

  it("calls playSfx(mob_death) for cow death", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onMobDeath("cow", POS);
    expect(engine.playSfxCalls[0]?.name).toBe("mob_death");
  });
});

describe("GameAudio.onCreeperFuse", () => {
  it("calls playSfx(mob_creeper_hiss, {position})", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onCreeperFuse(POS);
    expect(engine.playSfxCalls[0]?.name).toBe("mob_creeper_hiss");
    expect(engine.playSfxCalls[0]?.position).toEqual(POS);
  });
});

describe("GameAudio.onExplosion", () => {
  it("calls playSfx(explosion, {position})", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.onExplosion(POS);
    expect(engine.playSfxCalls[0]?.name).toBe("explosion");
    expect(engine.playSfxCalls[0]?.position).toEqual(POS);
  });
});

describe("GameAudio.setAmbientBiome", () => {
  it("starts ambient_wind for plains biome", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.setAmbientBiome("plains");
    expect(engine.startAmbientCalls[0]).toBe("ambient_wind");
  });

  it("starts ambient_wind for desert biome", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.setAmbientBiome("desert");
    expect(engine.startAmbientCalls[0]).toBe("ambient_wind");
  });

  it("starts ambient_wind for forest biome", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.setAmbientBiome("forest");
    expect(engine.startAmbientCalls[0]).toBe("ambient_wind");
  });

  it("starts ambient_wind for snow biome", () => {
    const engine = makeMockEngine();
    const ga = new GameAudio(engine);
    ga.setAmbientBiome("snow");
    expect(engine.startAmbientCalls[0]).toBe("ambient_wind");
  });
});
