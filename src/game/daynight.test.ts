import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";

import { makeClock, advance } from "../time/clock";
import { TIME } from "../rules/mc-1.20";
import { skyColorAt, sunLightIntensityAt } from "../time/sky";
import { applySky, type SkyTargets } from "./daynight";

let engine: NullEngine;
let scene: Scene;
let sun: DirectionalLight;
let hemi: HemisphericLight;

beforeAll(() => {
  engine = new NullEngine();
  scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 1);
  sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene);
  hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
});

afterAll(() => {
  scene.dispose();
  engine.dispose();
});

function targets(): SkyTargets {
  return { scene, sun, hemi };
}

describe("applySky", () => {
  it("sets the scene clear color to the day-time sky color", () => {
    const clock = makeClock(6000); // mid-morning, full sun intensity
    applySky(targets(), clock);
    const [r, g, b] = skyColorAt(6000);
    expect(scene.clearColor.r).toBeCloseTo(r, 5);
    expect(scene.clearColor.g).toBeCloseTo(g, 5);
    expect(scene.clearColor.b).toBeCloseTo(b, 5);
  });

  it("fog is warmer than the sky during the day (decoupled from clearColor)", () => {
    const tod = 6000; // mid-morning: sunLightIntensityAt returns 1 (full day)
    applySky(targets(), makeClock(tod));
    const [r, , b] = skyColorAt(tod);
    // Fog should be warmer (more red) and less blue than the sky clear color.
    expect(scene.fogColor.r).toBeGreaterThan(r);
    expect(scene.fogColor.b).toBeLessThan(b);
    expect(scene.fogColor.g).toBeGreaterThanOrEqual(scene.clearColor.g);
    // All channels must stay within [0, 1].
    expect(scene.fogColor.r).toBeGreaterThanOrEqual(0);
    expect(scene.fogColor.r).toBeLessThanOrEqual(1);
    expect(scene.fogColor.g).toBeGreaterThanOrEqual(0);
    expect(scene.fogColor.g).toBeLessThanOrEqual(1);
    expect(scene.fogColor.b).toBeGreaterThanOrEqual(0);
    expect(scene.fogColor.b).toBeLessThanOrEqual(1);
  });

  it("fog tracks the sky at night when sun intensity is ~0", () => {
    const tod = 18000; // midnight: sunLightIntensityAt returns 0
    applySky(targets(), makeClock(tod));
    const [r, g, b] = skyColorAt(tod);
    // With intensity == 0 the offsets vanish, so fog == sky exactly.
    expect(sunLightIntensityAt(tod)).toBe(0);
    expect(scene.fogColor.r).toBeCloseTo(r, 5);
    expect(scene.fogColor.g).toBeCloseTo(g, 5);
    expect(scene.fogColor.b).toBeCloseTo(b, 5);
  });

  it("sun is bright at noon and dark at midnight", () => {
    const noon = makeClock(6000);
    applySky(targets(), noon);
    const noonIntensity = sun.intensity;

    const midnight = makeClock(18000);
    applySky(targets(), midnight);
    const midnightIntensity = sun.intensity;

    expect(noonIntensity).toBeGreaterThan(1); // scaled toward SUN_MAX (2.4)
    expect(midnightIntensity).toBeCloseTo(0, 5);
  });

  it("hemispheric ambient is dimmer at night than during the day", () => {
    applySky(targets(), makeClock(6000));
    const dayHemi = hemi.intensity;
    applySky(targets(), makeClock(18000));
    const nightHemi = hemi.intensity;
    expect(nightHemi).toBeLessThan(dayHemi);
    expect(nightHemi).toBeGreaterThan(0); // never fully black
  });

  it("sun direction points downward at noon (light travels down)", () => {
    applySky(targets(), makeClock(6000));
    // sunDirectionAt(6000) is overhead (+y); the light's travel direction is
    // negated, so it should point down (negative y).
    expect(sun.direction.y).toBeLessThan(0);
  });

  it("a full day is TICKS_PER_DAY ticks = REAL_SECONDS_PER_DAY at 20 TPS", () => {
    // 24000 ticks / 20 ticks-per-second == 1200 seconds (20 minutes).
    expect(TIME.TICKS_PER_DAY / 20).toBe(TIME.REAL_SECONDS_PER_DAY);

    const clock = makeClock();
    for (let i = 0; i < TIME.TICKS_PER_DAY; i++) advance(clock, 1);
    // After one full day, the time-of-day color matches tod 0 again.
    applySky(targets(), clock);
    const [r] = skyColorAt(0);
    expect(scene.clearColor.r).toBeCloseTo(r, 5);
  });
});

describe("golden-hour spawn TOD", () => {
  it("spawn TOD 10000 is before SUNSET_START (full sun intensity)", () => {
    const SPAWN_TOD = 10000;
    expect(SPAWN_TOD).toBeLessThan(TIME.SUNSET_START);
    expect(sunLightIntensityAt(SPAWN_TOD)).toBeCloseTo(1.0, 5);
  });

  it("skyColorAt(10000) is warm (red channel dominant over blue)", () => {
    const [r, , b] = skyColorAt(10000);
    expect(r).toBeGreaterThan(b);
  });
});

function makeSkyHarness(): { targets: SkyTargets; clock: ReturnType<typeof makeClock> } {
  const eng = new NullEngine();
  const sc = new Scene(eng);
  sc.clearColor = new Color4(0, 0, 0, 1);
  const s = new DirectionalLight("sun", new Vector3(0, -1, 0), sc);
  const h = new HemisphericLight("hemi", new Vector3(0, 1, 0), sc);
  return { targets: { scene: sc, sun: s, hemi: h }, clock: makeClock(10000) };
}

describe("applySky — IBL env wiring (Phase 6d)", () => {
  it("sets environmentTexture + clamped environmentIntensity when env is passed", () => {
    const { targets: t, clock } = makeSkyHarness();
    const fakeTex = {} as unknown as import("@babylonjs/core/Materials/Textures/baseTexture").BaseTexture;
    applySky(t, clock, { texture: fakeTex, intensity: 0.4 });
    expect(t.scene.environmentTexture).toBe(fakeTex);
    expect(t.scene.environmentIntensity).toBeCloseTo(0.4, 10);
  });

  it("clamps an out-of-range env intensity into [0,1]", () => {
    const { targets: t, clock } = makeSkyHarness();
    const fakeTex = {} as unknown as import("@babylonjs/core/Materials/Textures/baseTexture").BaseTexture;
    applySky(t, clock, { texture: fakeTex, intensity: 9 });
    expect(t.scene.environmentIntensity).toBe(1);
  });

  it("leaves environmentTexture null when env is omitted (default path)", () => {
    const { targets: t, clock } = makeSkyHarness();
    applySky(t, clock); // no env arg
    expect(t.scene.environmentTexture).toBeNull();
  });
});
