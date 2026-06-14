import { describe, it, expect } from "vitest";
import { MobManager } from "./manager";

describe("MobManager", () => {
  it("spawns mobs with auto-incrementing unique ids", () => {
    const mgr = new MobManager();
    const a = mgr.spawn("cow", { x: 0, y: 0, z: 0 });
    const b = mgr.spawn("pig", { x: 1, y: 0, z: 0 });
    expect(a.id).not.toBe(b.id);
    expect(mgr.get(a.id)).toBe(a);
    expect(mgr.get(b.id)).toBe(b);
    expect(mgr.count()).toBe(2);
  });

  it("places the mob at the requested position with the right type", () => {
    const mgr = new MobManager();
    const m = mgr.spawn("sheep", { x: 4, y: 5, z: 6 });
    expect(m.type).toBe("sheep");
    expect(m.feet).toEqual({ x: 4, y: 5, z: 6 });
  });

  it("despawns by id and reports whether something was removed", () => {
    const mgr = new MobManager();
    const m = mgr.spawn("cow", { x: 0, y: 0, z: 0 });
    expect(mgr.despawn(m.id)).toBe(true);
    expect(mgr.get(m.id)).toBeUndefined();
    expect(mgr.count()).toBe(0);
    expect(mgr.despawn(m.id)).toBe(false);
  });

  it("does not reuse ids after despawn", () => {
    const mgr = new MobManager();
    const a = mgr.spawn("cow", { x: 0, y: 0, z: 0 });
    mgr.despawn(a.id);
    const b = mgr.spawn("cow", { x: 0, y: 0, z: 0 });
    expect(b.id).not.toBe(a.id);
  });

  it("counts passive and hostile mobs separately", () => {
    const mgr = new MobManager();
    mgr.spawn("cow", { x: 0, y: 0, z: 0 });
    mgr.spawn("pig", { x: 0, y: 0, z: 0 });
    mgr.spawn("zombie", { x: 0, y: 0, z: 0 });
    expect(mgr.countPassive()).toBe(2);
    expect(mgr.countHostile()).toBe(1);
    expect(mgr.count()).toBe(3);
  });

  it("all() returns a snapshot of every live mob", () => {
    const mgr = new MobManager();
    const a = mgr.spawn("cow", { x: 0, y: 0, z: 0 });
    const b = mgr.spawn("creeper", { x: 0, y: 0, z: 0 });
    const all = mgr.all();
    expect(all).toHaveLength(2);
    expect(all).toContain(a);
    expect(all).toContain(b);
  });
});
