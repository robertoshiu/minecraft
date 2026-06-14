import { describe, it, expect } from "vitest";
import { PHYSICS, FALL } from "../rules/mc-1.20";
import {
  makePhysicsState,
  tryJump,
  stepVerticalVelocity,
  onLand,
  accumulateFall,
  fallDamage,
  type PhysicsState,
} from "./physics";

describe("makePhysicsState", () => {
  it("starts at rest, airborne, no fall, no cooldown", () => {
    const s = makePhysicsState();
    expect(s).toEqual<PhysicsState>({
      vy: 0,
      onGround: false,
      fallDistance: 0,
      jumpCooldown: 0,
    });
  });

  it("returns an independent state object each call", () => {
    const a = makePhysicsState();
    const b = makePhysicsState();
    a.vy = 1;
    expect(b.vy).toBe(0);
  });
});

describe("fallDamage", () => {
  // Corrected reference values: SAFE_BLOCKS=3, DAMAGE_PER_BLOCK=1.
  it.each([
    [3, 0],
    [4, 1],
    [10, 7],
    [20, 17],
    [0, 0],
  ])("fallDistance %d -> %d damage", (dist, expected) => {
    expect(fallDamage(dist)).toBe(expected);
  });

  it("is zero for fractional falls within the safe threshold", () => {
    expect(fallDamage(3.9)).toBe(0);
  });

  it("floors fractional fall distance beyond the safe threshold", () => {
    // 7.9 - 3 = 4.9 -> floor 4 -> 4 damage
    expect(fallDamage(7.9)).toBe(4);
  });

  it("never returns negative damage", () => {
    expect(fallDamage(-100)).toBe(0);
  });

  it("matches the constant-driven formula exactly", () => {
    const d = 12.5;
    expect(fallDamage(d)).toBe(
      Math.max(0, Math.floor(d - FALL.SAFE_BLOCKS)) * FALL.DAMAGE_PER_BLOCK,
    );
  });
});

describe("tryJump", () => {
  it("fails when airborne", () => {
    const s = makePhysicsState(); // onGround false
    expect(tryJump(s)).toBe(false);
    expect(s.vy).toBe(0);
    expect(s.jumpCooldown).toBe(0);
  });

  it("succeeds when grounded and off cooldown", () => {
    const s = makePhysicsState();
    s.onGround = true;
    expect(tryJump(s)).toBe(true);
    expect(s.vy).toBe(PHYSICS.JUMP_VEL);
    expect(s.jumpCooldown).toBe(PHYSICS.JUMP_COOLDOWN_TICKS);
    expect(s.onGround).toBe(false);
  });

  it("fails during cooldown even if grounded", () => {
    const s = makePhysicsState();
    s.onGround = true;
    s.jumpCooldown = 5;
    expect(tryJump(s)).toBe(false);
    expect(s.vy).toBe(0); // untouched
  });

  it("cooldown decrements over ticks and a re-jump is gated until it hits 0", () => {
    const s = makePhysicsState();
    s.onGround = true;
    expect(tryJump(s)).toBe(true);
    expect(s.jumpCooldown).toBe(PHYSICS.JUMP_COOLDOWN_TICKS);

    // Simulate landing immediately but stay on cooldown: ground the body
    // back without resetting cooldown, and step until cooldown expires.
    for (let t = 0; t < PHYSICS.JUMP_COOLDOWN_TICKS; t++) {
      s.onGround = true; // pretend collision keeps us grounded
      expect(tryJump(s)).toBe(false); // still cooling down
      stepVerticalVelocity(s); // ticks the cooldown down
    }
    expect(s.jumpCooldown).toBe(0);

    s.onGround = true;
    expect(tryJump(s)).toBe(true); // now allowed again
  });
});

