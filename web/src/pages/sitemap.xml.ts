// The sitemap lists only the finished pages (lib/site-pages.ts): the pages with a single
// address, and every page under a finished prefix (the 27 state lists and the 5,571
// municipality pages, from the municipality index of the data package). A page enters it
// when its status changes to "ready", in the same change that removes its "em construção"
// notice.
import type { APIRoute } from "astro";

import { loadDataFile } from "../lib/data";
import { pageStatus, SITEMAP_PATHS } from "../lib/site-pages";
import type { MunicipalitiesJson } from "../types/data/municipalities";

export function sitemapPaths(): string[] {
  const { municipalities, states } = loadDataFile<MunicipalitiesJson>("municipalities.json");
  const stateLists = states.state_abbreviation.map((uf) => `/municipios/${uf.toLowerCase()}/`);
  const profiles = municipalities.municipality_id.map((id) => `/municipio/${id}/`);
  return [...SITEMAP_PATHS, ...[...stateLists, ...profiles].filter((path) => pageStatus(path) === "ready")];
}

export const GET: APIRoute = ({ site }) => {
  const urls = sitemapPaths().map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
