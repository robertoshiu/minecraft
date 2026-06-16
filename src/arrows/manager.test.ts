import { describe, it, expect } from "vitest";
import { ArrowManager, canFireArrow } from "./manager";
import { ARROW_CAP } from "../rules/mc-1.20";

describe("ArrowManager", () => {
  it("assigns monotonic ids that are never reused after despawn", () => {
    const m = new ArrowManager();
    const a = m.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    const b = m.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(b.id).toBe(a.id + 1);
    m.despawn(a.id);
    const c = m.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(c.id).toBe(b.id + 1);
  });
  it("all() is a snapshot; count() tracks size", () => {
    const m = new ArrowManager();
    m.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(m.count()).toBe(1);
    expect(m.all()).toHaveLength(1);
  });
});

describe("canFireArrow cap", () => {
  it("allows up to ARROW_CAP, denies at/over", () => {
    expect(canFireArrow(0)).toBe(true);
    expect(canFireArrow(ARROW_CAP - 1)).toBe(true);
    expect(canFireArrow(ARROW_CAP)).toBe(false);
  });
});
