/**
 * test-api.ts — exposes a small hook on `window.__TEST__` for end-to-end /
 * automated testing. Only installed in dev builds; tree-shaken / inert in prod.
 *
 * Later waves expand the surface of {@link TestApi}; for now it is a stub.
 */

/** Audio sub-probe exposed on window.__TEST__.audio for browser verification. */
export interface TestAudioApi {
  /** Returns the AudioContext state string (e.g. "suspended", "running", "closed"). */
  state(): string;
  /** Triggers a test break-stone sound at the player's current position. */
  playTest(): void;
}

/** Effects sub-probe exposed on window.__TEST__.effects for browser verification. */
export interface TestEffectsApi {
  /** Trigger a block-break particle burst at the given world coordinates. */
  burstAt(x: number, y: number, z: number): void;
  /** Returns the current estimated active particle count. */
  activeCount(): number;
}

/** Result returned by {@link TestApi.trySleep}. */
export interface TrySleepResult {
  /** True if it was night and sleep was executed. */
  wasNight: boolean;
  /** tick-of-day before the sleep attempt. */
  todBefore: number;
  /** tick-of-day after the sleep attempt (same as todBefore when wasNight is false). */
  todAfter: number;
  /** Day number after the sleep attempt. */
  day: number;
  /** The spawn point set after sleeping (player position when wasNight is false). */
  spawn: { x: number; y: number; z: number };
}

/** Render diagnostics snapshot exposed on window.__TEST__.renderDiag(). */
export interface RenderDiagSnapshot {
  /** Number of opaque chunk meshes currently in the scene. */
  opaqueMeshCount: number;
  /** Whether the opaque terrain material reports isReady(). */
  opaqueMaterialReady: boolean;
  /** Whether the transparent terrain material reports isReady(). */
  transparentMaterialReady: boolean;
  /** Whether the atlas texture reports isReady(). */
  atlasTextureReady: boolean;
}

export interface TestApi {
  /** Resolves once the app has reached a testable "ready" state. */
  ready(): Promise<void>;
  /** Returns an opaque snapshot of current game state for assertions. */
  state(): unknown;
  /**
   * Set the clock to the given tick-of-day within the current day (clamped
   * to [0, 23999]). Useful for inspecting shadow angles at dawn/dusk in a
   * browser without waiting for the full day cycle.
   */
  setTime(tod: number): void;
  /**
   * Attempt to sleep: if it is night, calls sleepToDawn and sets the spawn
   * to the player's current feet position. Returns a result object describing
   * what happened.
   */
  trySleep(): TrySleepResult;
  /** Audio sub-probe (present only when AudioContext is available). */
  audio?: TestAudioApi;
  /** Effects sub-probe (present only when ParticleManager is available). */
  effects?: TestEffectsApi;
  /**
   * Render diagnostics: opaque mesh count, material ready flags, atlas texture
   * ready flag. Use to verify the atlas pipeline on a real GPU without digging
   * into Babylon internals manually.
   */
  renderDiag?: () => RenderDiagSnapshot;
}

declare global {
  // eslint-disable-next-line no-var
  interface Window {
    __TEST__?: TestApi;
  }
}

/**
 * Installs the given test API onto `window.__TEST__`, but only when running a
 * dev build (`import.meta.env.DEV`). In production this is a no-op.
 */
export function installTestApi(api: TestApi): void {
  if (import.meta.env.DEV) {
    window.__TEST__ = api;
  }
}
