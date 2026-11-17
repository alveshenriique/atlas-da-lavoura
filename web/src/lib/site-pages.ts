// The pages of the site and whether each one is finished. An unfinished page shows an honest
// "em construção" notice (components/UnderConstruction.astro), carries noindex and stays out
// of the sitemap until it is finished: search engines and link previews should find the
// finished pages first. Read by the layout (robots meta), the sitemap and the tests.
export type PageStatus = "ready" | "under-construction";

interface SitePage {
  path: string;
  /** True when the entry covers every page under the path (one page per municipality). */
  prefix: boolean;
  status: PageStatus;
}

export const SITE_PAGES: readonly SitePage[] = [
  { path: "/", prefix: false, status: "ready" },
  { path: "/explorar/", prefix: false, status: "ready" },
  { path: "/municipios/", prefix: false, status: "under-construction" },
  { path: "/municipio/", prefix: true, status: "under-construction" },
  { path: "/metodo/", prefix: false, status: "under-construction" },
];

/** The status of the page at a path, or null for a path that is not a page (the 404). */
export function pageStatus(pathname: string): PageStatus | null {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  const page = SITE_PAGES.find((p) => (p.prefix ? path.startsWith(p.path) && path !== p.path : path === p.path));
  return page?.status ?? null;
}

/** The finished pages, the only ones the sitemap lists. */
export const SITEMAP_PATHS = SITE_PAGES.filter((p) => p.status === "ready" && !p.prefix).map((p) => p.path);

/** The dbt documentation of the data models (GitHub Pages, with the project's domain). */
export const DBT_DOCS_URL = "https://docs.atlasdalavoura.com.br/";

/** The link preview image (scripts/make-og-image.mjs) and its description. */
export const OG_IMAGE = {
  path: "/og/atlas-da-lavoura.png",
  width: 1200,
  height: 630,
  alt: "Gráfico do Atlas da Lavoura: rendimento da soja abaixo da tendência nos anos de seca na floração, no Rio Grande do Sul.",
};
