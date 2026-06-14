import { describe, it, expect } from "vitest";
import { MemoryStore, atomicWrite, safeRead } from "./store";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array | null): string | null =>
  b === null ? null : new TextDecoder().decode(b);

describe("MemoryStore", () => {
  it("put/get/delete/keys behave like a key→bytes store", async () => {
    const store = new MemoryStore();
    expect(await store.get("missing")).toBeNull();

    await store.put("a", enc("alpha"));
    await store.put("b", enc("beta"));
    expect(dec(await store.get("a"))).toBe("alpha");
    expect((await store.keys()).sort()).toEqual(["a", "b"]);

    await store.delete("a");
    expect(await store.get("a")).toBeNull();
    expect(await store.keys()).toEqual(["b"]);
  });

  it("defensively copies on put and get (no aliasing)", async () => {
    const store = new MemoryStore();
    const src = enc("xyz");
    await store.put("k", src);
    src[0] = 0; // mutate the source after storing
    const got = await store.get("k");
    expect(dec(got)).toBe("xyz"); // store unaffected

    if (got !== null) got[0] = 0; // mutate the retrieved copy
    expect(dec(await store.get("k"))).toBe("xyz"); // store still unaffected
  });
});

describe("atomicWrite + safeRead (U3: .tmp -> .bak -> final -> delete)", () => {
  it("writes v1 then v2; safeRead returns v2 and .bak holds v1", async () => {
    const store = new MemoryStore();

    await atomicWrite(store, "world", enc("v1"));
    expect(dec(await safeRead(store, "world"))).toBe("v1");
    // First write: no prior value existed, so no .bak yet.
    expect(await store.get("world.bak")).toBeNull();

    await atomicWrite(store, "world", enc("v2"));
    expect(dec(await safeRead(store, "world"))).toBe("v2");
    // Second write preserved the previous good value (v1) as the backup.
    expect(dec(await store.get("world.bak"))).toBe("v1");
  });

  it("cleans up the .tmp key after a successful write", async () => {
    const store = new MemoryStore();
    await atomicWrite(store, "world", enc("hello"));
    expect(await store.get("world.tmp")).toBeNull();
  });

  it("recovers from a simulated crash: deleting the final key falls back to .bak", async () => {
    const store = new MemoryStore();
    await atomicWrite(store, "world", enc("v1"));
    await atomicWrite(store, "world", enc("v2"));

    // Simulate a torn write that lost the canonical key (.bak still has v1).
    await store.delete("world");
    expect(await store.get("world")).toBeNull();

    expect(dec(await safeRead(store, "world"))).toBe("v1");
  });

  it("safeRead returns null when neither the key nor its .bak exist", async () => {
    const store = new MemoryStore();
    expect(await safeRead(store, "nope")).toBeNull();
  });

  it("safeRead falls back to .bak when the primary exists but is empty", async () => {
    const store = new MemoryStore();
    await store.put("world.bak", enc("backup"));
    await store.put("world", new Uint8Array(0)); // empty/torn primary
    expect(dec(await safeRead(store, "world"))).toBe("backup");
  });

  it("performs the dance in order: at the moment of the final put, .tmp and .bak both exist", async () => {
    // A recording store that logs the operation sequence.
    const ops: string[] = [];
    const backing = new MemoryStore();
    const recorder = {
      put: (k: string, v: Uint8Array): Promise<void> => {
        ops.push(`put ${k}`);
        return backing.put(k, v);
      },
      get: (k: string): Promise<Uint8Array | null> => {
        ops.push(`get ${k}`);
        return backing.get(k);
      },
      delete: (k: string): Promise<void> => {
        ops.push(`delete ${k}`);
        return backing.delete(k);
      },
      keys: (): Promise<string[]> => backing.keys(),
    };

    await atomicWrite(recorder, "world", enc("v1")); // no prior -> no .bak copy
    await atomicWrite(recorder, "world", enc("v2"));

    // The second write must: put .tmp, copy old -> .bak, put final, delete .tmp.
    const second = ops.slice(ops.indexOf("put world.tmp", 1));
    expect(second).toEqual([
      "put world.tmp",
      "get world",
      "put world.bak",
      "put world",
      "delete world.tmp",
    ]);
  });
});
