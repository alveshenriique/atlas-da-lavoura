// The Explorar page. Every test runs under the light and the dark colour scheme (the
// Playwright projects). The map state is read from data attributes of the map box
// (data-view, data-counts, data-active-id, data-transition), which no reader sees and the
// number check ignores; the numbers people see are checked against the data package.
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext } from "@playwright/test";

import { expect, type Locator, type Page, test } from "./test";

import { MIN_YIELD_AREA_HA } from "../src/lib/classify";
import { CIRCLE_MAX_RADIUS, circleScale } from "../src/lib/symbols";
import { findUnsourcedNumbers } from "./provenance";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const map = (page: Page) => page.locator(".explore__map");
const ready = (page: Page) => expect(map(page)).toHaveAttribute("data-ready", "true");
const title = (page: Page) => page.getByRole("heading", { level: 1 });
// Chrome names a heading with embedded selects as "soja , em toneladas , em  2025": the
// spacing around each value differs from the visible text, the words do not.
const sentence = (series: string, measure: string, year: string) =>
  new RegExp(`^Onde se produz ${series}\\s*, ${measure}\\s*, em\\s+${year}$`);
const filter = (page: Page, name: "Cultura" | "Medida" | "Ano") =>
  title(page).getByRole("combobox", { name });

async function counts(page: Page) {
  const raw = await map(page).getAttribute("data-counts");
  return JSON.parse(raw ?? "null") as { nodata: number; zero: number; value: number; small: number; notyet: number };
}

interface Matrix {
  years: number[];
  values: (number | null)[][];
}
interface Index {
  municipalities: { municipality_id: number[]; state_abbreviation: string[]; first_pam_year: (number | null)[] };
}
async function packageFile<T>(page: Page, request: APIRequestContext, name: string): Promise<T> {
  const base = await page.evaluate(() => document.documentElement.dataset.dataBase ?? "");
  return (await (await request.get(`${base}${name}`)).json()) as T;
}
/** The first year in which any municipality of a matrix has a value. */
const firstWithData = (file: Matrix) =>
  file.years.find((_, c) => file.values.some((row) => row[c] !== null && row[c] !== undefined));

/** A point well inside the highlighted municipality (away from its border), in page
 *  coordinates: the grid point closest to the centre of its box with a 3 px margin. */
