// robots.txt: every crawler may read the whole site; the pages still under construction say
// noindex in their own HTML (lib/site-pages.ts). Points at the sitemap of finished pages.
import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL("/sitemap.xml", site).href}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
