import { describe, it, expect } from "vitest";
import { Mob, type Vec3 } from "./entity";
import type { SolidQuery } from "./physics";
import { Blocks } from "../rules/mc-1.20";
import {
  hasLineOfSight,
  tickHostile,
  type CombatHooks,
  type BlockQuery,
  CREEPER_FUSE_TICKS,
} from "./hostile-ai";

/** Floor: solid for every block with by < floorTop (surface at y = floorTop). */
function flatFloor(floorTop: number): SolidQuery {
  return (_bx, by, _bz) => by < floorTop;
}

/** All-air world for block queries (no opaque obstruction). */
const ALL_AIR: BlockQuery = () => Blocks.AIR;

/** A CombatHooks fake that records hits and reports a fixed player position. */
function makeHooks(playerPos: Vec3): {
  hooks: CombatHooks;
  hits: number[];
  setPlayer: (p: Vec3) => void;
} {
  let pos = playerPos;
  const hits: number[] = [];
  const hooks: CombatHooks = {
    damagePlayer: (amount: number) => {
      hits.push(amount);
    },
    playerEyePos: () => pos,
  };
  return { hooks, hits, setPlayer: (p) => (pos = p) };
}

describe("hasLineOfSight", () => {
  it("is clear across open air", () => {
    const from: Vec3 = { x: 0.5, y: 65, z: 0.5 };
    const to: Vec3 = { x: 8.5, y: 65, z: 0.5 };
    expect(hasLineOfSight(from, to, ALL_AIR)).toBe(true);
  });

  it("is blocked by an opaque block between the points", () => {
    const wall: BlockQuery = (bx, _by, _bz) =>
      bx === 4 ? Blocks.STONE : Blocks.AIR;
    const from: Vec3 = { x: 0.5, y: 65, z: 0.5 };
    const to: Vec3 = { x: 8.5, y: 65, z: 0.5 };
    expect(hasLineOfSight(from, to, wall)).toBe(false);
  });

  it("is NOT blocked by a non-opaque block (glass) between the points", () => {
    const glass: BlockQuery = (bx, _by, _bz) =>
      bx === 4 ? Blocks.GLASS : Blocks.AIR;
    const from: Vec3 = { x: 0.5, y: 65, z: 0.5 };
    const to: Vec3 = { x: 8.5, y: 65, z: 0.5 };
    expect(hasLineOfSight(from, to, glass)).toBe(true);
  });

  it("ignores an opaque block beyond the target", () => {
    const wallBehind: BlockQuery = (bx, _by, _bz) =>
      bx === 20 ? Blocks.STONE : Blocks.AIR;
    const from: Vec3 = { x: 0.5, y: 65, z: 0.5 };
    const to: Vec3 = { x: 8.5, y: 65, z: 0.5 };
    expect(hasLineOfSight(from, to, wallBehind)).toBe(true);
  });
});

