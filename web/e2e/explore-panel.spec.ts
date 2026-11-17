// The Explorar, part B: the side panel (the territory in focus, its series, the states
// ranked) and the area × yield decomposition. Every test runs under the light and the dark
// colour scheme. Values are checked against the files of the data package, read here as the
// browser reads them.
import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "./test";

import { format } from "../src/lib/format";
import { findUnsourcedNumbers } from "./provenance";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const map = (page: Page) => page.locator(".explore__map");
const ready = (page: Page) => expect(map(page)).toHaveAttribute("data-ready", "true");
const panel = (page: Page) => page.locator(".explore-panel");
const filter = (page: Page, name: "Cultura" | "Medida" | "Ano") =>
  page.getByRole("heading", { level: 1 }).getByRole("combobox", { name });
const rows = (page: Page) => panel(page).locator(".ranking__row");

interface Matrix {
  years: number[];
  country_total: (number | null)[];
}
interface Place {
  series: Record<string, { years: number[]; production_t: (number | null)[]; harvested_area_ha: (number | null)[] }>;
}

async function load<T>(page: Page, request: APIRequestContext, file: string): Promise<T> {
  const base = await page.evaluate(() => document.documentElement.dataset.dataBase ?? "");
  return (await (await request.get(`${base}${file}`)).json()) as T;
}

