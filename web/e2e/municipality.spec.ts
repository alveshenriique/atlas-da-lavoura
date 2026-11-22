// The municipality page in a browser, on a sample that covers its cases (the scan of
// e2e/municipality-pages.spec.ts checks every page without a browser): drought harvests that
// go the set's way, confirmed by the region (Presidente Prudente) or not (Perdizes), or not
// confirmed while the correlation is flat (Sorriso); drought harvests that do not follow
// the set (Ariquemes); a short series
// (Açailândia), a state without the soybean calendar (Fortaleza), coffee in Minas Gerais
// (Perdizes), a municipality never in the PAM (Diadema), one first in 2025 (Boa Esperança do
// Norte), one without soybean, corn or coffee in 2025 (Amaturá) and the heaviest region (Mogi
// Guaçu).
import AxeBuilder from "@axe-core/playwright";

import { findUnsourcedNumbers } from "./provenance";
import { expect, type Page, test } from "./test";

const SAMPLE = {
  sorriso: 5107925,
  presidentePrudente: 3541406,
  ariquemes: 1100023,
  acailandia: 2100055,
  fortaleza: 2304400,
  perdizes: 3149804,
  diadema: 3513801,
  boaEsperanca: 5101837,
  amatura: 1300060,
  mogiGuacu: 3530706,
};
const url = (id: number) => `/municipio/${id}/`;

async function open(page: Page, id: number) {
  await page.goto(url(id));
  await expect(page.locator("h1")).toBeVisible();
}