describe("tickHostile — zombie chase", () => {
  it("enters chase and moves closer over ticks when player is in range + LOS", () => {
    const isSolid = flatFloor(64);
    // Player well within detection range (16) along +x.
    const { hooks } = makeHooks({ x: 10.5, y: 64, z: 0.5 });
    const zombie = new Mob(1, "zombie", { x: 0.5, y: 64, z: 0.5 });
    zombie.onGround = true;

    const startX = zombie.feet.x;
    for (let i = 0; i < 20; i++) {
      tickHostile(zombie, isSolid, ALL_AIR, true, 0, hooks, i);
    }

    expect(zombie.aiState === "chase" || zombie.aiState === "attack").toBe(true);
    // It advanced toward the player (greater x, but not past the player).
    expect(zombie.feet.x).toBeGreaterThan(startX);
    expect(zombie.feet.x).toBeLessThan(10.5);
  });

  it("damages the player when within attack range, gated by cooldown", () => {
    const isSolid = flatFloor(64);
    // Player adjacent (within zombie attackRange 1.6).
    const { hooks, hits } = makeHooks({ x: 1.5, y: 64, z: 0.5 });
    const zombie = new Mob(1, "zombie", { x: 0.5, y: 64, z: 0.5 });
    zombie.onGround = true;

    for (let i = 0; i < 60; i++) {
      tickHostile(zombie, isSolid, ALL_AIR, true, 0, hooks, i);
    }

    // At least one hit, each for zombie attackDamage (3 half-hearts).
    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const h of hits) expect(h).toBe(3);
    // Cooldown (~20 ticks) keeps hits well below one-per-tick.
    expect(hits.length).toBeLessThan(10);
  });

  it("does NOT chase when line-of-sight is blocked by an opaque wall", () => {
    const isSolid = flatFloor(64);
    // Opaque wall column at bx=5 fully between mob (x=0.5) and player (x=10.5).
    const wall: BlockQuery = (bx, _by, _bz) =>
      bx === 5 ? Blocks.STONE : Blocks.AIR;
    const { hooks } = makeHooks({ x: 10.5, y: 64, z: 0.5 });
    const zombie = new Mob(1, "zombie", { x: 0.5, y: 64, z: 0.5 });
    zombie.onGround = true;

    for (let i = 0; i < 10; i++) {
      tickHostile(zombie, isSolid, wall, true, 0, hooks, i);
    }

    expect(zombie.aiState).not.toBe("chase");
    expect(zombie.aiState).not.toBe("attack");
    // It did not march toward the wall/player.
    expect(zombie.feet.x).toBeCloseTo(0.5, 2);
  });

  it("does NOT chase when the player is out of detection range", () => {
    const isSolid = flatFloor(64);
    const { hooks } = makeHooks({ x: 100.5, y: 64, z: 0.5 }); // far away
    const zombie = new Mob(1, "zombie", { x: 0.5, y: 64, z: 0.5 });
    zombie.onGround = true;

    for (let i = 0; i < 5; i++) {
      tickHostile(zombie, isSolid, ALL_AIR, true, 0, hooks, i);
    }
    expect(zombie.aiState).not.toBe("chase");
    expect(zombie.feet.x).toBeCloseTo(0.5, 2);
  });
});

describe("tickHostile — skeleton ranged", () => {
  it("deals direct damage at long range on a cooldown (arrow entity omitted)", () => {
    const isSolid = flatFloor(64);
    // Player ~8 blocks away: within skeleton attackRange (12) but far for melee.
    const { hooks, hits } = makeHooks({ x: 8.5, y: 64, z: 0.5 });
    const skel = new Mob(1, "skeleton", { x: 0.5, y: 64, z: 0.5 });
    skel.onGround = true;

    for (let i = 0; i < 40; i++) {
      tickHostile(skel, isSolid, ALL_AIR, true, 0, hooks, i);
    }

    expect(hits.length).toBeGreaterThanOrEqual(1);
    for (const h of hits) expect(h).toBe(2); // skeleton attackDamage
  });
});

describe("tickHostile — creeper fuse", () => {
  it("fuses within 3 blocks and explodes when the fuse elapses", () => {
    const isSolid = flatFloor(64);
    // Player ~2 blocks away (within fuse range 3).
    const { hooks, hits } = makeHooks({ x: 2.4, y: 64, z: 0.5 });
    const creeper = new Mob(1, "creeper", { x: 0.5, y: 64, z: 0.5 });
    creeper.onGround = true;

    let exploded = false;
    for (let i = 0; i < CREEPER_FUSE_TICKS + 5; i++) {
      const r = tickHostile(creeper, isSolid, ALL_AIR, true, 0, hooks, i);
      if (i === 0) expect(creeper.aiState).toBe("fuse");
      if (r.explode === true) {
        exploded = true;
        break;
      }
    }

    expect(exploded).toBe(true);
    // Creepers never deal direct contact damage.
    expect(hits.length).toBe(0);
  });

  it("cancels the fuse when the player moves beyond 7 blocks", () => {
    const isSolid = flatFloor(64);
    const ctl = makeHooks({ x: 2.4, y: 64, z: 0.5 });
    const creeper = new Mob(1, "creeper", { x: 0.5, y: 64, z: 0.5 });
    creeper.onGround = true;

    // Prime the fuse.
    tickHostile(creeper, isSolid, ALL_AIR, true, 0, ctl.hooks, 0);
    expect(creeper.aiState).toBe("fuse");
    expect(creeper.fuseTimer).toBe(CREEPER_FUSE_TICKS);

    // Player bolts beyond cancel range (7).
    ctl.setPlayer({ x: 12.5, y: 64, z: 0.5 });
    const r = tickHostile(creeper, isSolid, ALL_AIR, true, 0, ctl.hooks, 1);

    expect(r.explode).toBeUndefined();
    expect(creeper.aiState).not.toBe("fuse");
    expect(creeper.fuseTimer).toBe(-1);
  });
});

