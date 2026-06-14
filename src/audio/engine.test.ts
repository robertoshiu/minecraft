/**
 * engine.test.ts — unit tests for AudioEngine using an injected mock
 * AudioContextLike. No DOM, no real AudioContext, no Web Audio.
 */
import { describe, it, expect, vi } from "vitest";
import { AudioEngine } from "./engine";
import type {
  AudioContextLike,
  AudioNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  AudioBufferSourceNodeLike,
  BiquadFilterNodeLike,
  AudioBufferLike,
} from "./engine";

// ---------------------------------------------------------------------------
// Graph-recording helpers
// ---------------------------------------------------------------------------

/**
 * A connection edge in the node graph: from → to.
 * Each `connect(dest)` call appends an entry here.
 */
interface Edge {
  from: AudioNodeLike;
  to: AudioNodeLike;
}

/**
 * Build a `connect` function that records edges into the shared `edges` array
 * and also calls the vi.fn() stub so existing call-count assertions still work.
 */
function makeConnectFn(
  self: AudioNodeLike,
  edges: Edge[],
): (dest: AudioNodeLike) => void {
  const stub = vi.fn().mockImplementation((dest: AudioNodeLike) => {
    edges.push({ from: self, to: dest });
  });
  // Return the same stub so callers can still inspect .mock.calls if needed.
  return stub as unknown as (dest: AudioNodeLike) => void;
}

/**
 * Walk the recorded edge graph (BFS) from `start` and return true if
 * `target` is reachable from it.
 */
