import { describe, it, expect } from "vitest";
import {
  DEFAULT_PREFS,
  clampPrefs,
  serializePrefs,
  parsePrefs,
  loadPrefs,
  savePrefs,
  type Prefs,
} from "./preferences";
// NOTE: ToneMappingMode and VALID_TONE_MAPPING_MODES are exported from preferences.ts
// but not imported here — the tests below use DEFAULT_PREFS / clampPrefs / parsePrefs
// directly, which is sufficient to exercise the tone-mapping behaviour.
import { MemoryStore } from "../save/store";

describe("clampPrefs", () => {
  it("returns defaults when given the defaults", () => {
    const result = clampPrefs({ ...DEFAULT_PREFS });
    expect(result).toEqual(DEFAULT_PREFS);
  });

  it("clamps renderDistance to [2..6]", () => {
    expect(clampPrefs({ ...DEFAULT_PREFS, renderDistance: 1 }).renderDistance).toBe(2);
    expect(clampPrefs({ ...DEFAULT_PREFS, renderDistance: 7 }).renderDistance).toBe(6);
    expect(clampPrefs({ ...DEFAULT_PREFS, renderDistance: 4 }).renderDistance).toBe(4);
  });

  it("rounds renderDistance to integer", () => {
    expect(clampPrefs({ ...DEFAULT_PREFS, renderDistance: 2.7 }).renderDistance).toBe(3);
  });

  it("clamps fov to [60..110]", () => {
    expect(clampPrefs({ ...DEFAULT_PREFS, fov: 30 }).fov).toBe(60);
    expect(clampPrefs({ ...DEFAULT_PREFS, fov: 200 }).fov).toBe(110);
    expect(clampPrefs({ ...DEFAULT_PREFS, fov: 90 }).fov).toBe(90);
  });

  it("clamps mouseSensitivity to [0.2..3]", () => {
    expect(clampPrefs({ ...DEFAULT_PREFS, mouseSensitivity: 0 }).mouseSensitivity).toBe(0.2);
    expect(clampPrefs({ ...DEFAULT_PREFS, mouseSensitivity: 5 }).mouseSensitivity).toBe(3);
    expect(clampPrefs({ ...DEFAULT_PREFS, mouseSensitivity: 1.5 }).mouseSensitivity).toBe(1.5);
  });

  it("clamps volumes to [0..1]", () => {
    expect(clampPrefs({ ...DEFAULT_PREFS, masterVolume: -0.1 }).masterVolume).toBe(0);
    expect(clampPrefs({ ...DEFAULT_PREFS, masterVolume: 2 }).masterVolume).toBe(1);
    expect(clampPrefs({ ...DEFAULT_PREFS, sfxVolume: -0.5 }).sfxVolume).toBe(0);
    expect(clampPrefs({ ...DEFAULT_PREFS, ambientVolume: 1.5 }).ambientVolume).toBe(1);
  });

  it("replaces NaN fields with defaults", () => {
    const result = clampPrefs({ ...DEFAULT_PREFS, fov: NaN, masterVolume: NaN });
    expect(result.fov).toBe(DEFAULT_PREFS.fov);
    expect(result.masterVolume).toBe(DEFAULT_PREFS.masterVolume);
  });
});

