// robots.txt, written by robotsTxt (lib/site-pages.ts), which the check of the published
// site (scripts/verify-site.mjs) also uses.
import type { APIRoute } from "astro";

import { robotsTxt } from "../lib/site-pages";

export const GET: APIRoute = () =>
  new Response(robotsTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