test.describe("the side panel", () => {
  test("opens on Brazil, with the ranking already in the page and nothing more to download", async ({
    page,
    request,
  }) => {
    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));
    await page.goto("/explorar/");
    await ready(page);
    await expect(panel(page).locator(".explore-panel__kicker")).toHaveText(/^Brasil\s+·\s+2025$/);
    const matrix = await load<Matrix>(page, request, "explore/soybean/production_t.json");
    const total = matrix.country_total[matrix.years.indexOf(2025)] ?? 0;
    await expect(panel(page).locator(".explore-panel__number .num")).toHaveText(format(total, "compact"));
    await expect(rows(page).first()).toContainText("Mato Grosso");
    await expect(rows(page).locator(":visible")).not.toHaveCount(0);
    await page.waitForTimeout(500);
    expect(requested.filter((p) => p.includes("/places/"))).toEqual([]);
    expect(requested.some((p) => p.endsWith("/analysis.json"))).toBe(false);
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
  });

  test("follows the series, the measure and the year of the map", async ({ page, request }) => {
    await page.goto("/explorar/");
    await ready(page);
    await filter(page, "Cultura").selectOption({ label: "milho" });
    await filter(page, "Medida").selectOption({ label: "em hectares colhidos" });
    await filter(page, "Ano").selectOption("2000");
    await ready(page);
    await expect(panel(page).locator(".explore-panel__kicker")).toHaveText(/^Brasil\s+·\s+2000$/);
    const matrix = await load<Matrix>(page, request, "explore/corn/harvested_area_ha.json");
    const total = matrix.country_total[matrix.years.indexOf(2000)] ?? 0;
    await expect(panel(page).locator(".explore-panel__number .num")).toHaveText(format(total, "compact"));
    // The ranking comes from the state files: the first state is the largest of them.
    const states = (await load<{ states: { state_abbreviation: string[]; state_name: string[] } }>(
      page,
      request,
      "municipalities.json",
    )).states;
    const values = await Promise.all(
      states.state_abbreviation.map(async (uf, i) => {
        const place = await load<Place>(page, request, `places/state/${uf}.json`);
        const s = place.series.corn;
        return { name: states.state_name[i] ?? uf, value: s?.harvested_area_ha[s.years.indexOf(2000)] ?? 0 };
      }),
    );
    const top = values.sort((a, b) => b.value - a.value)[0];
    await expect(rows(page).first().locator(".ranking__name")).toHaveText(top?.name ?? "");
    await expect(panel(page).locator(".ranking__caption")).toHaveText(
      "Área colhida, em ha, e participação no Brasil",
    );
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
  });

  test("moves its year marker with the timeline while playing", async ({ page }) => {
    await page.goto("/explorar/?serie=soja&ano=2018");
    await ready(page);
    await page.getByRole("button", { name: "Reproduzir a linha do tempo" }).click();
    await expect(panel(page).locator(".explore-panel__kicker")).toHaveText(/·\s+2019$/);
    await page.getByRole("button", { name: "Pausar a linha do tempo" }).click();
    const marker = await panel(page).locator(".series-chart__year").getAttribute("x1");
    expect(Number(marker)).toBeGreaterThan(0);
  });

  test("gives the yield of Brazil and of a state as production over area, sum over sum", async ({
    page,
    request,
  }) => {
    await page.goto("/explorar/?serie=soja&medida=rendimento&ano=2025");
    await ready(page);
    const [production, area] = await Promise.all([
      load<Matrix>(page, request, "explore/soybean/production_t.json"),
      load<Matrix>(page, request, "explore/soybean/harvested_area_ha.json"),
    ]);
    const col = production.years.indexOf(2025);
    const brazil = ((production.country_total[col] ?? 0) / (area.country_total[col] ?? 1)) * 1000;
    await expect(panel(page).locator(".explore-panel__number .num")).toHaveText(format(brazil, "int"));

    await panel(page).getByRole("button", { name: "Mostrar todas as UFs" }).click();
    await rows(page).filter({ hasText: "Paraná" }).getByRole("button").click();
    await ready(page);
    const pr = await load<Place>(page, request, "places/state/PR.json");
    const s = pr.series.soybean;
    const i = s?.years.indexOf(2025) ?? -1;
    const state = ((s?.production_t[i] ?? 0) / (s?.harvested_area_ha[i] ?? 1)) * 1000;
    await expect(panel(page).locator(".explore-panel__kicker")).toHaveText(/^Paraná\s+·\s+2025$/);
    await expect(panel(page).locator(".explore-panel__number .num")).toHaveText(format(state, "int"));
    // The ranking of the yield has no share column and ranks by the same ratio.
    await expect(panel(page).locator(".ranking__caption")).toHaveText("Rendimento, em kg/ha");
    await expect(rows(page).filter({ hasText: "Paraná" }).locator(".ranking__value .num")).toHaveText(
      format(state, "int"),
    );
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
  });

  test("a state chosen in the ranking goes into focus on the map and in the URL", async ({ page, request }) => {
    await page.goto("/explorar/");
    await ready(page);
    const mesh = page.waitForResponse((r) => r.url().endsWith("/geo/state/PR.topo.json"));
    await rows(page).filter({ hasText: "Paraná" }).getByRole("button").click();
    await mesh;
    await ready(page);
    await expect(map(page)).toHaveAttribute("data-view", "soybean/production_t/2025/PR");
    await expect(page).toHaveURL(/&uf=PR$/);
    await expect(page.getByRole("combobox", { name: "Foco" })).toHaveValue("PR");
    const current = rows(page).filter({ hasText: "Paraná" }).getByRole("button");
    await expect(current).toHaveAttribute("aria-current", "true");
    // The state's share of Brazil, next to its number.
    await expect(panel(page).locator(".explore-panel__sub")).toContainText("do Brasil");
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);

    // From the keyboard: Enter on another state, then on the same one to return to Brazil.
    const goias = rows(page).filter({ hasText: "Goiás" }).getByRole("button");
    await goias.focus();
    await page.keyboard.press("Enter");
    await expect(map(page)).toHaveAttribute("data-view", "soybean/production_t/2025/GO");
    await page.keyboard.press("Enter");
    await expect(map(page)).toHaveAttribute("data-view", "soybean/production_t/2025/BR");
    await expect(page).toHaveURL(/ano=2025$/);
  });

  test("shows every state on request", async ({ page }) => {
    await page.goto("/explorar/");
    await ready(page);
    await expect(rows(page).filter({ visible: true })).toHaveCount(10);
    await panel(page).getByRole("button", { name: "Mostrar todas as UFs" }).click();
    await expect(rows(page).filter({ visible: true })).toHaveCount(27);
    await expect(panel(page).getByRole("button", { name: "Mostrar menos UFs" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

test.describe("loading below the first screen", () => {
  test("on a phone, the state files load only when the panel comes into view", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));
    await page.goto("/explorar/?serie=milho&ano=2000");
    await ready(page);
    await page.waitForTimeout(500);
    expect(requested.filter((p) => p.includes("/places/state/"))).toEqual([]);
    await panel(page).scrollIntoViewIfNeeded();
    await expect(rows(page).first()).toBeVisible();
    expect(requested.filter((p) => p.includes("/places/state/")).length).toBe(27);
  });

  test("the decomposition is in the page, rendered only near the screen, with nothing to download", async ({
    page,
    request,
  }) => {
    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));
    const html = await (await request.get("/explorar/")).text();
    expect(html).toContain('id="figura-2"');
    await page.goto("/explorar/");
    await ready(page);
    const section = page.locator(".growth");
    expect(await section.evaluate((el) => getComputedStyle(el).contentVisibility)).toBe("auto");
    await section.scrollIntoViewIfNeeded();
    await expect(page.locator("#figura-2 .growth__row").first()).toBeVisible();
    expect(requested.some((p) => p.endsWith("/analysis.json"))).toBe(false);
  });
});