function isReachable(
  start: AudioNodeLike,
  target: AudioNodeLike,
  edges: Edge[],
): boolean {
  const visited = new Set<AudioNodeLike>();
  const queue: AudioNodeLike[] = [start];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === target) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const edge of edges) {
      if (edge.from === node) queue.push(edge.to);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Mock node factory helpers
// ---------------------------------------------------------------------------

function mockAudioNode(edges: Edge[]): AudioNodeLike {
  const node: AudioNodeLike = { connect: vi.fn() };
  node.connect = makeConnectFn(node, edges) as AudioNodeLike["connect"];
  return node;
}

function mockGainNode(edges: Edge[]): GainNodeLike {
  const node: GainNodeLike = {
    connect: vi.fn(),
    gain: {
      value: 1,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    },
  };
  node.connect = makeConnectFn(node, edges) as GainNodeLike["connect"];
  return node;
}

function mockOscillatorNode(edges: Edge[]): OscillatorNodeLike {
  const node: OscillatorNodeLike = {
    connect: vi.fn(),
    type: "sine" as OscillatorType,
    frequency: { value: 440 },
    start: vi.fn(),
    stop: vi.fn(),
  };
  node.connect = makeConnectFn(node, edges) as OscillatorNodeLike["connect"];
  return node;
}

function mockBufferSource(edges: Edge[]): AudioBufferSourceNodeLike {
  const node: AudioBufferSourceNodeLike = {
    connect: vi.fn(),
    buffer: null,
    loop: false,
    playbackRate: { value: 1 },
    start: vi.fn(),
    stop: vi.fn(),
  };
  node.connect = makeConnectFn(node, edges) as AudioBufferSourceNodeLike["connect"];
  return node;
}

function mockBiquadFilter(edges: Edge[]): BiquadFilterNodeLike {
  const node: BiquadFilterNodeLike = {
    connect: vi.fn(),
    type: "lowpass" as BiquadFilterType,
    frequency: { value: 350 },
  };
  node.connect = makeConnectFn(node, edges) as BiquadFilterNodeLike["connect"];
  return node;
}

function mockAudioBuffer(sr: number, length: number): AudioBufferLike {
  const data = new Float32Array(length);
  return {
    sampleRate: sr,
    length,
    numberOfChannels: 1,
    getChannelData: () => data,
  };
}

// ---------------------------------------------------------------------------
// Mock AudioContext factory
// ---------------------------------------------------------------------------

interface MockCtx extends AudioContextLike {
  _gainNodes: GainNodeLike[];
  _oscillators: OscillatorNodeLike[];
  _bufferSources: AudioBufferSourceNodeLike[];
  _filters: BiquadFilterNodeLike[];
  _edges: Edge[];
  resumeCalled: number;
}

function makeMockCtx(state: AudioContextState = "suspended"): MockCtx {
  const edges: Edge[] = [];
  const destination = mockAudioNode(edges);

  const _gainNodes: GainNodeLike[] = [];
  const _oscillators: OscillatorNodeLike[] = [];
  const _bufferSources: AudioBufferSourceNodeLike[] = [];
  const _filters: BiquadFilterNodeLike[] = [];
  let resumeCalled = 0;

  const ctx: MockCtx = {
    currentTime: 0,
    sampleRate: 44100,
    get state() {
      return state;
    },
    destination,
    resume: vi.fn().mockImplementation(() => {
      resumeCalled++;
      return Promise.resolve();
    }),
    createGain: vi.fn().mockImplementation(() => {
      const n = mockGainNode(edges);
      _gainNodes.push(n);
      return n;
    }),
    createOscillator: vi.fn().mockImplementation(() => {
      const n = mockOscillatorNode(edges);
      _oscillators.push(n);
      return n;
    }),
    createBufferSource: vi.fn().mockImplementation(() => {
      const n = mockBufferSource(edges);
      _bufferSources.push(n);
      return n;
    }),
    createBiquadFilter: vi.fn().mockImplementation(() => {
      const n = mockBiquadFilter(edges);
      _filters.push(n);
      return n;
    }),
    createBuffer: vi.fn().mockImplementation(
      (_ch: number, length: number, sr: number) => mockAudioBuffer(sr, length),
    ),
    _gainNodes,
    _oscillators,
    _bufferSources,
    _filters,
    _edges: edges,
    get resumeCalled() {
      return resumeCalled;
    },
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AudioEngine construction", () => {
  it("creates master / sfx / ambient gain nodes and wires them to destination", () => {
    const ctx = makeMockCtx();
    new AudioEngine(() => ctx);

    // Exactly 3 gain nodes: master, sfx, ambient.
    expect(ctx._gainNodes.length).toBe(3);

    // sfxGain and ambientGain connect to masterGain; masterGain connects to destination.
    // Each gain node's connect should have been called at least once.
    const totalConnects = ctx._gainNodes.reduce(
      (sum, n) => sum + (n.connect as ReturnType<typeof vi.fn>).mock.calls.length,
      0,
    );
    expect(totalConnects).toBeGreaterThanOrEqual(3);
  });

  it("is safe when factory throws (headless/Node environment)", () => {
    expect(() => {
      new AudioEngine(() => {
        throw new Error("AudioContext not available");
      });
    }).not.toThrow();
  });
});

describe("AudioEngine.unlock", () => {
  it("calls ctx.resume()", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    engine.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — second unlock also calls resume (browser ignores if already running)", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    engine.unlock();
    engine.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when context is unavailable", () => {
    const engine = new AudioEngine(() => {
      throw new Error("no ctx");
    });
    expect(() => engine.unlock()).not.toThrow();
  });
});

describe("AudioEngine.setVolume", () => {
  it("sets sfx gain when category is 'sfx'", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    engine.setVolume("sfx", 0.5);
    // sfxGain is the second gain node created (after master).
    const sfxGain = ctx._gainNodes[1];
    expect(sfxGain?.gain.value).toBe(0.5);
  });

  it("sets ambient gain when category is 'ambient'", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    engine.setVolume("ambient", 0.3);
    const ambientGain = ctx._gainNodes[2];
    expect(ambientGain?.gain.value).toBe(0.3);
  });

  it("sets master gain when category is 'master'", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    engine.setVolume("master", 0.8);
    const masterGain = ctx._gainNodes[0];
    expect(masterGain?.gain.value).toBe(0.8);
  });

  it("clamps above 1 to 1", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    engine.setVolume("sfx", 2.5);
    const sfxGain = ctx._gainNodes[1];
    expect(sfxGain?.gain.value).toBe(1);
  });

  it("clamps below 0 to 0", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    engine.setVolume("sfx", -1);
    const sfxGain = ctx._gainNodes[1];
    expect(sfxGain?.gain.value).toBe(0);
  });
});

