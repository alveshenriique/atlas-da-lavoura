// The sitemap lists only the finished pages (lib/site-pages.ts); a page enters it when its
// status changes to "ready", in the same change that removes its "em construção" notice.
import type { APIRoute } from "astro";

import { SITEMAP_PATHS } from "../lib/site-pages";

export const GET: APIRoute = ({ site }) => {
  const urls = SITEMAP_PATHS.map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
