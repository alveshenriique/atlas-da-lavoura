// What the site answers besides the pages themselves, as Cloudflare serves it: the response
// headers of dist/_headers (security and cache), the 404 page, robots.txt, the sitemap, the
// noindex of the pages under construction and the link preview tags. The tests run against
// `wrangler dev` (playwright.config.ts), the same static-assets engine as production.
import AxeBuilder from "@axe-core/playwright";

import { DOCUMENT_HEADERS } from "../scripts/make-headers.mjs";
import { SITE_PAGES, SITEMAP_PATHS } from "../src/lib/site-pages";
import { expect, type Page, test } from "./test";

const PAGES = ["/", "/explorar/", "/municipios/", "/metodo/", "/municipio/5107925/"];
const SITE = "https://atlasdalavoura.com.br";

function directives(csp: string): Map<string, string> {
  return new Map(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d !== "")
      .map((d) => [d.split(" ")[0] ?? "", d] as const),
  );
}

async function dataBase(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.dataset.dataBase ?? "");
}

test.describe("response headers", () => {
  for (const path of PAGES) {
    test(`${path} carries the security headers and is always revalidated`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      const h = response.headers();
      const csp = directives(h["content-security-policy"] ?? "");
      // Scripts: the site's own files and the hashes of its inline scripts, nothing else.
      expect(csp.get("script-src")).toMatch(/^script-src 'self'( 'sha256-[A-Za-z0-9+/]+={0,2}')+$/);
      expect(csp.has("script-src-attr")).toBe(false);
      expect(h["content-security-policy"]).not.toContain("unsafe-eval");
      expect(csp.get("default-src")).toBe("default-src 'none'");
      expect(csp.get("style-src-attr")).toBe("style-src-attr 'unsafe-inline'");
      expect(csp.get("style-src-elem")).toMatch(/^style-src-elem 'self'( 'sha256-[A-Za-z0-9+/]+={0,2}')*$/);
      for (const d of ["img-src", "font-src", "connect-src"]) expect(csp.get(d)).toBe(`${d} 'self'`);
      expect(csp.get("frame-ancestors")).toBe("frame-ancestors 'none'");
      expect(csp.get("object-src")).toBe("object-src 'none'");
      expect(csp.get("base-uri")).toBe("base-uri 'none'");
      expect(h["strict-transport-security"]).toMatch(/^max-age=\d+; includeSubDomains$/);
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["permissions-policy"]).toContain("camera=()");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["cache-control"]).toBe("public, max-age=0, must-revalidate");
      expect(h["x-robots-tag"]).toBeUndefined();
    });
  }

  test("versioned data and hashed bundles are immutable, fonts are cached for a month, and none carries the document headers", async ({
    page,
    request,
  }) => {
    await page.goto("/explorar/");
    const base = await dataBase(page);
    const styles = await page.locator("link[rel='stylesheet'][href^='/_astro/']").first().getAttribute("href");
    const island = await page.locator("astro-island[component-url^='/_astro/']").first().getAttribute("component-url");
    const immutable = "public, max-age=31536000, immutable";
    const files = [`${base}catalog.json`, styles ?? "", island ?? ""];
    for (const path of files) expect((await request.get(path)).headers()["cache-control"], path).toBe(immutable);
    const font = "/fonts/AtlasDisplayNumber-Bold.woff";
    expect((await request.get(font)).headers()["cache-control"]).toBe("public, max-age=2592000");
    // HSTS and nosniff reach every file; the document policies (CSP and the others) only the
    // pages and the SVG files, which are documents when opened on their own.
    for (const path of [...files, font, "/favicon.ico", "/apple-touch-icon.png", "/og/atlas-da-lavoura.png"]) {
      const h = (await request.get(path)).headers();
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["strict-transport-security"], path).toMatch(/^max-age=\d+; includeSubDomains$/);
      for (const name of DOCUMENT_HEADERS) expect(h[name.toLowerCase()], `${path} ${name}`).toBeUndefined();
    }
    const svg = (await request.get("/favicon.svg")).headers();
    for (const name of DOCUMENT_HEADERS) expect(svg[name.toLowerCase()], `/favicon.svg ${name}`).toBeDefined();
  });

  test("the policy blocks an injected inline script and event handler", async ({ browser }) => {
    // A page of its own: the CSP guard of e2e/test.ts watches only the default page.
    const page = await browser.newPage();
    await page.goto("/");
    const blocked = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const seen: string[] = [];
          document.addEventListener("securitypolicyviolation", (e) => {
            seen.push(e.effectiveDirective);
            if (seen.length === 2) resolve(seen);
          });
          const script = document.createElement("script");
          script.textContent = "window.__injected = true;";
          document.body.append(script);
          const button = document.createElement("button");
          button.setAttribute("onclick", "window.__clicked = true;");
          document.body.append(button);
          button.click();
          setTimeout(() => resolve(seen), 2000);
        }),
    );
    expect(blocked.sort()).toEqual(["script-src-attr", "script-src-elem"]);
    expect(await page.evaluate(() => "__injected" in window || "__clicked" in window)).toBe(false);
    await page.close();
  });
});

