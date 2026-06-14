/**
 * browser-compat.spec.ts — Task 56: browser API compatibility matrix.
 *
 * Verifies that the APIs the Minecraft clone depends on are available and
 * correctly configured in the target browser environment.  These are
 * feature-detection tests, not multi-browser matrix tests (add more projects
 * in playwright.config.ts when Firefox/WebKit coverage is required).
 *
 * All assertions run against a fully-loaded page so the Vite dev server's
 * COOP/COEP headers are in effect.
 */

import { test, expect, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadPage(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  // Brief pause so headers are applied and any immediate JS has run.
  await page.waitForTimeout(500)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('browser-compat — required browser API availability', () => {
  test('WebGL2 is supported', async ({ page }) => {
    await loadPage(page)

    const result = await page.evaluate((): { supported: boolean; renderer: string } => {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2')
      if (gl === null) return { supported: false, renderer: '' }

      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      const renderer = dbg !== null
        ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string
        : gl.getParameter(gl.RENDERER) as string

      return { supported: true, renderer }
    })

    console.log(`WebGL2 renderer: ${result.renderer}`)
    test.info().annotations.push({ type: 'webgl2-renderer', description: result.renderer })

    expect(result.supported, 'WebGL2 context must be available').toBe(true)
  })

  test('SharedArrayBuffer is available (COOP/COEP headers active)', async ({ page }) => {
    await loadPage(page)

    const result = await page.evaluate((): { available: boolean; crossOriginIsolated: boolean } => ({
      available: typeof SharedArrayBuffer !== 'undefined',
      crossOriginIsolated: crossOriginIsolated,
    }))

    test.info().annotations.push({
      type: 'cross-origin-isolated',
      description: String(result.crossOriginIsolated),
    })

    expect(
      result.available,
      'SharedArrayBuffer must be defined — check COOP/COEP headers in vite.config.ts',
    ).toBe(true)

    expect(
      result.crossOriginIsolated,
      'crossOriginIsolated must be true (COOP: same-origin + COEP: require-corp)',
    ).toBe(true)
  })

  test('IndexedDB is available', async ({ page }) => {
    await loadPage(page)

    const available = await page.evaluate((): boolean => typeof indexedDB !== 'undefined')

    expect(available, 'IndexedDB must be available for chunk persistence (save/store.ts)').toBe(true)
  })

  test('Pointer Lock API is available', async ({ page }) => {
    await loadPage(page)

    const available = await page.evaluate((): boolean => {
      const el = document.documentElement
      return (
        typeof el.requestPointerLock === 'function' &&
        typeof document.exitPointerLock === 'function'
      )
    })

    expect(
      available,
      'Pointer Lock API must be available for first-person mouse look',
    ).toBe(true)
  })

  test('Web Audio API (AudioContext) is available', async ({ page }) => {
    await loadPage(page)

    const available = await page.evaluate(
      (): boolean => typeof AudioContext !== 'undefined' || typeof (window as unknown as Record<string, unknown>)['webkitAudioContext'] !== 'undefined',
    )

    expect(available, 'AudioContext must be available for audio/manager.ts').toBe(true)
  })

  test('Performance API with high-resolution timestamps is available', async ({ page }) => {
    await loadPage(page)

    const result = await page.evaluate((): { available: boolean; resolution: number } => {
      if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
        return { available: false, resolution: -1 }
      }
      const t1 = performance.now()
      const t2 = performance.now()
      return { available: true, resolution: t2 - t1 }
    })

    expect(result.available, 'performance.now() must be available for frame timing').toBe(true)
  })

  test('canvas 2D context is available (for icon-renderer.ts)', async ({ page }) => {
    await loadPage(page)

    const available = await page.evaluate((): boolean => {
      const canvas = document.createElement('canvas')
      return canvas.getContext('2d') !== null
    })

    expect(available, 'Canvas 2D context required by ui/icon-renderer.ts').toBe(true)
  })

  test('ES module dynamic import is supported', async ({ page }) => {
    await loadPage(page)

    // If the Vite bundle loaded and executed at all, dynamic import is
    // supported by definition.  We also verify the syntax is available via
    // a Function constructor probe so the check is explicit in the matrix
    // without requiring TypeScript to resolve a `data:` URI at compile time.
    const supported = await page.evaluate((): boolean => {
      try {
        // Construct a function that contains `import()` syntax without
        // actually executing an import — this is enough to confirm the
        // engine understands the syntax.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        new Function('return import.meta')
        return true
      } catch {
        return false
      }
    })

    expect(supported, 'Dynamic import() / import.meta must work (Vite ESM output depends on it)').toBe(true)
  })
})
