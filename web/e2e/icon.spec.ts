// The site icon (scripts/make_web_icons.py, from identity.py): every page links the three
// files, they are served with their types and cache, and the SVG, opened under the site's
// Content-Security-Policy (the guard in ./test fails on any violation), draws the variant of
// the browser's theme and its small version at 16 px.
import { CACHE } from "../scripts/make-headers.mjs";
import { tokens } from "../src/lib/tokens";
import { expect, test } from "./test";

const PAGES = ["/", "/explorar/", "/municipios/", "/metodo/", "/municipio/5107925/", "/nao-existe/"];

test("every page links the icon: SVG, the ICO fallback and the iOS icon", async ({ request }) => {
  for (const path of PAGES) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(html, path).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32">');
    expect(html, path).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
  }
  for (const [path, type] of [
    ["/favicon.svg", "image/svg+xml"],
    ["/favicon.ico", "image/"],
    ["/apple-touch-icon.png", "image/png"],
  ] as const) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toContain(type);
    expect(response.headers()["cache-control"], path).toBe(CACHE.images);
  }
});

test("the SVG draws under the site's policy, in the variant of the browser's theme", async ({ page }) => {
  const fill = (selector: string) =>
    page.locator(selector).first().evaluate((el) => getComputedStyle(el).fill);
  const rgb = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
  };
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/favicon.svg");
  await expect.poll(() => fill(".g")).toBe(rgb(tokens.themes.light.text));
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => fill(".g")).toBe(rgb(tokens.themes.dark.text));
  // The drought bar keeps the same colour in both variants (identity.ICON).
  expect(await fill(".d")).toBe(rgb(tokens.themes.dark.dry));
});

test("the SVG switches to its small version at 16 px", async ({ page }) => {
  await page.setViewportSize({ width: 16, height: 16 });
  await page.goto("/favicon.svg");
  const shown = (selector: string) => page.locator(selector).evaluate((el) => getComputedStyle(el).display);
  expect(await shown(".L")).toBe("none");
  expect(await shown(".S")).not.toBe("none");
  await page.setViewportSize({ width: 64, height: 64 });
  expect(await shown(".L")).not.toBe("none");
  expect(await shown(".S")).toBe("none");
});