describe("AudioEngine.playSfx", () => {
  it("builds a node graph when playing a noise sound", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    // Reset tracking after construction.
    ctx._gainNodes.length = 0;
    ctx._bufferSources.length = 0;

    engine.playSfx("break_stone");

    // Should have created at least one buffer source (noise) and gain nodes.
    expect(ctx._bufferSources.length).toBeGreaterThanOrEqual(1);
    expect(ctx._gainNodes.length).toBeGreaterThanOrEqual(1);

    // The buffer source should have been started.
    const src = ctx._bufferSources[0];
    expect(src?.start).toHaveBeenCalled();
  });

  it("builds a node graph when playing a tone sound", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    ctx._oscillators.length = 0;

    engine.playSfx("mob_cow");

    expect(ctx._oscillators.length).toBeGreaterThanOrEqual(1);
    expect(ctx._oscillators[0]?.start).toHaveBeenCalled();
  });

  it("the node graph ends at sfxGain (sfxGain is connected to masterGain)", () => {
    const ctx = makeMockCtx();
    new AudioEngine(() => ctx);

    // sfxGain (index 1 among construction-time gains) must be connected to masterGain.
    const sfxGain = ctx._gainNodes[1];
    const connectCalls = (sfxGain?.connect as ReturnType<typeof vi.fn>).mock.calls;
    // sfxGain.connect(masterGain) was called during construction.
    expect(connectCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("a positioned sound produces a non-default pan node gain", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);

    // Update listener to origin, then place sound 30 blocks to the right.
    engine.updateListener({ x: 0, y: 0, z: 0 }, 0);

    // Reset tracking.
    ctx._gainNodes.length = 0;

    engine.playSfx("break_stone", {
      position: { x: 30, y: 0, z: 0 },
      rng: () => 0.5, // deterministic pitch jitter
    });

    // A spatial panGain node should have been created with gain < 1 (because
    // the sound is off to one side, |pan| > 0 → gain = 1 - |pan|*0.5 < 1).
    const panGains = ctx._gainNodes.filter((g) => g.gain.value < 1);
    expect(panGains.length).toBeGreaterThanOrEqual(1);
  });

  it("cooldown suppresses an immediately-repeated identical sound", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);

    // The ctx.currentTime is 0 for the mock; both calls happen at "the same time".
    ctx._bufferSources.length = 0;

    engine.playSfx("break_stone", { rng: () => 0.5 });
    engine.playSfx("break_stone", { rng: () => 0.5 }); // should be suppressed

    // Only one buffer source should have been scheduled.
    expect(ctx._bufferSources.length).toBe(1);
  });

  it("is a no-op for an unknown sound name", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    ctx._bufferSources.length = 0;
    expect(() => engine.playSfx("nonexistent_sound")).not.toThrow();
    expect(ctx._bufferSources.length).toBe(0);
  });

  it("is a no-op when context is unavailable", () => {
    const engine = new AudioEngine(() => {
      throw new Error("no ctx");
    });
    expect(() => engine.playSfx("break_stone")).not.toThrow();
  });
});