test.describe("the figures of the page", () => {
  test("number the map as Figura 1 and the decomposition as Figura 2", async ({ page, request }) => {
    await page.goto("/explorar/");
    await ready(page);
    const marks = page.locator("[data-structural='figure']");
    await expect(marks).toHaveText(["Figura 1", "Figura 2"]);
    await expect(page.locator("#figura-1 .explore__caption [data-structural='figure']")).toHaveText("Figura 1");
    await expect(page.locator("#figura-2 .growth__title [data-structural='figure']")).toHaveText("Figura 2");
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
  });

  test("print the panel's display number in IBM Plex Sans Bold, from its subset, and the rest in mono", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (r) => requested.push(new URL(r.url()).pathname));
    await page.goto("/explorar/");
    await ready(page);
    const number = panel(page).locator(".explore-panel__number .num");
    const style = await number.evaluate((el) => {
      const css = getComputedStyle(el);
      return { family: css.fontFamily, weight: css.fontWeight };
    });
    expect(style.family.startsWith('"Atlas Display Number", "IBM Plex Sans"')).toBe(true);
    expect(style.weight).toBe("700");
    const text = (await number.textContent()) ?? "";
    await expect
      .poll(() => page.evaluate((t) => document.fonts.check('700 40px "Atlas Display Number"', t), text))
      .toBe(true);
    expect(requested.some((p) => p.endsWith("/fonts/AtlasDisplayNumber-Bold.woff"))).toBe(true);
    // The whole Bold file stays out of the page: every character of the number is in the subset.
    expect(requested.some((p) => p.endsWith("/fonts/IBMPlexSans-Bold-Latin1.woff2"))).toBe(false);
    for (const selector of [".explore-panel__unit", ".explore-panel__kicker", ".ranking__value .num", ".series-chart__axis .num"]) {
      const family = await panel(page).locator(selector).first().evaluate((el) => getComputedStyle(el).fontFamily);
      expect(family, selector).toContain("IBM Plex Mono");
    }
  });
});

test.describe("the decomposition", () => {
  test("splits the growth of each crop in area and yield, coffee only after the break", async ({
    page,
    request,
  }) => {
    await page.goto("/explorar/");
    const figure = page.locator("#figura-2");
    await expect(figure.locator(".growth__crop")).toHaveText(["Soja", "Milho", "Café beneficiado"]);
    const coffeeRows = figure.locator(".growth__group").nth(2).locator(".growth__period");
    for (const text of await coffeeRows.allTextContents()) {
      expect(Number(text.slice(0, 4))).toBeGreaterThanOrEqual(2002);
    }
    // Next to coffee, why its area is negative and its yield more than the whole growth: the
    // harvested area at both ends, cited from the decomposition, and smaller at the end.
    const note = figure.locator(".growth__group").nth(2).locator(".growth__note");
    await expect(note).toContainText("A área colhida de café diminuiu em todos os períodos");
    await expect(note).toContainText("mais do que todo o crescimento");
    const areas = note.locator("data[data-src*='_harvested_area_ha/']");
    await expect(areas).toHaveCount(2);
    const [from, to] = await areas.evaluateAll((els) => els.map((el) => Number(el.getAttribute("value"))));
    expect(to).toBeLessThan(from ?? 0);
    // Each label sits right under its own bar and starts where the bar starts.
    for (const row of await figure.locator(".growth__row").all()) {
      const segments = await row.locator(".growth__segment").evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, bottom: r.bottom })),
      );
      const start = Math.min(...segments.map((r) => r.left));
      const bottom = Math.max(...segments.map((r) => r.bottom));
      const label = await row.locator(".growth__values").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top };
      });
      expect(Math.abs(label.left - start)).toBeLessThan(1);
      expect(label.top).toBeGreaterThanOrEqual(bottom - 1);
      expect(label.top - bottom).toBeLessThan(12);
    }
    await figure.locator("details summary").click();
    await expect(figure.locator("table tbody tr")).toHaveCount(await figure.locator(".growth__row").count());
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
  });
});

test.describe("Explorar part B accessibility", () => {
  test("has no axe violations with every state shown, a state in focus and the table open", async ({
    page,
  }) => {
    await page.goto("/explorar/?uf=MT");
    await ready(page);
    await expect(rows(page).first()).toBeVisible();
    await panel(page).getByRole("button", { name: "Mostrar todas as UFs" }).click();
    await page.locator("#figura-2 details summary").click();
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  });
});
