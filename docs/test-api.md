# Test API (`window.__TEST__`)

The game exposes a test surface on `window.__TEST__` in development and test builds (`import.meta.env.DEV === true`). It is stripped from production bundles.

This API is the intended integration point for Playwright E2E tests and any browser-console assertions during development.

---

## Type Definitions

```typescript
interface TestApi {
  /** Resolves when the game has finished booting and is in a testable state. */
  ready(): Promise<void>

  /** Returns an opaque snapshot of current game state for assertions. */
  state(): unknown

  /** Sets the time-of-day tick. Valid range: [0, 23999]. */
  setTime(tod: number): void

  /**
   * Attempts to sleep. Returns a result object describing what happened.
   * Fails silently (returns wasNight: false) if sleep is not eligible.
   */
  trySleep(): TrySleepResult

  /** Audio subsystem test surface (present when audio is initialized). */
  audio?: TestAudioApi

  /** Effects subsystem test surface (present when effects are initialized). */
  effects?: TestEffectsApi
}

interface TrySleepResult {
  /** Whether it was night at the time of the call (sleep eligibility). */
  wasNight: boolean
  /** Tick-of-day before sleep was triggered. */
  todBefore: number
  /** Tick-of-day after sleep completed (should be 0 = dawn if wasNight). */
  todAfter: number
  /** Day number after sleep. */
  day: number
  /** Spawn point that was set by the bed (x, y, z). */
  spawn: { x: number; y: number; z: number }
}

interface TestAudioApi {
  /** Returns the current AudioContext state: "suspended" | "running" | "closed". */
  state(): string
  /** Plays a short test tone to verify the audio pipeline is working. */
  playTest(): void
}

interface TestEffectsApi {
  /** Spawns a block-break particle burst at the given world coordinates. */
  burstAt(x: number, y: number, z: number): void
  /** Returns the number of active (live) particles in the scene. */
  activeCount(): number
}
```

---

## Source Location

`src/test-api.ts` — exports a factory function called in `src/main.ts` during boot:

```typescript
// In main.ts (dev builds only):
if (import.meta.env.DEV) {
  window.__TEST__ = buildTestApi(game)
}
```

---

## Using from Playwright

### Basic setup

```typescript
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('http://localhost:5173')
  // Wait until the game signals readiness
  await page.evaluate(() => window.__TEST__.ready())
})
```

### Asserting game state

```typescript
test('initial day is 0', async ({ page }) => {
  const state = await page.evaluate(() => window.__TEST__.state())
  expect((state as any).day).toBe(0)
})
```

### Setting time of day

```typescript
test('sky is dark at midnight', async ({ page }) => {
  await page.evaluate(() => window.__TEST__.ready())
  // Midnight = tick 6000 (noon) + 6000 = tick 12000
  await page.evaluate(() => window.__TEST__.setTime(18000))
  // Assert sky color via DOM or canvas pixel sampling
})
```

### Testing the sleep mechanic

```typescript
test('sleep advances day counter', async ({ page }) => {
  await page.evaluate(() => window.__TEST__.ready())

  // Set time to night (after tick 12541)
  await page.evaluate(() => window.__TEST__.setTime(13000))

  const result = await page.evaluate(() => window.__TEST__.trySleep())

  expect(result.wasNight).toBe(true)
  expect(result.todAfter).toBe(0)   // woke up at dawn
  expect(result.day).toBe(1)        // day advanced
})

test('sleep is blocked during the day', async ({ page }) => {
  await page.evaluate(() => window.__TEST__.ready())

  // Set time to daytime
  await page.evaluate(() => window.__TEST__.setTime(6000))

  const result = await page.evaluate(() => window.__TEST__.trySleep())

  expect(result.wasNight).toBe(false)
  // todAfter and todBefore should be equal (clock did not advance)
  expect(result.todAfter).toBe(result.todBefore)
})
```

### Testing audio

```typescript
test('audio context starts suspended', async ({ page }) => {
  await page.evaluate(() => window.__TEST__.ready())
  const audioState = await page.evaluate(() => window.__TEST__.audio?.state())
  // Browser autoplay policy keeps audio suspended until user interaction
  expect(audioState).toBe('suspended')
})
```

### Testing particle effects

```typescript
test('block break emits particles', async ({ page }) => {
  await page.evaluate(() => window.__TEST__.ready())

  const before = await page.evaluate(() => window.__TEST__.effects?.activeCount() ?? 0)

  await page.evaluate(() => window.__TEST__.effects?.burstAt(8, 64, 8))

  const after = await page.evaluate(() => window.__TEST__.effects?.activeCount() ?? 0)
  expect(after).toBeGreaterThan(before)
})
```

---

## Playwright Config Example

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'corepack pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
})
```

---

## Notes

- `window.__TEST__` is `undefined` in production builds. Always guard with `typeof window.__TEST__ !== 'undefined'` if writing shared utilities.
- The `ready()` promise resolves after the first full render frame completes and all subsystems are initialized. Always await it before calling other methods.
- `state()` returns an untyped snapshot; its shape may change between waves. Cast carefully in tests or use specific accessor methods instead.
- `audio` and `effects` are optional because their subsystems initialize asynchronously after the first user gesture; check for `undefined` before calling.