describe("AudioEngine signal-path connectivity (graph reachability)", () => {
  it("source → [filter →] envGain → panGain → sfxGain → masterGain → destination for filtered sound (break_stone)", () => {
    // break_stone: kind="noise", filterHz=800 — exercises the BiquadFilter path.
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);

    // Clear source tracking after construction (construction adds gain nodes).
    ctx._bufferSources.length = 0;
    ctx._filters.length = 0;

    engine.playSfx("break_stone", { rng: () => 0.5 });

    const edges = ctx._edges;
    const destination = ctx.destination;

    // There must be at least one buffer source and one filter created.
    expect(ctx._bufferSources.length).toBeGreaterThanOrEqual(1);
    expect(ctx._filters.length).toBeGreaterThanOrEqual(1);

    // Every source node must have a connected path to the context destination.
    for (const src of ctx._bufferSources) {
      expect(
        isReachable(src, destination, edges),
        `buffer source is not connected to destination`,
      ).toBe(true);
    }

    // The filter itself must also reach destination (not a dead end).
    for (const filter of ctx._filters) {
      expect(
        isReachable(filter, destination, edges),
        `filter node is not connected to destination (dead-end filter bug)`,
      ).toBe(true);
    }
  });

  it("source → envGain → panGain → sfxGain → masterGain → destination for unfiltered tone (mob_cow)", () => {
    // mob_cow: kind="tone", no filterHz — exercises the no-filter path.
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);

    ctx._oscillators.length = 0;
    ctx._filters.length = 0;

    engine.playSfx("mob_cow", { rng: () => 0.5 });

    const edges = ctx._edges;
    const destination = ctx.destination;

    expect(ctx._oscillators.length).toBeGreaterThanOrEqual(1);
    // No filter should have been created for an unfiltered sound.
    expect(ctx._filters.length).toBe(0);

    for (const osc of ctx._oscillators) {
      expect(
        isReachable(osc, destination, edges),
        `oscillator is not connected to destination`,
      ).toBe(true);
    }
  });

  it("both noise and tone sources reach destination for a mixed filtered sound (break_wood)", () => {
    // break_wood: kind="mixed", filterHz=1200 — both noise and oscillator go through filter.
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);

    ctx._bufferSources.length = 0;
    ctx._oscillators.length = 0;
    ctx._filters.length = 0;

    engine.playSfx("break_wood", { rng: () => 0.5 });

    const edges = ctx._edges;
    const destination = ctx.destination;

    expect(ctx._bufferSources.length).toBeGreaterThanOrEqual(1);
    expect(ctx._oscillators.length).toBeGreaterThanOrEqual(1);
    expect(ctx._filters.length).toBeGreaterThanOrEqual(1);

    for (const src of ctx._bufferSources) {
      expect(isReachable(src, destination, edges), `noise source not connected`).toBe(true);
    }
    for (const osc of ctx._oscillators) {
      expect(isReachable(osc, destination, edges), `oscillator not connected`).toBe(true);
    }
    for (const filter of ctx._filters) {
      expect(isReachable(filter, destination, edges), `filter not connected`).toBe(true);
    }
  });
});

describe("AudioEngine.state", () => {
  it("returns the live AudioContext state when context is available", () => {
    const ctx = makeMockCtx("suspended");
    const engine = new AudioEngine(() => ctx);
    expect(engine.state()).toBe("suspended");
  });

  it("returns 'unavailable' when no AudioContext could be created", () => {
    const engine = new AudioEngine(() => {
      throw new Error("no ctx");
    });
    expect(engine.state()).toBe("unavailable");
  });
});

describe("AudioEngine.startAmbient / stopAmbient", () => {
  it("creates a looping buffer source for ambient_wind", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    ctx._bufferSources.length = 0;

    engine.startAmbient("ambient_wind");

    expect(ctx._bufferSources.length).toBeGreaterThanOrEqual(1);
    const src = ctx._bufferSources[0];
    expect(src?.loop).toBe(true);
    expect(src?.start).toHaveBeenCalled();
  });

  it("does not restart if the same ambient is already running", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    ctx._bufferSources.length = 0;

    engine.startAmbient("ambient_wind");
    const firstCount = ctx._bufferSources.length;
    engine.startAmbient("ambient_wind"); // same name → no-op
    expect(ctx._bufferSources.length).toBe(firstCount);
  });

  it("stopAmbient stops the running ambient source", () => {
    const ctx = makeMockCtx();
    const engine = new AudioEngine(() => ctx);
    ctx._bufferSources.length = 0;

    engine.startAmbient("ambient_wind");
    const src = ctx._bufferSources[0];

    engine.stopAmbient();
    expect(src?.stop).toHaveBeenCalled();
  });
});
