import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Scene } from "@babylonjs/core/scene";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";

import { makeClock, advance } from "../time/clock";
import { TIME } from "../rules/mc-1.20";
import { skyColorAt } from "../time/sky";
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
  it("sets the scene clear color (and fog color) to the day-time sky color", () => {
    const clock = makeClock(6000); // noon
    applySky(targets(), clock);
    const [r, g, b] = skyColorAt(6000);
    expect(scene.clearColor.r).toBeCloseTo(r, 5);
    expect(scene.clearColor.g).toBeCloseTo(g, 5);
    expect(scene.clearColor.b).toBeCloseTo(b, 5);
    expect(scene.fogColor.r).toBeCloseTo(r, 5);
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