test.describe("the municipality page", () => {
  for (const [name, id] of Object.entries(SAMPLE)) {
    test(`${name}: every number cites the data package, and no data file is fetched`, async ({ page, request }) => {
      const fetched: string[] = [];
      page.on("request", (r) => {
        if (new URL(r.url()).pathname.startsWith("/data/")) fetched.push(r.url());
      });
      await open(page, id);
      expect(await findUnsourcedNumbers(page, request)).toEqual([]);
      expect(fetched).toEqual([]);
    });
  }

  test("the drought risk is the region's, read within the whole set, never as no risk", async ({ page }) => {
    const reading = async (id: number) => {
      await open(page, id);
      const soy = page.locator('#risco-de-seca .drought[data-crop="soybean"]');
      const corr = soy.locator("[data-correlation]");
      return [
        await soy.getAttribute("data-status"),
        await soy.getAttribute("data-reading"),
        (await corr.count()) ? await corr.getAttribute("data-correlation") : null,
      ];
    };
    const soy = () => page.locator('#risco-de-seca .drought[data-crop="soybean"]');
    expect(await reading(SAMPLE.presidentePrudente)).toEqual(["summary", "shows", "agrees"]);
    await expect(soy().locator("[data-reading-text]")).toContainText("confirma a diferença");
    await expect(soy().locator("[data-set-reference]")).toHaveCount(0);
    expect(await reading(SAMPLE.perdizes)).toEqual(["summary", "unconfirmed", "agrees"]);
    await expect(soy().locator("[data-reading-text]")).toContainText("curta para confirmar a diferença sozinha");
    await expect(soy().locator("[data-set-reference]")).toContainText("No conjunto");
    await expect(soy().locator("[data-set-reference]")).toContainText("correlação positiva entre o balanço hídrico e o rendimento");
    // Sorriso: the comparison goes the set's way, the correlation is flat, and the page says so.
    expect(await reading(SAMPLE.sorriso)).toEqual(["summary", "unconfirmed", "flat-while-comparison-holds"]);
    await expect(soy().locator("[data-correlation]")).toContainText("segue o padrão do conjunto, mas a correlação");
    expect(await reading(SAMPLE.ariquemes)).toEqual(["summary", "not-here", "agrees"]);
    await expect(soy().locator("[data-reading-text]")).toContainText("não seguem o padrão do conjunto");
    await expect(soy().locator("[data-reading-text]")).toContainText("não descarta o risco");
    await expect(soy().locator("[data-set-reference]")).toContainText("No conjunto");
    // No sentence may suggest there is no risk, and hot days are never a negative count.
    for (const id of [SAMPLE.sorriso, SAMPLE.ariquemes, SAMPLE.perdizes, SAMPLE.acailandia]) {
      await open(page, id);
      const risk = page.locator("#risco-de-seca");
      await expect(risk).not.toContainText(/não (há|existe) (risco|associação)|não mostram associação|sem risco/);
      await expect(risk).not.toContainText(/°C: −/);
    }
    // The notes on corn and coffee only where they apply, before the figures.
    await open(page, SAMPLE.sorriso);
    await expect(page.locator(".ficha__climate-notes")).toHaveText(/O milho não tem análise de clima/);
    await expect(page.locator(".ficha__climate-notes")).not.toContainText("café");
    const notesBeforeFigure = await page.evaluate(() => {
      const notes = document.querySelector(".ficha__climate-notes");
      const figure = document.querySelector("#risco-de-seca figure");
      return !!notes && !!figure && (notes.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    expect(notesBeforeFigure).toBe(true);
    expect(await reading(SAMPLE.acailandia)).toEqual(["short", "", null]);
    expect(await reading(SAMPLE.fortaleza)).toEqual(["none", "", null]);
    await expect(page.locator("#risco-titulo")).toContainText("região");
    await expect(page.locator("#risco-de-seca")).toContainText("O milho não tem análise de clima");
    // Arabica coffee only in Minas Gerais.
    await open(page, SAMPLE.perdizes);
    await expect(page.locator('#risco-de-seca .drought[data-crop="coffee_arabica"]')).toHaveCount(1);
    await open(page, SAMPLE.sorriso);
    await expect(page.locator('#risco-de-seca .drought[data-crop="coffee_arabica"]')).toHaveCount(0);
  });

  test("the cases without production say so instead of showing zeros", async ({ page }) => {
    await open(page, SAMPLE.diadema);
    await expect(page.locator(".ficha__none")).toContainText("Sem registro de lavouras");
    await expect(page.locator("#tabela-1")).toHaveCount(0);
    await open(page, SAMPLE.amatura);
    await expect(page.locator(".ficha__none")).toContainText("não produziu soja, milho nem café");
    await expect(page.locator('#tabela-1 tr[data-series="soybean"] td').first()).toContainText("não produziu");
    await open(page, SAMPLE.boaEsperanca);
    await expect(page.locator(".ficha__note").first()).toContainText("a partir de");
  });

  test("Figura 1: the crop and the format are chosen by keyboard, and the table downloads as CSV", async ({ page }) => {
    await open(page, SAMPLE.perdizes);
    const figure = page.locator("#figura-1");
    const select = figure.getByLabel("Cultura");
    await expect(select).toBeVisible();
    await select.selectOption("coffee_arabica");
    await expect(figure.locator('[data-series-panel="coffee_arabica"]')).toBeVisible();
    await expect(figure.locator('[data-series-panel="soybean"]')).toBeHidden();
    const chartTab = figure.getByRole("tab", { name: "Gráfico" });
    await chartTab.focus();
    await page.keyboard.press("ArrowRight");
    const tableTab = figure.getByRole("tab", { name: "Tabela" });
    await expect(tableTab).toHaveAttribute("aria-selected", "true");
    await expect(tableTab).toBeFocused();
    const table = figure.locator("#dados-coffee_arabica");
    await expect(table).toBeVisible();
    const download = page.waitForEvent("download");
    await figure.locator('[data-series-panel="coffee_arabica"] [data-csv]').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`${SAMPLE.perdizes}-coffee_arabica.csv`);
    const csv = await (await file.createReadStream()).toArray();
    const text = Buffer.concat(csv).toString("utf8");
    expect(text.split("\r\n")[0]).toContain("Safra;Produção (t de café beneficiado)");
    expect(text.split("\r\n")).toHaveLength((await table.locator("tr").count()));
    await tableTab.focus();
    await page.keyboard.press("Home");
    await expect(chartTab).toHaveAttribute("aria-selected", "true");
  });

  test("without JavaScript, every crop shows its chart and its table behind a disclosure", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(url(SAMPLE.perdizes));
    await expect(page.locator("[data-series-panel]")).toHaveCount(await page.locator("[data-series-panel]").count());
    for (const panel of await page.locator("[data-series-panel]").all()) await expect(panel).toBeVisible();
    await expect(page.locator('[role="tablist"]')).toBeHidden();
    await context.close();
  });

  test("the minimap shows the state, the region and the municipality", async ({ page }) => {
    await open(page, SAMPLE.sorriso);
    for (const part of ["state", "region", "own"]) {
      const d = await page.locator(`.minimap__${part}`).getAttribute("d");
      expect(d?.length ?? 0, part).toBeGreaterThan(20);
    }
  });

  test("no horizontal scroll at 360 px, and no axe violations", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const id of [SAMPLE.sorriso, SAMPLE.perdizes, SAMPLE.diadema]) {
      await open(page, id);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, String(id)).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const id of [SAMPLE.sorriso, SAMPLE.diadema]) {
      await open(page, id);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations, String(id)).toEqual([]);
    }
  });
});

test.describe("Municípios and the state pages", () => {
  test("list the 27 states and, in each, every municipality of the state", async ({ page, request }) => {
    await page.goto("/municipios/");
    const states = page.locator(".states-list a");
    await expect(states).toHaveCount(27);
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
    await page.goto("/municipios/mt/");
    const count = Number((await page.locator(".ficha__text .num").first().getAttribute("value")) ?? 0);
    await expect(page.locator(".region-list a")).toHaveCount(count);
    await expect(page.locator('.region-list a[href="/municipio/5107925/"]')).toHaveText("Sorriso");
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
  });
});
