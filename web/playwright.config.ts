import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the production build in dist/, served by `wrangler dev` with
// the headers of dist/_headers (Content-Security-Policy and the rest), as Cloudflare serves it
// in production; every test runs twice, once per colour scheme, so both themes stay
// accessible. e2e/test.ts fails any test with a Content-Security-Policy violation.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  // Must stay below the e2e step's timeout-minutes in site.yml (10), so Playwright stops the
  // run (and still reports) before GitHub kills the step. At least twice the slowest CI run
  // (135 s on 2026-11-18); the suite grows at every stage (docs/DECISOES.md).
  globalTimeout: process.env.CI ? 8 * 60_000 : 0,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: "http://127.0.0.1:4321",
  },
  webServer: {
    // The same static-assets engine as production (404 page, trailing slashes, _headers).
    // Not `astro preview`: in Astro 7 it forks a background daemon and the foreground
    // process exits, which Playwright treats as the server dying.
    command: "npx wrangler dev --port 4321 --ip 127.0.0.1",
    env: { WRANGLER_SEND_METRICS: "false" },
    url: "http://127.0.0.1:4321",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "light",
      use: { ...devices["Desktop Chrome"], colorScheme: "light" },
    },
    {
      name: "dark",
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
  ],
});
