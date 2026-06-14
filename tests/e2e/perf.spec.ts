/**
 * perf.spec.ts — Task 49: runtime performance audit.
 *
 * Measures FPS over a 10-second window after the game reaches its ready state,
 * then asserts a minimum average and logs detailed percentile data so CI
 * artefacts can track regressions over time.
 *
 * Threshold is intentionally relaxed (≥ 30 FPS) so it passes on
 * resource-constrained CI runners without a discrete GPU.
 */

import { test, expect, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FrameMetrics {
  avgFps: number
  minFps: number
  maxFps: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  sampleCount: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForTestApi(page: Page, timeoutMs = 45_000): Promise<void> {
  await page.waitForFunction(
    () => typeof window.__TEST__ !== 'undefined',
    { timeout: timeoutMs },
  )
  await page.evaluate(() => window.__TEST__!.ready())
}

/**
 * Injects a rAF-based frame counter into the page and collects frame-time
 * samples for `durationMs` milliseconds.  Returns the collected samples as
 * an array of per-frame durations in milliseconds.
 */
function collectFrameSamples(durationMs: number): Promise<number[]> {
  return new Promise<number[]>((resolve) => {
    const samples: number[] = []
    let lastTs = performance.now()

    function tick(ts: DOMHighResTimeStamp): void {
      const delta = ts - lastTs
      if (delta > 0) samples.push(delta)
      lastTs = ts

      if (ts - samples[0]! < durationMs || samples.length < 2) {
        requestAnimationFrame(tick)
      } else {
        resolve(samples)
      }
    }

    requestAnimationFrame(tick)
  })
}

function computeMetrics(frameTimes: number[]): FrameMetrics {
  if (frameTimes.length === 0) {
    return { avgFps: 0, minFps: 0, maxFps: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, sampleCount: 0 }
  }

  const sorted = [...frameTimes].sort((a, b) => a - b)
  const p = (pct: number): number => {
    const idx = Math.min(Math.floor((pct / 100) * sorted.length), sorted.length - 1)
    return sorted[idx]!
  }

  const avgFrameMs = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
  const minFrameMs = sorted[0]!
  const maxFrameMs = sorted[sorted.length - 1]!

  return {
    avgFps: 1000 / avgFrameMs,
    minFps: 1000 / maxFrameMs, // longest frame → lowest FPS
    maxFps: 1000 / minFrameMs, // shortest frame → highest FPS
    p50Ms: p(50),
    p95Ms: p(95),
    p99Ms: p(99),
    sampleCount: frameTimes.length,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('perf — frame-rate audit', () => {
  test.setTimeout(90_000) // world gen + 10 s measurement window + headroom

  test('average FPS over 10 s is ≥ 30 after game load', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForTestApi(page)

    // Let the world fully settle (chunks meshed, textures uploaded) before
    // starting the measurement window.
    await page.waitForTimeout(3_000)

    const frameTimes = await page.evaluate<number[], number>(
      collectFrameSamples,
      10_000,
    )

    const metrics = computeMetrics(frameTimes)

    // Emit structured output so CI log parsers / dashboards can extract it.
    console.log([
      '',
      '=== PERF REPORT ===',
      `  samples   : ${metrics.sampleCount}`,
      `  avg FPS   : ${metrics.avgFps.toFixed(1)}`,
      `  min FPS   : ${metrics.minFps.toFixed(1)}`,
      `  max FPS   : ${metrics.maxFps.toFixed(1)}`,
      `  p50 frame : ${metrics.p50Ms.toFixed(1)} ms`,
      `  p95 frame : ${metrics.p95Ms.toFixed(1)} ms`,
      `  p99 frame : ${metrics.p99Ms.toFixed(1)} ms`,
      '===================',
    ].join('\n'))

    // Attach as a test annotation so it appears in the HTML report.
    test.info().annotations.push({
      type: 'perf',
      description: JSON.stringify(metrics),
    })

    // Primary assertion — relaxed for headless CI runners.
    expect(
      metrics.avgFps,
      `Average FPS was ${metrics.avgFps.toFixed(1)}, expected ≥ 30. ` +
        `(p99 frame time: ${metrics.p99Ms.toFixed(1)} ms)`,
    ).toBeGreaterThanOrEqual(30)

    // Sanity: we must have collected at least 100 frames in 10 s.
    expect(metrics.sampleCount).toBeGreaterThan(100)
  })

  test('no single frame takes longer than 1000 ms (no hard freezes)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await waitForTestApi(page)
    await page.waitForTimeout(3_000)

    const frameTimes = await page.evaluate<number[], number>(
      collectFrameSamples,
      10_000,
    )

    const worstMs = Math.max(...frameTimes)

    test.info().annotations.push({
      type: 'perf-worst-frame',
      description: `${worstMs.toFixed(1)} ms`,
    })

    expect(
      worstMs,
      `Worst single frame was ${worstMs.toFixed(1)} ms — a hard freeze was detected`,
    ).toBeLessThan(1_000)
  })
})
