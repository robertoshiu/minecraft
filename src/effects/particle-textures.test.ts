/**
 * particle-textures.test.ts — tests for the pure generateDotRGBA function.
 *
 * No Babylon imports here; only the pure pixel-generation function is tested.
 * The Babylon createParticleTexture binding is covered in particles.test.ts
 * under NullEngine.
 */
import { describe, it, expect } from "vitest";
import { generateDotRGBA } from "./particle-textures";

describe("generateDotRGBA", () => {
  it("returns a Uint8Array of length size*size*4 for size=16", () => {
    const data = generateDotRGBA(16);
    expect(data.length).toBe(16 * 16 * 4);
  });

  it("returns a Uint8Array of length size*size*4 for size=8", () => {
    const data = generateDotRGBA(8);
    expect(data.length).toBe(8 * 8 * 4);
  });

  it("all RGB channels are 255 (white dot)", () => {
    const data = generateDotRGBA(16);
    let allWhite = true;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) {
        allWhite = false;
        break;
      }
    }
    expect(allWhite).toBe(true);
  });

  it("centre texel has high alpha (near 255) for size=16", () => {
    const data = generateDotRGBA(16);
    // Centre pixel is at (7, 7) for a 0-indexed 16x16 grid
    // (row=7, col=7 → index = 7*16+7 = 119, alpha at 119*4+3)
    const centreAlpha = data[119 * 4 + 3];
    expect(centreAlpha).toBeGreaterThan(200);
  });

  it("corner texel (0,0) has alpha near 0", () => {
    const data = generateDotRGBA(16);
    // Top-left corner: row=0, col=0 → index 0, alpha at offset 3
    const cornerAlpha = data[3];
    expect(cornerAlpha).toBeLessThan(30);
  });

  it("corner texel (15,15) has alpha near 0", () => {
    const data = generateDotRGBA(16);
    // Bottom-right corner: row=15, col=15 → index 255, alpha at 255*4+3 = 1023
    const cornerAlpha = data[1023];
    expect(cornerAlpha).toBeLessThan(30);
  });

  it("is deterministic — two calls with same size return identical data", () => {
    const a = generateDotRGBA(16);
    const b = generateDotRGBA(16);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("works for size=4 (small power-of-two)", () => {
    const data = generateDotRGBA(4);
    expect(data.length).toBe(4 * 4 * 4);
  });
});