async function pointInside(highlight: Locator) {
  return highlight.evaluate((path: SVGPathElement) => {
    const box = path.getBBox();
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("no screen matrix");
    const inside = (x: number, y: number) =>
      [
        [0, 0],
        [3, 0],
        [-3, 0],
        [0, 3],
        [0, -3],
      ].every(([dx = 0, dy = 0]) => path.isPointInFill(new DOMPoint(x + dx, y + dy)));
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const candidates: [number, number][] = [];
    for (let fx = 0; fx <= 1; fx += 0.05) {
      for (let fy = 0; fy <= 1; fy += 0.05) {
        candidates.push([box.x + fx * box.width, box.y + fy * box.height]);
      }
    }
    candidates.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
    const found = candidates.find(([x, y]) => inside(x, y));
    if (!found) throw new Error("no point inside the highlighted municipality");
    const screen = new DOMPoint(found[0], found[1]).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
}

/** Selects the largest value with the keyboard and returns the municipality id. */
async function selectLargest(page: Page) {
  await map(page).focus();
  await expect(map(page)).toHaveAttribute("data-active-id", /\d+/);
  return (await map(page).getAttribute("data-active-id")) ?? "";
}

test.describe("the Explorar map", () => {
  test("opens on soybean production in the last harvest, in a readable sentence", async ({
    page,
    request,
  }) => {
    await page.goto("/explorar/");
    await ready(page);
    await expect(title(page)).toHaveAccessibleName(sentence("soja", "em toneladas", "2025"));
    await expect(page).toHaveURL(/\?serie=soja&medida=producao&ano=2025$/);
    await expect(map(page)).toHaveAttribute("data-view", "soybean/production_t/2025/BR");

    // The three states, never confused: they match the published matrix exactly.
    const base = await page.evaluate(() => document.documentElement.dataset.dataBase ?? "");
    const file = (await (await request.get(`${base}explore/soybean/production_t.json`)).json()) as {
      years: number[];
      values: (number | null)[][];
    };
    const col = file.years.indexOf(2025);
    const column = file.values.map((row) => row[col] ?? null);
    expect(await counts(page)).toEqual({
      nodata: column.filter((v) => v === null).length,
      zero: column.filter((v) => v === 0).length,
      value: column.filter((v) => v !== null && v > 0).length,
      small: 0,
      notyet: 0,
    });
    // A total: proportional circles, one per municipality that produced.
    await expect(map(page)).toHaveAttribute("data-mode", "circles");
    await expect(map(page)).toHaveAttribute("data-circles", String((await counts(page)).value));
    const legend = page.getByRole("list", { name: "Legenda do mapa" });
    await expect(legend.getByRole("listitem")).toHaveCount(5);
    await expect(legend).toContainText("sem círculo: não produziu");
    await expect(legend).toContainText("sem dado");
    await expect(page.locator(".explore__legend-note")).toContainText("A área de cada círculo é proporcional ao valor");
    await expect(page.locator(".explore__caption")).toContainText(
      "Municípios sem dado aparecem hachurados, e não como zero.",
    );
  });

  test("draws each circle with its area proportional to the value, as large as in the legend", async ({
    page,
    request,
  }) => {
    await page.goto("/explorar/");
    await ready(page);
    const base = await page.evaluate(() => document.documentElement.dataset.dataBase ?? "");
    const file = (await (await request.get(`${base}explore/soybean/production_t.json`)).json()) as {
      years: number[];
      values: (number | null)[][];
    };
    const scale = circleScale(file.values.flat().filter((v): v is number => v !== null && v > 0));
    const width = (await map(page).boundingBox())?.width ?? 0;
    const pxPerUnit = width / 1040;
    // The legend: each reference circle has the diameter the map gives its value.
    const legendWidths = await page.locator(".legend__circle").evaluateAll((svgs) =>
      svgs.map((svg) => svg.getBoundingClientRect().width),
    );
    scale.refs.forEach((ref, k) => {
      const expected = 2 * CIRCLE_MAX_RADIUS * Math.sqrt(ref / scale.max) * pxPerUnit;
      expect(Math.abs((legendWidths[k] ?? 0) - expected)).toBeLessThan(1);
    });
    // The map: the largest municipality's circle, through the highlight drawn over it.
    const id = await selectLargest(page);
    const names = (await (await request.get(`${base}municipalities.json`)).json()) as {
      municipalities: { municipality_id: number[] };
    };
    const value = file.values[names.municipalities.municipality_id.indexOf(Number(id))]?.[file.years.indexOf(2025)] ?? 0;
    const drawn = Number(await page.locator(".explore__highlight-circle").getAttribute("r"));
    expect(drawn).toBeCloseTo(CIRCLE_MAX_RADIUS * Math.sqrt(value / scale.max) * pxPerUnit, 1);
  });

  test("changes series, measure and year, and the URL follows", async ({ page }) => {
    await page.goto("/explorar/");
    await ready(page);
    await filter(page, "Cultura").selectOption({ label: "milho" });
    await filter(page, "Medida").selectOption({ label: "em hectares colhidos" });
    await filter(page, "Ano").selectOption("2000");
    await ready(page);
    await expect(map(page)).toHaveAttribute("data-view", "corn/harvested_area_ha/2000/BR");
    await expect(page).toHaveURL(/\?serie=milho&medida=area-colhida&ano=2000$/);
    await expect(title(page)).toHaveAccessibleName(sentence("milho", "em hectares colhidos", "2000"));
    await expect(page.locator(".explore__legend-title")).toHaveText("Área colhida, em ha");
  });

  test("coffee never crosses the 2002 unit break", async ({ page }) => {
    await page.goto("/explorar/?serie=cafe-beneficiado&ano=2025");
    await ready(page);
    await filter(page, "Cultura").selectOption({ label: "café em coco" });
    await expect(map(page)).toHaveAttribute("data-view", "coffee_in_husk/production_t/2001/BR");
    const years = await filter(page, "Ano").locator("option").allTextContents();
    expect(years[0]).toBe("1974");
    expect(years.at(-1)).toBe("2001");
    await expect(page.locator(".explore__legend-title")).toContainText("t de café em coco");
  });

  // A choice of method (the real value starts in 1995) must never read as missing data: the
  // timeline of the value starts in 1995, a link to an earlier year moves there and says
  // so, and "sem dado" stays for what the source does not have.
  test("starts the real value in 1995, moves an earlier year there and says why", async ({ page, request }) => {
    await page.goto("/explorar/?serie=soja&medida=valor&ano=1975");
    await ready(page);
    await expect(map(page)).toHaveAttribute("data-view", "soybean/production_value_real_thousand_brl/1995/BR");
    await expect(page.locator(".explore__notice")).toHaveText(
      "O valor da produção começa em 1995: o mapa passou de 1975 para 1995.",
    );
    await expect(page.locator(".explore__legend")).toContainText(
      "O valor da produção começa em 1995: antes disso, a hiperinflação e as trocas de moeda",
    );
    const legend = page.getByRole("list", { name: "Legenda do mapa" });
    await expect(legend).not.toContainText("não disponível");
    // Every municipality without a value in 1995 is a null of the file: those created later
    // did not exist yet, the others have no data.
    const file = await packageFile<Matrix>(page, request, "explore/soybean/production_value_real_thousand_brl.json");
    const { municipalities } = await packageFile<Index>(page, request, "municipalities.json");
    const col = file.years.indexOf(1995);
    const nulls = file.values.filter((row) => row[col] === null).length;
    const created = municipalities.first_pam_year.filter((first) => first !== null && first > 1995).length;
    expect(created).toBeGreaterThan(0);
    expect(await counts(page)).toMatchObject({ nodata: nulls - created, notyet: created });
    await expect(legend).toContainText("município ainda não existia");
    await expect(page.locator(".explore-panel__number")).not.toContainText("sem dado");
    // Choosing a year clears the line.
    await filter(page, "Ano").selectOption("2000");
    await expect(page.locator(".explore__notice")).toHaveText("");
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
  });

  test("moves to 1995 when the value is chosen from an earlier year", async ({ page }) => {
    await page.goto("/explorar/?serie=milho&ano=1980");
    await ready(page);
    await filter(page, "Medida").selectOption({ label: "em valor da produção" });
    await expect(map(page)).toHaveAttribute("data-view", "corn/production_value_real_thousand_brl/1995/BR");
    await expect(page.locator(".explore__notice")).toHaveText(
      "O valor da produção começa em 1995: o mapa passou de 1980 para 1995.",
    );
    // Back to the production: the year stays, the line goes.
    await filter(page, "Medida").selectOption({ label: "em toneladas" });
    await expect(map(page)).toHaveAttribute("data-view", "corn/production_t/1995/BR");
    await expect(page.locator(".explore__notice")).toHaveText("");
  });

  // No year the timeline offers is empty for every municipality: each measure starts with
  // the first year of its matrix that has a value (the value in 1995, the planted area in
  // 1988), so a gap of the source's method never reads as missing data.
  test("offers, for every series and measure, only years with data in its file", async ({ page, request }) => {
    for (const [slug, id] of [
      ["soja", "soybean"],
      ["milho", "corn"],
      ["cafe-em-coco", "coffee_in_husk"],
      ["cafe-beneficiado", "coffee_processed"],
      ["cafe-arabica", "coffee_arabica"],
      ["cafe-canefora", "coffee_canephora"],
    ] as const) {
      await page.goto(`/explorar/?serie=${slug}`);
      await ready(page);
      for (const measure of ["production_t", "harvested_area_ha", "planted_or_bearing_area_ha", "production_value_real_thousand_brl"]) {
        await filter(page, "Medida").selectOption(measure);
        const file = await packageFile<Matrix>(page, request, `explore/${id}/${measure}.json`);
        const first = firstWithData(file) ?? 0;
        const offered = await filter(page, "Ano").locator("option").allTextContents();
        const expected = file.years.filter((year) => year >= first).map(String);
        expect(offered, `${slug} ${measure}`).toEqual(expected);
        await expect(page.locator(".timeline__labels"), `${slug} ${measure}`).toContainText(String(first));
      }
    }
  });

  test("starts the planted area in 1988, when the source starts it, and says why", async ({ page, request }) => {
    await page.goto("/explorar/?serie=soja&medida=area-plantada&ano=1980");
    await ready(page);
    await expect(map(page)).toHaveAttribute("data-view", "soybean/planted_or_bearing_area_ha/1988/BR");
    await expect(page.locator(".explore__notice")).toHaveText("A área plantada começa em 1988: o mapa passou de 1980 para 1988.");
    await expect(page.locator(".explore__legend")).toContainText(
      "A área plantada começa em 1988: antes disso, a PAM publicava só a área colhida.",
    );
    // Coffee names it as its area: the area in production.
    await page.goto("/explorar/?serie=cafe-em-coco&medida=area-plantada&ano=1975");
    await ready(page);
    await expect(page.locator(".explore__notice")).toHaveText("A área em produção começa em 1988: o mapa passou de 1975 para 1988.");
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
  });

  // A municipality created after the year shown did not exist yet; it is not "sem dado".
  test("marks as not existing yet exactly the municipalities whose first year is later", async ({ page, request }) => {
    await page.goto("/explorar/");
    const { municipalities } = await packageFile<Index>(page, request, "municipalities.json");
    for (const [slug, id, measure, slugMeasure, year] of [
      ["soja", "soybean", "production_t", "producao", 1980],
      ["milho", "corn", "harvested_area_ha", "area-colhida", 1990],
      ["cafe-arabica", "coffee_arabica", "production_t", "producao", 2012],
    ] as const) {
      await page.goto(`/explorar/?serie=${slug}&medida=${slugMeasure}&ano=${year}`);
      await ready(page);
      const file = await packageFile<Matrix>(page, request, `explore/${id}/${measure}.json`);
      const col = file.years.indexOf(year);
      const later = municipalities.first_pam_year.map((first) => first !== null && first > year);
      // The package has no value before a municipality's first year.
      expect(file.values.filter((row, r) => later[r] && row[col] !== null)).toEqual([]);
      const nulls = file.values.filter((row) => row[col] === null).length;
      const created = later.filter(Boolean).length;
      expect(await counts(page), `${slug} ${year}`).toMatchObject({ notyet: created, nodata: nulls - created });
    }
    // Municipality by municipality, in the table of a state: Mato Grosso, value, 1995.
    await page.goto("/explorar/?serie=soja&medida=valor&ano=1995&uf=MT");
    await ready(page);
    await page.getByRole("button", { name: "Ver como tabela" }).click();
    const rows = page.locator("#explorar-tabela tbody tr");
    await expect(rows).toHaveCount(142);
    const read = await rows.evaluateAll((trs) =>
      trs.map((tr) => ({
        id: Number(/\/municipio\/(\d+)\//.exec(tr.querySelector("a")?.getAttribute("href") ?? "")?.[1]),
        text: tr.querySelector("td.num")?.textContent ?? "",
      })),
    );
    const file = await packageFile<Matrix>(page, request, "explore/soybean/production_value_real_thousand_brl.json");
    const col = file.years.indexOf(1995);
    const { municipality_id: ids, state_abbreviation: ufs, first_pam_year: firsts } = municipalities;
    const expectedNotYet = ids.filter((_, r) => ufs[r] === "MT" && (firsts[r] ?? 0) > 1995).sort();
    const expectedNoData = ids
      .filter((_, r) => ufs[r] === "MT" && file.values[r]?.[col] === null && !((firsts[r] ?? 0) > 1995))
      .sort();
    expect(expectedNotYet.length).toBeGreaterThan(0);
    expect(read.filter((r) => r.text === "ainda não existia").map((r) => r.id).sort()).toEqual(expectedNotYet);
    expect(read.filter((r) => r.text === "sem dado").map((r) => r.id).sort()).toEqual(expectedNoData);
  });

  test("computes the yield in the browser, production over harvested area", async ({
    page,
    request,
  }) => {
    await page.goto("/explorar/?serie=soja&medida=rendimento&ano=2025");
    await ready(page);
    await expect(title(page)).toHaveAccessibleName(/^Quanto rende a\s+soja\s*, em quilos por hectare\s*, em\s+2025$/);
    await expect(page.locator(".explore__legend-title")).toHaveText("Rendimento, em kg/ha");
    // A ratio: the choropleth with the fixed classes, and no circles.
    await expect(map(page)).toHaveAttribute("data-mode", "classes");
    await expect(map(page)).toHaveAttribute("data-circles", "0");
    await expect(page.getByRole("list", { name: "Legenda do mapa" }).getByRole("listitem")).toHaveCount(8);
    await expect(page.locator(".explore__legend-note")).toHaveText(
      "As classes são as mesmas em todos os anos: as cores podem ser comparadas de um ano para outro.",
    );
    const id = await selectLargest(page);
    const base = await page.evaluate(() => document.documentElement.dataset.dataBase ?? "");
    const load = async (name: string) =>
      (await (await request.get(`${base}${name}`)).json()) as {
        years: number[];
        values: (number | null)[][];
        municipalities: { municipality_id: number[] };
      };
    const [production, area, names] = await Promise.all([
      load("explore/soybean/production_t.json"),
      load("explore/soybean/harvested_area_ha.json"),
      load("municipalities.json"),
    ]);
    const row = names.municipalities.municipality_id.indexOf(Number(id));
    const col = production.years.indexOf(2025);
    const expected = ((production.values[row]?.[col] ?? 0) / (area.values[row]?.[col] ?? 1)) * 1000;
    const shown = await page.locator(".explore__tooltip .num").first().textContent();
    expect(Number((shown ?? "").replace(/\./g, ""))).toBe(Math.round(expected));
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
  });

  test("keeps a yield from a tiny harvested area out of the classes, flagged", async ({ page, request }) => {
    await page.goto("/explorar/?serie=soja&medida=rendimento&ano=2025");
    await ready(page);
    const base = await page.evaluate(() => document.documentElement.dataset.dataBase ?? "");
    const load = async (name: string) =>
      (await (await request.get(`${base}${name}`)).json()) as { years: number[]; values: (number | null)[][] };
    const [production, area] = await Promise.all([
      load("explore/soybean/production_t.json"),
      load("explore/soybean/harvested_area_ha.json"),
    ]);
    const col = production.years.indexOf(2025);
    const small = production.values.filter((row, r) => {
      const p = row[col] ?? null;
      const a = area.values[r]?.[col] ?? null;
      return p !== null && p > 0 && a !== null && a > 0 && a < MIN_YIELD_AREA_HA;
    }).length;
    expect(small).toBeGreaterThan(0);
    expect((await counts(page)).small).toBe(small);
    await expect(page.getByRole("list", { name: "Legenda do mapa" })).toContainText(
      "área colhida pequena demais para comparar",
    );
    // In the table the exact yield stays, with the flag (Parintins harvested 1 ha in 2025).
    await page.getByRole("combobox", { name: "Foco" }).selectOption({ label: "Amazonas" });
    await ready(page);
    await page.getByRole("button", { name: "Ver como tabela" }).click();
    const row = page.locator("#explorar-tabela tbody tr", { has: page.getByRole("link", { name: "Parintins" }) });
    await expect(row).toContainText("área colhida pequena");
    await expect(row.locator(".num [data-src]")).toHaveText(/^\d/);
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
  });

  test("plays and pauses the timeline, never by itself", async ({ page }) => {
    await page.goto("/explorar/?serie=soja&ano=2018");
    await ready(page);
    await page.waitForTimeout(1200);
    await expect(map(page)).toHaveAttribute("data-view", "soybean/production_t/2018/BR");
    const play = page.getByRole("button", { name: "Reproduzir a linha do tempo" });
    await page.evaluate(() => performance.clearMeasures("atlas:map-circles"));
    await play.click();
    await expect(map(page)).toHaveAttribute("data-view", "soybean/production_t/2019/BR");
    await expect(map(page)).toHaveAttribute("data-transition", "blend");
    // The circles grow and shrink over many frames, not in one jump.
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => performance.getEntriesByName("atlas:map-circles").length)).toBeGreaterThan(5);
    await page.getByRole("button", { name: "Pausar a linha do tempo" }).click();
    const paused = await map(page).getAttribute("data-view");
    await page.waitForTimeout(1500);
    await expect(map(page)).toHaveAttribute("data-view", paused ?? "");
    await expect(page.getByRole("slider", { name: "Ano" })).toHaveAttribute(
      "aria-valuetext",
      paused?.split("/")[2] ?? "",
    );
  });

  test("with reduced motion, play jumps from year to year", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/explorar/?serie=soja&ano=2018");
    await ready(page);
    await page.evaluate(() => performance.clearMeasures("atlas:map-circles"));
    await page.getByRole("button", { name: "Reproduzir a linha do tempo" }).click();
    await expect(map(page)).toHaveAttribute("data-view", "soybean/production_t/2019/BR");
    await expect(map(page)).toHaveAttribute("data-transition", "jump");
    // One drawing per year: the circles take their new size at once.
    expect(await page.evaluate(() => performance.getEntriesByName("atlas:map-circles").length)).toBe(1);
    await expect(map(page)).toHaveAttribute("data-view", "soybean/production_t/2020/BR");
    await expect(map(page)).toHaveAttribute("data-transition", "jump");
    await page.getByRole("button", { name: "Pausar a linha do tempo" }).click();
  });

  test("zooms into a state with its detailed mesh", async ({ page }) => {
    await page.goto("/explorar/");
    await ready(page);
    const mesh = page.waitForResponse((response) => response.url().endsWith("/geo/state/MT.topo.json"));
    await page.getByRole("combobox", { name: "Foco" }).selectOption({ label: "Mato Grosso" });
    expect((await mesh).ok()).toBe(true);
    await ready(page);
    await expect(map(page)).toHaveAttribute("data-view", "soybean/production_t/2025/MT");
    await expect(page).toHaveURL(/&uf=MT$/);
    const { nodata, zero, value, small, notyet } = await counts(page);
    expect(nodata + zero + value + small + notyet).toBe(142);
    await page.getByRole("combobox", { name: "Foco" }).selectOption({ label: "Brasil" });
    await expect(map(page)).toHaveAttribute("data-view", "soybean/production_t/2025/BR");
  });

  test("a permanent link reproduces the same view, loading only its data", async ({ page }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(new URL(request.url()).pathname));
    await page.goto("/explorar/?serie=milho&medida=area-colhida&ano=2000&uf=PR");
    await ready(page);
    await expect(map(page)).toHaveAttribute("data-view", "corn/harvested_area_ha/2000/PR");
    await expect(title(page)).toHaveAccessibleName(sentence("milho", "em hectares colhidos", "2000"));
    await expect(page.getByRole("combobox", { name: "Foco" })).toHaveValue("PR");
    await expect(page).toHaveURL(/\?serie=milho&medida=area-colhida&ano=2000&uf=PR$/);
    // The default view's matrix is preloaded by the page; no other matrix is fetched.
    const matrices = requested.filter((path) => path.includes("/explore/"));
    expect(matrices.filter((path) => !path.endsWith("/explore/soybean/production_t.json"))).toEqual([
      expect.stringMatching(/\/explore\/corn\/harvested_area_ha\.json$/),
    ]);
  });

  test("the keyboard walks the municipalities and Enter opens the ficha", async ({ page }) => {
    await page.goto("/explorar/");
    await ready(page);
    const first = await selectLargest(page);
    await expect(page.locator("[aria-live='polite']")).toContainText("em 2025");
    await page.keyboard.press("ArrowRight");
    await expect(map(page)).not.toHaveAttribute("data-active-id", first);
    await page.keyboard.press("Escape");
    await expect(page.locator(".explore__tooltip")).toHaveCount(0);
    await page.keyboard.press("ArrowLeft");
    const id = (await map(page).getAttribute("data-active-id")) ?? "";
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/municipio/${id}/$`));
  });

  test("hovering a municipality of the choropleth shows the tooltip and a click opens the ficha", async ({
    page,
    request,
  }) => {
    // In a state's focus, where the municipality of the highest yield is large on screen.
    await page.goto("/explorar/?medida=rendimento&uf=MT");
    await ready(page);
    const id = await selectLargest(page);
    const point = await pointInside(page.locator(".explore__highlight-line"));
    await page.keyboard.press("Escape");
    await page.mouse.move(point.x, point.y);
    await expect(map(page)).toHaveAttribute("data-active-id", id);
    const tooltip = page.locator(".explore__tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/\S+/);
    await expect(tooltip).toContainText("em 2025");
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
    await page.mouse.click(point.x, point.y);
    await expect(page).toHaveURL(new RegExp(`/municipio/${id}/$`));
  });

  test("hovering a circle shows its municipality, and a click opens the ficha", async ({ page, request }) => {
    await page.goto("/explorar/");
    await ready(page);
    await selectLargest(page);
    const circle = page.locator(".explore__highlight-circle");
    const box = await circle.boundingBox();
    if (!box) throw new Error("no circle");
    await page.keyboard.press("Escape");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // The centre of the largest circle: the circle on top there is the one the pointer gets.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator(".explore__tooltip")).toBeVisible();
    await expect(page.locator(".explore__highlight-circle")).toBeVisible();
    const id = (await map(page).getAttribute("data-active-id")) ?? "";
    expect(id).toMatch(/^\d{7}$/);
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page).toHaveURL(new RegExp(`/municipio/${id}/$`));
  });

  test("the table has the same data, sorts and works from the keyboard", async ({
    page,
    request,
  }) => {
    await page.goto("/explorar/?serie=soja&medida=producao&ano=2025&uf=MT");
    await ready(page);
    const toggle = page.getByRole("button", { name: "Ver como tabela" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Ocultar a tabela" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const table = page.locator("#explorar-tabela table");
    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(142);
    await expect(rows.first().getByRole("link")).toHaveText("Sorriso");
    await expect(rows.first().getByRole("link")).toHaveAttribute("href", "/municipio/5107925/");
    const valueHeader = table.locator("thead th").nth(2);
    await expect(valueHeader).toHaveAttribute("aria-sort", "descending");

    const nameButton = table.getByRole("button", { name: "Município" });
    await nameButton.focus();
    await page.keyboard.press("Enter");
    await expect(table.locator("thead th").first()).toHaveAttribute("aria-sort", "ascending");
    const names = await rows.locator("th").allTextContents();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "pt-BR")));
    await page.keyboard.press("Enter");
    await expect(table.locator("thead th").first()).toHaveAttribute("aria-sort", "descending");

    const region = page.getByRole("region", { name: "Tabela dos municípios" });
    await region.focus();
    await expect(region).toBeFocused();
    expect(await findUnsourcedNumbers(page, request)).toEqual([]);
  });

  test("a number in the legend that disagrees with its file fails the check", async ({
    page,
    request,
  }) => {
    await page.goto("/explorar/");
    await ready(page);
    await page.evaluate(() => {
      const limit = document.querySelector(".explore__legend [data-src]");
      if (limit) limit.textContent = "600";
    });
    const issues = await findUnsourcedNumbers(page, request);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.problem).toMatch(/600 is not what explore\/soybean\/production_t\.json/);
  });
});

test.describe("the title sentence", () => {
  test("fits a 360 px screen with every crop and measure", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/explorar/");
    await ready(page);
    const seriesValues = await filter(page, "Cultura").locator("option").evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value),
    );
    const measureValues = await filter(page, "Medida").locator("option").evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value),
    );
    for (const series of seriesValues) {
      await filter(page, "Cultura").selectOption(series);
      for (const measure of measureValues) {
        await filter(page, "Medida").selectOption(measure);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${series} / ${measure}`).toBeLessThanOrEqual(0);
      }
    }
  });
});