describe("tickHostile — sun-burn", () => {
  it("reduces a zombie's HP during the day when fully sky-exposed (skylight 15)", () => {
    const isSolid = flatFloor(64);
    const { hooks } = makeHooks({ x: 100.5, y: 64, z: 0.5 }); // player irrelevant
    const zombie = new Mob(1, "zombie", { x: 0.5, y: 64, z: 0.5 });
    zombie.onGround = true;
    const startHp = zombie.health;

    // Day (night=false), skylight 15 → burns ~1/sec.
    for (let i = 0; i < 100; i++) {
      tickHostile(zombie, isSolid, ALL_AIR, false, 15, hooks, i);
    }
    expect(zombie.health).toBeLessThan(startHp);
  });

  it("does NOT burn at night", () => {
    const isSolid = flatFloor(64);
    const { hooks } = makeHooks({ x: 100.5, y: 64, z: 0.5 });
    const zombie = new Mob(1, "zombie", { x: 0.5, y: 64, z: 0.5 });
    zombie.onGround = true;
    const startHp = zombie.health;

    for (let i = 0; i < 100; i++) {
      tickHostile(zombie, isSolid, ALL_AIR, true, 15, hooks, i);
    }
    expect(zombie.health).toBe(startHp);
  });

  it("does NOT burn when not fully sky-exposed (skylight < 15)", () => {
    const isSolid = flatFloor(64);
    const { hooks } = makeHooks({ x: 100.5, y: 64, z: 0.5 });
    const zombie = new Mob(1, "zombie", { x: 0.5, y: 64, z: 0.5 });
    zombie.onGround = true;
    const startHp = zombie.health;

    for (let i = 0; i < 100; i++) {
      tickHostile(zombie, isSolid, ALL_AIR, false, 7, hooks, i);
    }
    expect(zombie.health).toBe(startHp);
  });

  it("does NOT burn a creeper (burnsInSun unset)", () => {
    const isSolid = flatFloor(64);
    const { hooks } = makeHooks({ x: 100.5, y: 64, z: 0.5 });
    const creeper = new Mob(1, "creeper", { x: 0.5, y: 64, z: 0.5 });
    creeper.onGround = true;
    const startHp = creeper.health;

    for (let i = 0; i < 100; i++) {
      tickHostile(creeper, isSolid, ALL_AIR, false, 15, hooks, i);
    }
    expect(creeper.health).toBe(startHp);
  });
});

describe("tickHostile — D5 step-up", () => {
  it("invokes tryStepUp (jumps) for a 1-block ledge between mob and player", () => {
    // Floor at 64, plus a single 1-block ledge at bx=2 (occupies y 64..65).
    const isSolid: SolidQuery = (bx, by, _bz) => {
      if (by < 64) return true; // floor
      if (bx === 2 && by === 64) return true; // 1-block ledge ahead
      return false;
    };
    const { hooks } = makeHooks({ x: 6.5, y: 65, z: 0.5 }); // player past the ledge
    const zombie = new Mob(1, "zombie", { x: 1.5, y: 64, z: 0.5 });
    zombie.onGround = true;

    // First aware tick: mob is grounded and facing a 1-block ledge → it should jump.
    tickHostile(zombie, isSolid, ALL_AIR, true, 0, hooks, 0);

    // Jump imparts upward velocity (then mobStep applies gravity once: 0.42*0.98-0.08).
    expect(zombie.velocity.y).toBeGreaterThan(0);
  });
});
