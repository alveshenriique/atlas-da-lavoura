import { defineConfig, devices } from "@playwright/test";

// npm run og-image: builds the site with the internal /og/ page (ATLAS_OG=1) into .og-build/,
// renders it at 1200 × 630 in the light theme, checks the provenance of every number and
// saves public/og/atlas-da-lavoura.png (e2e-og/og-image.spec.ts). Run again after each data
// release; tests/og-image.test.ts fails while the image is from an older data version.
export default defineConfig({
  testDir: "./e2e-og",
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4329",
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  webServer: {
    command: "ATLAS_OG=1 npx astro build --outDir .og-build && npx http-server .og-build -a 127.0.0.1 -p 4329 -s",
    url: "http://127.0.0.1:4329/og/atlas-da-lavoura/",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