test.describe("the first paint", () => {
  test("puts the outline of the states in the page itself", async ({ request }) => {
    const html = await (await request.get("/explorar/")).text();
    expect(html).toMatch(/<svg class="explore__outline-svg"[^>]*viewBox="[^"]+"/);
    expect(html).toMatch(/class="explore__outline-borders" d="M[^"]{1000,}"/);
    expect(html).toMatch(/class="explore__outline-country" d="M[^"]{1000,}"/);
  });

  test("shows the outline and the legend, and says the municipalities are loading", async ({
    page,
  }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/geo/municipalities.topo.json", async (route) => {
      await held;
      await route.continue();
    });
    await page.goto("/explorar/");
    await expect(page.locator(".explore__outline-svg")).toBeVisible();
    // The loading line of the map (the notice of a moved year is another status, empty here).
    const status = page.locator(".explore__map").getByRole("status");
    await expect(status).toHaveText("Carregando os municípios…");
    await expect(map(page)).toHaveAttribute("aria-busy", "true");
    const legend = page.getByRole("list", { name: "Legenda do mapa" });
    await expect(legend.getByRole("listitem")).toHaveCount(5);
    await expect(page.locator(".legend__circle")).toHaveCount(3);
    await page.waitForTimeout(500);
    await expect(status).toHaveText("Carregando os municípios…");

    release();
    await ready(page);
    await expect(page.locator(".explore__outline")).toBeHidden();
    await expect(status).toBeEmpty();
    await expect(map(page)).toHaveAttribute("aria-busy", "false");
  });

  test("the outline lands where the municipalities are drawn", async ({ page }) => {
    // The choropleth: circles may reach beyond the coast.
    await page.goto("/explorar/?medida=rendimento");
    await ready(page);
    const boxes = await page.evaluate(() => {
      const map = document.querySelector(".explore__map") as HTMLElement;
      const origin = map.getBoundingClientRect();
      const canvas = map.querySelector("canvas") as HTMLCanvasElement;
      const scale = canvas.width / canvas.getBoundingClientRect().width;
      const { data, width, height } = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if ((data[(y * width + x) * 4 + 3] ?? 0) > 128) {
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
        }
      }
      const outline = map.querySelector(".explore__outline") as HTMLElement;
      outline.hidden = false;
      const country = outline.querySelector(".explore__outline-country")!.getBoundingClientRect();
      return {
        drawn: [x0 / scale, y0 / scale, (x1 + 1) / scale, (y1 + 1) / scale],
        outline: [
          country.left - origin.left,
          country.top - origin.top,
          country.right - origin.left,
          country.bottom - origin.top,
        ],
      };
    });
    boxes.drawn.forEach((value, i) => expect(Math.abs(value - (boxes.outline[i] ?? 0))).toBeLessThan(3));
  });
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the outline and the legend still show, with a note instead of the loading line", async ({
    page,
  }) => {
    await page.goto("/explorar/");
    await expect(page.locator(".explore__outline-svg")).toBeVisible();
    await expect(page.getByRole("list", { name: "Legenda do mapa" })).toBeVisible();
    await expect(page.locator(".explore__loading")).toBeHidden();
    await expect(page.locator(".explore__noscript")).toContainText("precisa de JavaScript");
  });
});

test.describe("Explorar accessibility", () => {
  test("has no axe violations, with the tooltip and with the table open", async ({ page }) => {
    await page.goto("/explorar/");
    await ready(page);
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
    await selectLargest(page);
    await expect(page.locator(".explore__tooltip")).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
    // The table in a state's focus: axe on the 5,571 national rows takes minutes.
    await page.getByRole("combobox", { name: "Foco" }).selectOption({ label: "Mato Grosso" });
    await ready(page);
    await page.getByRole("button", { name: "Ver como tabela" }).click();
    await expect(page.locator("#explorar-tabela tbody tr")).toHaveCount(142);
    expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
  });
});
