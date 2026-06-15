/**
 * engine.ts — Web Audio synthesis engine.
 *
 * Renders every sound procedurally (oscillators + noise + biquad filters +
 * gain envelopes) — no .ogg assets. Real audio files can be swapped in later
 * by replacing the `renderSfx` path with a buffer-source loader while keeping
 * the same public API.
 *
 * The engine is fully guarded: construction is safe in a headless/Node
 * environment (no AudioContext available), and every public method is a no-op
 * when the context could not be created.
 *
 * Testability: the real `AudioContext` is never referenced directly. Instead,
 * the constructor accepts a factory `() => AudioContextLike`, which a mock can
 * satisfy. Tests inject a fake that records the node graph without needing DOM.
 */

import { SFX, type SfxSpec } from "./specs";
import { distanceAttenuation, stereoPan, type Vec3 } from "./spatial";

// ---------------------------------------------------------------------------
// AudioContext-like interface
// ---------------------------------------------------------------------------

/** Minimal interface that both the real AudioContext and test mocks satisfy. */
export interface AudioNodeLike {
  connect(destination: AudioNodeLike): void;
}

export interface GainNodeLike extends AudioNodeLike {
  gain: { value: number; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void };
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType;
  frequency: {
    value: number;
    setValueAtTime?(value: number, startTime: number): void;
    linearRampToValueAtTime?(value: number, endTime: number): void;
    setValueCurveAtTime?(values: Float32Array, startTime: number, duration: number): void;
  };
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  playbackRate: { value: number };
  start(when?: number): void;
  stop(when?: number): void;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType;
  frequency: { value: number };
}

export interface AudioBufferLike {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * A brick-wall limiter/compressor node. Each property has a `.value` field
 * so both the real DynamicsCompressorNode and the test mock satisfy this
 * interface without requiring a specific AudioContext implementation.
 */
export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  threshold: { value: number };
  knee: { value: number };
  ratio: { value: number };
  attack: { value: number };
  release: { value: number };
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: AudioContextState;
  readonly destination: AudioNodeLike;
  resume(): Promise<void>;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createDynamicsCompressor(): DynamicsCompressorNodeLike;
}

// ---------------------------------------------------------------------------
// Tiny deterministic RNG (xorshift32) — used for per-sound pitch variation
// when no external rng is injected. No wall-clock, no global state leakage.
// ---------------------------------------------------------------------------

