import { describe, it, expect } from "vitest";
import { Mob } from "./entity";
import { mobStep, tryStepUp, type SolidQuery } from "./physics";
import { PHYSICS, BABY_SCALE } from "../rules/mc-1.20";
import { MOB_STATS } from "../rules/mob-stats";

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

it("mobStep blends the knockback accumulator into horizontal velocity then decays it", () => {
  const mob = new Mob(1, "zombie", { x: 0, y: 8, z: 0 });
  mob.knockback = { x: 0.4, y: 0, z: 0 };
  const noSolid = () => false; // open air
  mobStep(mob, ZERO, noSolid);
  expect(mob.feet.x).toBeGreaterThan(0);
  expect(mob.knockback.x).toBeCloseTo(0.2, 6);
});

describe("baby hitbox physics (Phase 6c)", () => {
  it("a baby cow fits under a ceiling its adult self would hit", () => {
    // Differential: cow height=1.4, baby height=0.7 (BABY_SCALE=0.5).
    //
    // Geometry (tryStepUp headroom check):
    //   landingY = feetY + 1 = 65.
    //   adult topCell = floor(65 + 1.4 - eps) = floor(66.4) = 66  → hits ceiling at by=66.
    //   baby  topCell = floor(65 + 0.7 - eps) = floor(65.7) = 65  → cell 65 is air → clears.
    //
    // Clearance above landing is ~1.0 block for the baby (65→66) and only ~0.4 for
    // the adult (65→66 with top at 66.4), so ceiling solid at by=66 blocks the adult
    // but not the baby.
    //
    // Both mobs must have onGround=true so tryStepUp doesn't short-circuit before
    // reading the scaled height.
    const isSolid: SolidQuery = (bx, by, _bz) => {
      if (by < 64) return true;         // floor surface at y=64
      if (bx === 2 && by === 64) return true; // 1-block ledge ahead
      if (by === 66) return true;        // low ceiling — in the band (baby height=0.7 < 1.0, adult height=1.4 > 1.0)
      return false;
    };

    const baby = new Mob(1, "cow", { x: 1.5, y: 64, z: 0.5 });
    baby.extra["babyScale"] = BABY_SCALE;
    baby.onGround = true;

    const adult = new Mob(2, "cow", { x: 1.5, y: 64, z: 0.5 });
    adult.onGround = true;

    // Baby clears the ceiling; adult is blocked by it.
    expect(tryStepUp(baby, isSolid, { x: 1, y: 0, z: 0 })).toBe(true);
    expect(tryStepUp(adult, isSolid, { x: 1, y: 0, z: 0 })).toBe(false);
  });

  it("a baby's collision box is narrower than an adult's (stops further from a wall)", () => {
    // Differential: cow width=0.9, hw=0.45; baby hw=0.225 (BABY_SCALE=0.5).
    //
    // Both mobs are driven into a solid wall at bx=2 (face at x=2.0) along +x.
    // resolveAxis clamps each mob when its leading face (feet.x + hw) reaches the
    // wall face (x=2.0 - eps).  After convergence:
    //   adult stops at feet.x ≈ 2.0 - 0.45 = 1.55
    //   baby  stops at feet.x ≈ 2.0 - 0.225 = 1.775
    //
    // So baby.feet.x > adult.feet.x — the baby advances closer to the wall because
    // its half-width is half the adult's.  If the scale wiring were reverted so the
    // baby accidentally used adult width, both would stop at ~1.55 and the assertion
    // would fail.
    const isSolid: SolidQuery = (bx, by, _bz) => {
      if (by < 64) return true;  // floor
      if (bx === 2) return true; // wall ahead at x=2..3
      return false;
    };

    const baby = new Mob(1, "cow", { x: 0.5, y: 64, z: 0.5 });
    baby.extra["babyScale"] = BABY_SCALE;
    baby.onGround = true;

    const adult = new Mob(2, "cow", { x: 0.5, y: 64, z: 0.5 });
    adult.onGround = true;

    const push = { x: 0.3, y: 0, z: 0 };
    for (let i = 0; i < 30; i++) {
      mobStep(baby, push, isSolid);
      mobStep(adult, push, isSolid);
    }

    // Baby is closer to the wall because its narrower box fits further in.
    expect(baby.feet.x).toBeGreaterThan(adult.feet.x);
    // Adult leading face is flush against the wall face (x=2.0).
    const adultHw = MOB_STATS["cow"].width / 2; // 0.45
    expect(adult.feet.x + adultHw).toBeCloseTo(2.0, 4);
    // Baby leading face is also flush against the same wall face.
    const babyHw = adultHw * BABY_SCALE; // 0.225
    expect(baby.feet.x + babyHw).toBeCloseTo(2.0, 4);
  });
});
