import { describe, it, expect } from "vitest";
import {
  Blocks,
  PHYSICS,
  TIME,
  ORE_TABLE,
  TOOL_DURABILITY,
} from "./mc-1.20";

describe("mc-1.20 rules (single source of truth)", () => {
  it("encodes core block ids", () => {
    expect(Blocks.AIR).toBe(0);
    expect(Blocks.STONE).toBe(1);
  });

  it("encodes core physics + time constants", () => {
    expect(PHYSICS.JUMP_VEL).toBe(0.42);
    expect(TIME.TICKS_PER_DAY).toBe(24000);
  });

  it("has 6 ore entries with diamond best depth at y=4", () => {
    expect(ORE_TABLE).toHaveLength(6);
    const diamond = ORE_TABLE.find((o) => o.block === Blocks.DIAMOND_ORE);
    expect(diamond?.bestY).toBe(4);
  });

  it("encodes tool durability", () => {
    expect(TOOL_DURABILITY.diamond).toBe(1561);
  });
});