function makeXorshift(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = 0xdeadbeef;
  return (): number => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s = s >>> 0;
    return s / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Volume categories
// ---------------------------------------------------------------------------

type VolumeCategory = "master" | "sfx" | "ambient";

// ---------------------------------------------------------------------------
// AudioEngine
// ---------------------------------------------------------------------------

/**
 * Central audio system.
 *
 * Graph layout:
 *   [sfx nodes]     → sfxGain   → masterGain → limiter → destination
 *   [ambient nodes] → ambientGain → masterGain → limiter → destination
 *
 * The brick-wall limiter (DynamicsCompressorNode: threshold=-6 dBFS, ratio=20)
 * prevents hard-clipping when multiple voices sum past ±1.0. masterGain is set
 * to 0.7 headroom so a full-volume user preference still leaves 30% headroom
 * before the limiter engages.
 */
export class AudioEngine {
  private readonly ctx: AudioContextLike | null;
  private readonly masterGain: GainNodeLike | null;
  private readonly sfxGain: GainNodeLike | null;
  private readonly ambientGain: GainNodeLike | null;
  private readonly limiter: DynamicsCompressorNodeLike | null;

  /** Stored listener position + yaw for spatial calculations. */
  private listenerPos: Vec3 = { x: 0, y: 0, z: 0 };
  private listenerYaw = 0;

  /** Per-name cooldown: last wall-clock ms at which the sound was played. */
  private readonly lastPlayed = new Map<string, number>();

  /** Minimum time between two identical SFX to prevent clipping (ms). */
  private static readonly COOLDOWN_MS = 50;

  /** The currently-looping ambient source (if any). */
  private ambientSource: AudioBufferSourceNodeLike | null = null;
  private ambientName: string | null = null;

  /** Internal deterministic rng for pitch variation. */
  private readonly rng = makeXorshift(0x4a3f2b1c);

  /**
   * @param make  Optional factory; defaults to `() => new AudioContext()`.
   *              Pass a mock in tests.
   */
  constructor(make?: () => AudioContextLike) {
    try {
      const factory = make ?? (() => new AudioContext() as AudioContextLike);
      this.ctx = factory();
      this.masterGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.ambientGain = this.ctx.createGain();

      // FIX D: 0.7 headroom (instead of 1.0) so overlapping voices don't
      // sum to hard-clip before the limiter engages.
      this.masterGain.gain.value = 0.7;
      this.sfxGain.gain.value = 1;
      this.ambientGain.gain.value = 1;

      // FIX D: brick-wall limiter inserted between masterGain and destination.
      // threshold=-6 dBFS: starts limiting only in loud passages.
      // knee=0: hard knee for brick-wall behavior.
      // ratio=20: near-infinite gain reduction (limiter, not compressor).
      // attack=0.003 s: fast enough to catch transients without pumping.
      // release=0.1 s: short enough to not muddy sustained audio.
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      this.limiter = limiter;

      this.sfxGain.connect(this.masterGain);
      this.ambientGain.connect(this.masterGain);
      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
    } catch {
      // AudioContext unavailable (headless, Node, or browser policy).
      this.ctx = null;
      this.masterGain = null;
      this.sfxGain = null;
      this.ambientGain = null;
      this.limiter = null;
    }
  }

  /**
   * Resume the AudioContext — must be called from a user gesture (click/key).
   * Idempotent; safe to call before any sound is played.
   */
  unlock(): void {
    if (this.ctx === null) return;
    void this.ctx.resume();
  }

  /**
   * Return the live AudioContext state ("suspended" | "running" | "closed"),
   * or "unavailable" when no AudioContext could be created.
   */
  state(): string {
    if (this.ctx === null) return "unavailable";
    return this.ctx.state;
  }

  /**
   * Set the volume for a category. Value is clamped to [0, 1].
   */
  setVolume(cat: VolumeCategory, v01: number): void {
    const clamped = Math.max(0, Math.min(1, v01));
    const node =
      cat === "master"
        ? this.masterGain
        : cat === "sfx"
          ? this.sfxGain
          : this.ambientGain;
    if (node === null) return;
    node.gain.value = clamped;
  }

  /**
   * Update the listener position + yaw (call every frame from the camera).
   */
  updateListener(pos: Vec3, yaw: number): void {
    this.listenerPos = pos;
    this.listenerYaw = yaw;
  }

  /**
   * Play a named sound effect.
   *
   * @param name  Key in {@link SFX}.
   * @param opts  Optional per-call overrides.
   */
  playSfx(
    name: string,
    opts?: {
      /** World-space position for spatial attenuation + panning. */
      position?: Vec3;
      /** Pitch multiplier (1 = normal). */
      pitch?: number;
      /** RNG for pitch jitter; default: internal deterministic generator. */
      rng?: () => number;
    },
  ): void {
    if (this.ctx === null || this.sfxGain === null) return;

    const spec = SFX[name];
    if (spec === undefined) return;

    // Cooldown: suppress if played too recently.
    const now = this.ctx.currentTime * 1000; // seconds → ms approximation
    const last = this.lastPlayed.get(name);
    if (last !== undefined && now - last < AudioEngine.COOLDOWN_MS) return;
    this.lastPlayed.set(name, now);

    const rngFn = opts?.rng ?? this.rng;

    // Spatial: compute per-sound gain + pan from position, if provided.
    let spatialGain = 1;
    let pan = 0;
    if (opts?.position !== undefined) {
      const d = Math.hypot(
        opts.position.x - this.listenerPos.x,
        opts.position.y - this.listenerPos.y,
        opts.position.z - this.listenerPos.z,
      );
      spatialGain = distanceAttenuation(d);
      pan = stereoPan(this.listenerPos, this.listenerYaw, opts.position);
    }

    if (spatialGain <= 0) return; // fully attenuated; skip synthesis

    this.renderSfx(spec, name, spatialGain, pan, opts?.pitch ?? 1, rngFn);
  }

  /**
   * Start a looping ambient sound, stopping any previously-running one.
   */
  startAmbient(name: string): void {
    if (this.ctx === null || this.ambientGain === null) return;
    if (this.ambientName === name) return; // already playing this one

    this.stopAmbient();

    const spec = SFX[name];
    if (spec === undefined) return;

    const src = this.buildNoiseSource(spec, 1);
    if (src === null) return;

    src.loop = true;
    src.connect(this.ambientGain);
    src.start(this.ctx.currentTime);
    this.ambientSource = src;
    this.ambientName = name;
  }

  /**
   * Stop the currently-running ambient sound.
   */
  stopAmbient(): void {
    if (this.ambientSource !== null) {
      try {
        this.ambientSource.stop(this.ctx?.currentTime ?? 0);
      } catch {
        // Already stopped — safe to ignore.
      }
      this.ambientSource = null;
      this.ambientName = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal synthesis helpers
  // ---------------------------------------------------------------------------

  /**
   * Synthesize and schedule a sound effect into the node graph.
   *
   * Signal path:
   *   [oscillator?]   ─┐
   *                    ├─→ filterNode? → sourceGain → panGain → sfxGain → master
   *   [noiseSource?]  ─┘
   */
  private renderSfx(
    spec: SfxSpec,
    _name: string,
    spatialGain: number,
    pan: number,
    pitch: number,
    rng: () => number,
  ): void {
    const ctx = this.ctx;
    const sfxGain = this.sfxGain;
    if (ctx === null || sfxGain === null) return;

    const peakGain = (spec.gain ?? 1) * spatialGain;
    const durationSec = spec.durationMs / 1000;
    const attackSec = (spec.attackMs ?? 5) / 1000;
    const releaseSec = (spec.releaseMs ?? spec.durationMs * 0.2) / 1000;
    const now = ctx.currentTime;

    // Slight random pitch variation: ±5% around 1 using injected rng.
    const pitchJitter = 0.95 + rng() * 0.1;
    const finalPitch = pitch * pitchJitter;

    // --- Envelope gain node ------------------------------------------------
    const envGain = ctx.createGain();
    envGain.gain.setValueAtTime(0, now);
    envGain.gain.linearRampToValueAtTime(peakGain, now + attackSec);
    const sustainEnd = Math.max(now + attackSec, now + durationSec - releaseSec);
    envGain.gain.setValueAtTime(peakGain, sustainEnd);
    envGain.gain.linearRampToValueAtTime(0, now + durationSec);

    // --- Pan/spatial gain node ---------------------------------------------
    const panGain = ctx.createGain();
    // Encode stereo pan as a gain reduction on the louder side to approximate
    // a panner. Left-biased (pan < 0) reduces right contribution; since we
    // have a single mono chain, we simply scale gain by (1 - |pan| * 0.5).
    panGain.gain.value = 1 - Math.abs(pan) * 0.5;

    // Connect envelope → pan → sfxGain.
    envGain.connect(panGain);
    panGain.connect(sfxGain);

    // --- Filter (optional) -------------------------------------------------
    let filterOutput: AudioNodeLike = envGain;
    if (spec.filterHz !== undefined) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = spec.filterHz;
      // Insert filter before the envelope gain so envelope still shapes it.
      // Actual chain: source → filter → envGain → panGain → sfxGain
      filter.connect(envGain);
      filterOutput = filter;
    }

    // --- Build source nodes ------------------------------------------------
    // FIX D (mixed kind): for sounds with both noise AND oscillator sources,
    // each source goes through a small per-source gain of 0.5 before the shared
    // envGain so two summed sources don't reach ~2× peak amplitude.
    const isMixed = spec.kind === "mixed";

    if (spec.kind === "noise" || isMixed) {
      const noiseSrc = this.buildNoiseSource(spec, finalPitch);
      if (noiseSrc !== null) {
        if (isMixed) {
          // Route through a 0.5 per-source gain to halve the contribution.
          const noiseGain = ctx.createGain();
          noiseGain.gain.value = 0.5;
          noiseSrc.connect(noiseGain);
          noiseGain.connect(filterOutput);
        } else {
          noiseSrc.connect(filterOutput);
        }
        noiseSrc.start(now);
        noiseSrc.stop(now + durationSec);
      }
    }

    if (spec.kind === "tone" || isMixed) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      const baseFreq = (spec.freqHz ?? 440) * finalPitch;
      const endFreq = (spec.freqEndHz ?? spec.freqHz ?? 440) * finalPitch;
      if (
        (spec.freqEndHz !== undefined || spec.vibratoHz !== undefined) &&
        typeof osc.frequency.setValueCurveAtTime === "function"
      ) {
        // Build a pitch contour curve: linear glide from baseFreq to endFreq
        // plus optional vibrato modulation.
        const N = 64;
        const curve = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          const t = i / (N - 1); // 0..1 over duration
          const glide = baseFreq + (endFreq - baseFreq) * t;
          const vibrato =
            (spec.vibratoDepth ?? 0) *
            finalPitch *
            Math.sin(2 * Math.PI * (spec.vibratoHz ?? 0) * t * durationSec);
          curve[i] = Math.max(1, glide + vibrato);
        }
        osc.frequency.setValueCurveAtTime(curve, now, durationSec);
      } else {
        osc.frequency.value = baseFreq;
      }
      if (isMixed) {
        // Route through a 0.5 per-source gain to halve the contribution.
        const oscGain = ctx.createGain();
        oscGain.gain.value = 0.5;
        osc.connect(oscGain);
        oscGain.connect(filterOutput);
      } else {
        osc.connect(filterOutput);
      }
      osc.start(now);
      osc.stop(now + durationSec);
    }
  }

  /**
   * Build a buffer-source node filled with white noise at the spec's duration.
   * Returns null if the context is unavailable.
   */
  private buildNoiseSource(
    spec: SfxSpec,
    pitch: number,
  ): AudioBufferSourceNodeLike | null {
    const ctx = this.ctx;
    if (ctx === null) return null;

    const sr = ctx.sampleRate > 0 ? ctx.sampleRate : 44100;
    const durationSec = spec.durationMs / 1000;
    // Clamp to a minimum of 1 sample to avoid a zero-length buffer.
    const frameCount = Math.max(1, Math.ceil(sr * durationSec));

    const buffer = ctx.createBuffer(1, frameCount, sr);
    const data = buffer.getChannelData(0);
    // Deterministic pseudo-random noise (simple xorshift per buffer).
    let ns = 0x5a3f2b1c;
    for (let i = 0; i < frameCount; i++) {
      ns ^= ns << 13;
      ns ^= ns >>> 17;
      ns ^= ns << 5;
      ns = ns >>> 0;
      data[i] = (ns / 0x80000000 - 1) * 0.5; // range ≈ [-0.5, 0.5]
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = Math.max(0.01, pitch);
    return src;
  }
}
