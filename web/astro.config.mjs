// @ts-check
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

import { SITE_URL } from "./src/lib/site-pages.ts";

// Static site served by a CDN; every page prerenders at build time and React runs only
// inside islands. The data files come from public/data/, filled by `npm run setup`.
export default defineConfig({
  site: SITE_URL,
  integrations: [react()],
});
