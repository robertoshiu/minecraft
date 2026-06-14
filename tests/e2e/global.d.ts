/**
 * global.d.ts — Ambient type declarations for window.__TEST__
 *
 * Mirrors the public surface of src/test-api.ts without importing it
 * directly (which would pull in Vite-specific types into the e2e tsconfig).
 */

interface TrySleepResult {
  wasNight: boolean
  todBefore: number
  todAfter: number
  day: number
  spawn: { x: number; y: number; z: number }
}

interface TestAudioApi {
  state(): string
  playTest(): void
}

interface TestEffectsApi {
  burstAt(x: number, y: number, z: number): void
  activeCount(): number
}

interface TestApi {
  ready(): Promise<void>
  state(): unknown
  setTime(tod: number): void
  trySleep(): TrySleepResult
  audio?: TestAudioApi
  effects?: TestEffectsApi
}

declare interface Window {
  __TEST__?: TestApi
}
