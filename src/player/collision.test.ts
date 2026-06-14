import { describe, it, expect } from "vitest";
import {
  aabbFromFeet,
  sweepMove,
  PLAYER_SIZE,
  type SolidQuery,
  type Vec3,
} from "./collision";

/** Build a SolidQuery from a set of "x,y,z" integer-block keys. */
function solidFromSet(keys: Iterable<string>): SolidQuery {
  const set = new Set(keys);
  return (bx, by, bz) => set.has(`${bx},${by},${bz}`);
}

/** Solid query from a predicate over integer block coords. */
function solidFromPredicate(pred: SolidQuery): SolidQuery {
  return pred;
}

const NONE: SolidQuery = () => false;

describe("aabbFromFeet", () => {
  it("centers x/z on feet and runs y from feet.y to feet.y+height", () => {
    const feet: Vec3 = { x: 10, y: 64, z: -5 };
    const box = aabbFromFeet(feet);
    expect(box.minX).toBeCloseTo(10 - PLAYER_SIZE.width / 2);
    expect(box.maxX).toBeCloseTo(10 + PLAYER_SIZE.width / 2);
    expect(box.minZ).toBeCloseTo(-5 - PLAYER_SIZE.depth / 2);
    expect(box.maxZ).toBeCloseTo(-5 + PLAYER_SIZE.depth / 2);
    expect(box.minY).toBeCloseTo(64);
    expect(box.maxY).toBeCloseTo(64 + PLAYER_SIZE.height);
  });

  it("player size is the documented 0.6 x 1.8 x 0.6", () => {
    expect(PLAYER_SIZE.width).toBe(0.6);
    expect(PLAYER_SIZE.height).toBe(1.8);
    expect(PLAYER_SIZE.depth).toBe(0.6);
  });
});

describe("sweepMove - floor", () => {
  it("lands on top of a y=63 floor plane (block occupies [63,64])", () => {
    const isSolid = solidFromPredicate((_bx, by, _bz) => by === 63);
    const res = sweepMove({ x: 0.5, y: 64.5, z: 0.5 }, { x: 0, y: -5, z: 0 }, isSolid);
    expect(res.feet.y).toBeCloseTo(64);
    expect(res.collided.y).toBe(true);
    expect(res.onGround).toBe(true);
    expect(res.collided.x).toBe(false);
    expect(res.collided.z).toBe(false);
  });

  it("standing still on the floor stays put with onGround true", () => {
    const isSolid = solidFromPredicate((_bx, by, _bz) => by === 63);
    const res = sweepMove({ x: 0.5, y: 64, z: 0.5 }, { x: 0, y: 0, z: 0 }, isSolid);
    expect(res.feet.x).toBeCloseTo(0.5);
    expect(res.feet.y).toBeCloseTo(64);
    expect(res.feet.z).toBeCloseTo(0.5);
    expect(res.onGround).toBe(true);
  });
});

describe("sweepMove - wall", () => {
  it("stops flush against a +x wall at x=1 so maxX ~= 1.0", () => {
    const isSolid = solidFromPredicate((bx, _by, _bz) => bx === 1);
    const res = sweepMove({ x: 0.5, y: 64, z: 0 }, { x: 5, y: 0, z: 0 }, isSolid);
    const box = aabbFromFeet(res.feet);
    expect(box.maxX).toBeCloseTo(1.0);
    expect(res.collided.x).toBe(true);
  });
});

describe("sweepMove - slide", () => {
  it("x blocked by wall but z advances freely", () => {
    const isSolid = solidFromPredicate((bx, _by, _bz) => bx === 1);
    const startZ = 0;
    const res = sweepMove({ x: 0.5, y: 64, z: startZ }, { x: 5, y: 0, z: 5 }, isSolid);
    expect(res.collided.x).toBe(true);
    expect(res.collided.z).toBe(false);
    expect(res.feet.z - startZ).toBeCloseTo(5);
    const box = aabbFromFeet(res.feet);
    expect(box.maxX).toBeCloseTo(1.0);
  });
});

describe("sweepMove - no tunneling", () => {
  it("does not pass through a 1-block-thick wall at x=1 at high speed", () => {
    const isSolid = solidFromSet(["1,64,0", "1,65,0"]);
    const res = sweepMove({ x: 0.5, y: 64, z: 0 }, { x: 20, y: 0, z: 0 }, isSolid);
    const box = aabbFromFeet(res.feet);
    expect(box.maxX).toBeLessThanOrEqual(1.0 + 1e-9);
    expect(res.collided.x).toBe(true);
  });
});

describe("sweepMove - free fall", () => {
  it("moves by the full velocity when nothing is solid", () => {
    const res = sweepMove({ x: 0, y: 100, z: 0 }, { x: 1, y: -10, z: 2 }, NONE);
    expect(res.feet.x).toBeCloseTo(1);
    expect(res.feet.y).toBeCloseTo(90);
    expect(res.feet.z).toBeCloseTo(2);
    expect(res.collided.x).toBe(false);
    expect(res.collided.y).toBe(false);
    expect(res.collided.z).toBe(false);
    expect(res.onGround).toBe(false);
  });
});