describe("stepVerticalVelocity", () => {
  it("applies gravity then drag, returning the new vy and the delta", () => {
    const s = makePhysicsState();
    s.vy = 0;
    const dy = stepVerticalVelocity(s);
    const expected = (0 - PHYSICS.GRAVITY) * PHYSICS.DRAG;
    expect(dy).toBeCloseTo(expected, 10);
    expect(s.vy).toBeCloseTo(expected, 10);
  });

  it("does not modify onGround", () => {
    const s = makePhysicsState();
    s.onGround = true;
    stepVerticalVelocity(s);
    expect(s.onGround).toBe(true);
  });

  it("clamps to terminal velocity from rest after many ticks and never goes below", () => {
    const s = makePhysicsState();
    let min = Infinity;
    for (let t = 0; t < 2000; t++) {
      const vy = stepVerticalVelocity(s);
      expect(vy).toBeGreaterThanOrEqual(PHYSICS.TERMINAL_VEL);
      min = Math.min(min, vy);
    }
    // Converges asymptotically to TERMINAL_VEL; never dips below it.
    expect(min).toBeGreaterThanOrEqual(PHYSICS.TERMINAL_VEL);
    expect(s.vy).toBeCloseTo(PHYSICS.TERMINAL_VEL, 4);
  });

  it("hard-clamps when velocity is already past terminal velocity", () => {
    const s = makePhysicsState();
    s.vy = PHYSICS.TERMINAL_VEL - 1; // artificially below terminal
    const vy = stepVerticalVelocity(s);
    expect(vy).toBe(PHYSICS.TERMINAL_VEL);
    expect(s.vy).toBe(PHYSICS.TERMINAL_VEL);
  });
});

describe("jump arc integration", () => {
  it("produces the expected vy sequence and a ~1.25-block apex around tick 5-6", () => {
    const s = makePhysicsState();
    s.onGround = true;
    expect(tryJump(s)).toBe(true);

    // The integrator applies the CURRENT vy to position this tick, then steps
    // to obtain next tick's velocity. So the velocity series is the initial
    // jump velocity followed by each stepVerticalVelocity return.
    const vySeries: number[] = [s.vy];
    let y = 0;
    let maxHeight = 0;
    let apexTick = 0;

    for (let t = 1; t <= 30; t++) {
      y += s.vy; // apply current velocity
      if (y > maxHeight) {
        maxHeight = y;
        apexTick = t;
      }
      const nextVy = stepVerticalVelocity(s); // advance velocity
      vySeries.push(nextVy);
    }

    const expectedSeries = [0.42, 0.333, 0.248, 0.165, 0.083, 0.003, -0.075];
    for (let i = 0; i < expectedSeries.length; i++) {
      expect(vySeries[i]).toBeCloseTo(expectedSeries[i] as number, 2);
    }

    expect(apexTick).toBeGreaterThanOrEqual(5);
    expect(apexTick).toBeLessThanOrEqual(7);
    expect(maxHeight).toBeGreaterThanOrEqual(1.15);
    expect(maxHeight).toBeLessThanOrEqual(1.35);
  });
});

describe("accumulateFall", () => {
  it("adds positive downward distance to fallDistance", () => {
    const s = makePhysicsState();
    accumulateFall(s, 2);
    accumulateFall(s, 3.5);
    expect(s.fallDistance).toBeCloseTo(5.5, 10);
  });

  it("ignores zero and upward (non-positive) deltas", () => {
    const s = makePhysicsState();
    accumulateFall(s, 0);
    accumulateFall(s, -4);
    expect(s.fallDistance).toBe(0);
  });
});

describe("onLand", () => {
  it("returns fall damage, then resets fall state and grounds the body", () => {
    const s = makePhysicsState();
    s.fallDistance = 10;
    s.vy = PHYSICS.TERMINAL_VEL;
    const dmg = onLand(s);
    expect(dmg).toBe(7); // floor(10 - 3) * 1
    expect(s.fallDistance).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.onGround).toBe(true);
  });

  it("returns zero damage for a safe landing", () => {
    const s = makePhysicsState();
    s.fallDistance = 2;
    expect(onLand(s)).toBe(0);
    expect(s.onGround).toBe(true);
  });
});

describe("end-to-end: fall, accumulate, land", () => {
  it("falls from rest, tracks downward distance, then takes damage on landing", () => {
    const s = makePhysicsState();
    // Free-fall for a while, accumulating downward distance from the deltas.
    for (let t = 0; t < 30; t++) {
      const dy = stepVerticalVelocity(s);
      if (dy < 0) accumulateFall(s, -dy);
    }
    expect(s.fallDistance).toBeGreaterThan(FALL.SAFE_BLOCKS);

    // Damage is computed from the accumulated distance BEFORE onLand resets it.
    const expectedDamage = fallDamage(s.fallDistance);
    const dmg = onLand(s);
    expect(dmg).toBe(expectedDamage);
    expect(dmg).toBeGreaterThan(0);
    expect(s.fallDistance).toBe(0);
    expect(s.vy).toBe(0);
    expect(s.onGround).toBe(true);
  });
});
