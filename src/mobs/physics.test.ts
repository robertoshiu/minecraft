import { describe, it, expect } from "vitest";
import { Mob } from "./entity";
import { mobStep, tryStepUp, type SolidQuery } from "./physics";
import { PHYSICS } from "../rules/mc-1.20";

/** Floor: solid for every block with by < floorTop (i.e. surface at y = floorTop). */
function flatFloor(floorTop: number): SolidQuery {
  return (_bx, by, _bz) => by < floorTop;
}

const ZERO = { x: 0, y: 0, z: 0 };

describe("mobStep — gravity + landing", () => {
  it("falls under gravity then lands flush on the floor with onGround", () => {
    // Floor surface at y=64 (blocks solid for by < 64).
    const isSolid = flatFloor(64);
    const mob = new Mob(1, "cow", { x: 0.5, y: 70, z: 0.5 });

    let landed = false;
    for (let i = 0; i < 200; i++) {
      mobStep(mob, ZERO, isSolid);
      if (mob.onGround) {
        landed = true;
        break;
      }
    }

    expect(landed).toBe(true);
    // Rests exactly on the surface (feet.y === 64), within collision epsilon.
    expect(mob.feet.y).toBeCloseTo(64, 4);
    // Vertical velocity has been zeroed by the ground contact.
    expect(mob.velocity.y).toBe(0);
  });

  it("accumulates downward velocity while airborne", () => {
    const isSolid = flatFloor(-1000); // effectively no floor in range
    const mob = new Mob(1, "pig", { x: 0.5, y: 100, z: 0.5 });
    mobStep(mob, ZERO, isSolid);
    expect(mob.velocity.y).toBeLessThan(0);
    expect(mob.onGround).toBe(false);
  });

  it("does not exceed terminal velocity", () => {
    const isSolid = flatFloor(-100000);
    const mob = new Mob(1, "pig", { x: 0.5, y: 10000, z: 0.5 });
    for (let i = 0; i < 500; i++) mobStep(mob, ZERO, isSolid);
    expect(mob.velocity.y).toBeGreaterThanOrEqual(PHYSICS.TERMINAL_VEL);
  });
});

describe("mobStep — horizontal wall stop", () => {
  it("stops at a solid wall instead of passing through it", () => {
    // Floor at y=64, plus a wall: solid column at bx=2 for the body's height.
    const isSolid: SolidQuery = (bx, by, _bz) => {
      if (by < 64) return true; // floor
      if (bx === 2 && by >= 64 && by < 67) return true; // wall ahead
      return false;
    };
    const mob = new Mob(1, "cow", { x: 0.5, y: 64, z: 0.5 });
    mob.onGround = true;

    // Push hard toward +x; far more than the gap to the wall at x=2.
    for (let i = 0; i < 30; i++) {
      mobStep(mob, { x: 0.3, y: 0, z: 0 }, isSolid);
    }

    const hw = 0.9 / 2; // cow width
    // Leading face must not penetrate the wall plane at x=2.
    expect(mob.feet.x + hw).toBeLessThanOrEqual(2 + 1e-6);
    // And it actually advanced toward the wall (not stuck at spawn).
    expect(mob.feet.x).toBeGreaterThan(0.5);
  });
});

describe("tryStepUp — D5", () => {
  it("jumps a 1-block ledge", () => {
    // Floor at y=64. A single ledge block one higher at bx=2 (occupies y 64..65).
    const isSolid: SolidQuery = (bx, by, _bz) => {
      if (by < 64) return true; // floor surface at 64
      if (bx === 2 && by === 64) return true; // 1-block ledge
      return false;
    };
    const mob = new Mob(1, "zombie", { x: 1.5, y: 64, z: 0.5 });
    mob.onGround = true;

    const jumped = tryStepUp(mob, isSolid, { x: 1, y: 0, z: 0 });
    expect(jumped).toBe(true);
    expect(mob.velocity.y).toBeCloseTo(PHYSICS.JUMP_VEL, 10);
  });

  it("does NOT jump a 2-block wall", () => {
    const isSolid: SolidQuery = (bx, by, _bz) => {
      if (by < 64) return true; // floor
      if (bx === 2 && (by === 64 || by === 65)) return true; // 2-block wall
      return false;
    };
    const mob = new Mob(1, "zombie", { x: 1.5, y: 64, z: 0.5 });
    mob.onGround = true;

    const jumped = tryStepUp(mob, isSolid, { x: 1, y: 0, z: 0 });
    expect(jumped).toBe(false);
    expect(mob.velocity.y).toBe(0);
  });

  it("does not jump when not on the ground", () => {
    const isSolid: SolidQuery = (bx, by, _bz) => bx === 2 && by === 64;
    const mob = new Mob(1, "zombie", { x: 1.5, y: 64, z: 0.5 });
    mob.onGround = false;
    expect(tryStepUp(mob, isSolid, { x: 1, y: 0, z: 0 })).toBe(false);
  });

  it("does not jump with a zero direction", () => {
    const isSolid: SolidQuery = () => true;
    const mob = new Mob(1, "zombie", { x: 1.5, y: 64, z: 0.5 });
    mob.onGround = true;
    expect(tryStepUp(mob, isSolid, { x: 0, y: 0, z: 0 })).toBe(false);
  });
});
