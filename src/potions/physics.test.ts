import { describe, it, expect } from "vitest";
import { splashPotionStep } from "./physics";
import { Blocks } from "../rules/mc-1.20";

const AIR = () => Blocks.AIR;

describe("splashPotionStep", () => {
  it("advances through air with no hit", () => {
    const p = { feet: { x: 0, y: 10, z: 0 }, velocity: { x: 1, y: 0, z: 0 }, age: 0, burst: false };
    const hit = splashPotionStep(p, AIR, []);
    expect(hit.kind).toBe("none");
    expect(p.burst).toBe(false);
    expect(p.feet.x).toBeGreaterThan(0);
  });
  it("BURSTS on a block hit (does not pass through)", () => {
    // A solid wall at x>=2: getBlock returns STONE for x>=2.
    const getBlock = (bx: number) => (bx >= 2 ? Blocks.STONE : Blocks.AIR);
    const p = { feet: { x: 0, y: 10, z: 0 }, velocity: { x: 3, y: 0, z: 0 }, age: 0, burst: false };
    const hit = splashPotionStep(p, getBlock, []);
    expect(hit.kind).toBe("burst");
    expect(p.burst).toBe(true);
  });
});