test.describe("404, robots and sitemap", () => {
  test("an unknown address answers 404 with the site's own page and headers", async ({ page, request }) => {
    const response = await request.get("/nao-existe/");
    expect(response.status()).toBe(404);
    expect(response.headers()["content-security-policy"]).toContain("script-src 'self'");
    await page.goto("/nao-existe/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Este endereço não existe no Atlas da Lavoura");
    await expect(page).toHaveTitle("Página não encontrada · Atlas da Lavoura");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
  });

  test("robots.txt points at a sitemap of the finished pages only", async ({ request }) => {
    expect(await (await request.get("/robots.txt")).text()).toBe(
      `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
    );
    const sitemap = await (await request.get("/sitemap.xml")).text();
    const listed = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? "");
    // The finished pages with a single address, then the 27 state lists and every
    // municipality page of the index; the Método, still under construction, stays out.
    expect(SITEMAP_PATHS).toEqual(["/", "/explorar/", "/municipios/"]);
    const base = await (await request.get("/")).text().then((html) => /data-data-base="([^"]+)"/.exec(html)?.[1] ?? "");
    const index = (await (await request.get(`${base}municipalities.json`)).json()) as {
      municipalities: { municipality_id: number[] };
      states: { state_abbreviation: string[] };
    };
    const expected = [
      ...SITEMAP_PATHS,
      ...index.states.state_abbreviation.map((uf) => `/municipios/${uf.toLowerCase()}/`),
      ...index.municipalities.municipality_id.map((id) => `/municipio/${id}/`),
    ].map((path) => `${SITE}${path}`);
    expect(listed).toEqual(expected);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).not.toContain(`${SITE}/metodo/`);
  });

  test("pages under construction say so, carry noindex and keep their canonical", async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(path);
      const entry = SITE_PAGES.find((p) => (p.prefix ? path.startsWith(p.path) : p.path === path));
      const building = entry?.status === "under-construction";
      await expect(page.locator('meta[name="robots"]'), path).toHaveCount(building ? 1 : 0);
      await expect(page.getByRole("complementary", { name: "Página em construção" }), path).toHaveCount(
        building ? 1 : 0,
      );
      await expect(page.locator('link[rel="canonical"]'), path).toHaveAttribute("href", `${SITE}${path}`);
    }
  });

  test("link previews have a title, a description and an absolute 1200 × 630 image", async ({ page }) => {
    await page.goto("/");
    const og = async (property: string) =>
      page.locator(`meta[property="${property}"]`).getAttribute("content");
    expect(await og("og:title")).toBe("Análise · Atlas da Lavoura");
    expect(await og("og:description")).toBe(
      await page.locator('meta[name="description"]').getAttribute("content"),
    );
    expect(await og("og:image")).toBe(`${SITE}/og/atlas-da-lavoura.png`);
    expect([await og("og:image:width"), await og("og:image:height")]).toEqual(["1200", "630"]);
    expect(await page.locator('meta[name="twitter:card"]').getAttribute("content")).toBe("summary_large_image");
  });
});
