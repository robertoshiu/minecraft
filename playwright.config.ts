import { defineConfig } from '@playwright/test'

// Chromium browser is installed at:
//   C:\Users\quito\AppData\Local\ms-playwright\chromium-1223
// Installed via: npx playwright install chromium

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // Give each assertion up to 10 s before failing (world load can be slow).
  expect: { timeout: 10_000 },
  // Show one retry in CI to smooth over flaky WebGL init timing.
  retries: process.env['CI'] ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    // COOP/COEP headers are set by the Vite dev server; launch args below
    // are required so Chrome honours them in headless mode too.
    launchOptions: {
      args: [
        '--enable-features=SharedArrayBuffer',
        '--no-sandbox',
        '--disable-web-security=false',
      ],
    },
  },
  webServer: {
    command: 'corepack pnpm dev',
    port: 5173,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
})