describe("serializePrefs / parsePrefs round-trip", () => {
  it("round-trips the defaults", () => {
    const bytes = serializePrefs(DEFAULT_PREFS);
    const back = parsePrefs(bytes);
    expect(back).toEqual(DEFAULT_PREFS);
  });

  it("round-trips custom values", () => {
    const p: Prefs = {
      ...DEFAULT_PREFS,
      renderDistance: 5,
      fov: 90,
      mouseSensitivity: 1.5,
      masterVolume: 0.8,
      sfxVolume: 0.6,
      ambientVolume: 0.4,
    };
    const bytes = serializePrefs(p);
    expect(parsePrefs(bytes)).toEqual(p);
  });

  it("produces non-zero bytes", () => {
    const bytes = serializePrefs(DEFAULT_PREFS);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

describe("parsePrefs tolerance", () => {
  it("returns DEFAULT_PREFS for empty bytes", () => {
    expect(parsePrefs(new Uint8Array(0))).toEqual(DEFAULT_PREFS);
  });

  it("returns DEFAULT_PREFS for garbage bytes", () => {
    const garbage = new Uint8Array([0xff, 0x00, 0xab, 0xcd]);
    expect(parsePrefs(garbage)).toEqual(DEFAULT_PREFS);
  });

  it("returns DEFAULT_PREFS for valid JSON that is not an object", () => {
    const bytes = new TextEncoder().encode("42");
    expect(parsePrefs(bytes)).toEqual(DEFAULT_PREFS);
  });

  it("fills missing fields with defaults", () => {
    const partial = new TextEncoder().encode(JSON.stringify({ fov: 100 }));
    const result = parsePrefs(partial);
    expect(result.fov).toBe(100);
    expect(result.renderDistance).toBe(DEFAULT_PREFS.renderDistance);
    expect(result.masterVolume).toBe(DEFAULT_PREFS.masterVolume);
  });
});

describe("loadPrefs / savePrefs (MemoryStore)", () => {
  it("returns DEFAULT_PREFS when nothing is stored", async () => {
    const store = new MemoryStore();
    const result = await loadPrefs(store);
    expect(result).toEqual(DEFAULT_PREFS);
  });

  it("round-trips via save then load", async () => {
    const store = new MemoryStore();
    const p: Prefs = { ...DEFAULT_PREFS, fov: 100, masterVolume: 0.5 };
    await savePrefs(store, p);
    const loaded = await loadPrefs(store);
    expect(loaded).toEqual(p);
  });
});

describe("preferences — toneMappingMode (Phase 6c)", () => {
  it("defaults to goldenHour", () => {
    expect(DEFAULT_PREFS.toneMappingMode).toBe("goldenHour");
  });

  it("clampPrefs keeps a valid mode and falls back on an unknown one", () => {
    const valid = clampPrefs({ ...DEFAULT_PREFS, toneMappingMode: "neutral" });
    expect(valid.toneMappingMode).toBe("neutral");
    const bogus = clampPrefs({
      ...DEFAULT_PREFS,
      toneMappingMode: "rainbow" as never,
    });
    expect(bogus.toneMappingMode).toBe("goldenHour");
  });

  it("round-trips through serialize/parse", () => {
    const p = clampPrefs({ ...DEFAULT_PREFS, toneMappingMode: "neutral" });
    const back = parsePrefs(serializePrefs(p));
    expect(back.toneMappingMode).toBe("neutral");
  });

  it("an old prefs blob without toneMappingMode defaults to goldenHour", () => {
    const legacy = { ...DEFAULT_PREFS } as Record<string, unknown>;
    delete legacy["toneMappingMode"];
    const bytes = new TextEncoder().encode(JSON.stringify(legacy));
    expect(parsePrefs(bytes).toneMappingMode).toBe("goldenHour");
  });
});

describe("pbrIntensity preference (Phase 6d)", () => {
  it("defaults to 0.5", () => {
    expect(DEFAULT_PREFS.pbrIntensity).toBe(0.5);
  });

  it("clamps out-of-range values to [0,1]", () => {
    expect(clampPrefs({ ...DEFAULT_PREFS, pbrIntensity: 5 }).pbrIntensity).toBe(1);
    expect(clampPrefs({ ...DEFAULT_PREFS, pbrIntensity: -2 }).pbrIntensity).toBe(0);
    expect(clampPrefs({ ...DEFAULT_PREFS, pbrIntensity: Number.NaN }).pbrIntensity).toBe(0.5);
  });

  it("round-trips through serialize/parse", () => {
    const p = clampPrefs({ ...DEFAULT_PREFS, pbrIntensity: 0.3 });
    const round = parsePrefs(serializePrefs(p));
    expect(round.pbrIntensity).toBeCloseTo(0.3, 10);
  });

  it("defaults a missing field from an old prefs blob", () => {
    const oldBlob = new TextEncoder().encode(JSON.stringify({ fov: 90 }));
    expect(parsePrefs(oldBlob).pbrIntensity).toBe(0.5);
  });
});
