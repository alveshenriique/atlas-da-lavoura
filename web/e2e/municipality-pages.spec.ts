// Every municipality page, read from the build (dist/) with jsdom, without a browser: the
// end-to-end tests of e2e/municipality.spec.ts open a sample of them in a browser; this one
// checks all 5,571 against the data package on disk, for what must hold on every page:
// - every data number cites its place in the package and prints exactly what it says (the
//   rule of numbers; CSS-generated content and numbered lists are checked by the browser
//   tests, which compute styles);
// - drought numbers come only from the climate block of a region file, inside the section
//   of the region's drought risk, which never cites a municipality's values (rule 2: no
//   climate by municipality);
// - a share divides a municipality's production by the published total of the same series
//   and year of its region, its own state or Brazil, never summing crops (rule 1);
// - each crop of Figura 1 cites only its own series, so no chart or table joins the coffee
//   in husk with the processed coffee (rule 3).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { type DefaultTreeAdapterTypes as T, parse } from "parse5";

import {
  columnRef,
  numberTokens,
  parseRefs,
  type Ref,
  renderRef,
  rowRefs,
  serializeRef,
  siblingFile,
} from "../src/lib/provenance";
import { checkStructuralMarks } from "../src/lib/structural";
import { expect, test } from "./test";

const WEB = path.resolve(import.meta.dirname, "..");
const release = JSON.parse(readFileSync(path.join(WEB, "..", "data-release.json"), "utf8")) as {
  data_version: string;
};
const DATA = path.join(WEB, "public", "data", release.data_version);
const DIST = path.join(WEB, "dist", "municipio");

const files = new Map<string, unknown>();
function load(file: string): unknown {
  if (!files.has(file)) files.set(file, JSON.parse(readFileSync(path.join(DATA, file), "utf8")));
  return files.get(file);
}

const SERIES_OF = /\/series\/([a-z_]+)\//;

interface Problem {
  page: string;
  problem: string;
}

// A minimal DOM over parse5's tree (fast, and freed by the garbage collector, unlike
// thousands of jsdom windows).
type Node = T.ChildNode | T.Document;
type El = T.Element;
const isEl = (n: unknown): n is El => typeof n === "object" && n !== null && "tagName" in n;
const attr = (el: El, name: string) => el.attrs.find((a) => a.name === name)?.value ?? null;
const has = (el: El, name: string) => el.attrs.some((a) => a.name === name);
const parentEl = (el: Node): El | null => {
  const p = "parentNode" in el ? el.parentNode : null;
  return isEl(p) ? p : null;
};
function closest(el: El | null, test: (e: El) => boolean): El | null {
  for (let e = el; e; e = parentEl(e)) if (test(e)) return e;
  return null;
}
/** Every node under a root (the root included), in document order. */
function walk(root: Node): Node[] {
  const out: Node[] = [];
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop() as Node;
    out.push(node);
    if ("childNodes" in node) for (let k = node.childNodes.length - 1; k >= 0; k--) stack.push(node.childNodes[k] as Node);
  }
  return out;
}
const elements = (root: Node) => walk(root).filter(isEl);
const textOf = (root: Node): string =>
  walk(root)
    .map((n) => (n.nodeName === "#text" ? (n as T.TextNode).value : ""))
    .join("");
const cellIndex = (cell: El) =>
  (parentEl(cell)?.childNodes ?? []).filter((n) => isEl(n) && (n.tagName === "td" || n.tagName === "th")).indexOf(cell);

function refsOf(el: El): Ref[] | null {
  for (let node: El | null = el; node; node = parentEl(node)) {
    if (has(node, "data-src")) return parseRefs(attr(node, "data-src") ?? "");
    if (node.tagName === "td" || node.tagName === "th") {
      const table = closest(node, (e) => e.tagName === "table");
      const templates = table ? attr(table, "data-src-columns") : null;
      const tr = closest(node, (e) => e.tagName === "tr");
      const row = tr ? attr(tr, "data-row") : null;
      if (templates && row !== null) return [columnRef(templates, cellIndex(node), row)];
    }
    if (has(node, "data-row")) {
      const holder = closest(node, (e) => has(e, "data-src-table"));
      const cols = holder ? attr(holder, "data-src-cols") : null;
      const tableRef = holder ? attr(holder, "data-src-table") : null;
      if (tableRef && cols) return rowRefs(tableRef, cols, Number(attr(node, "data-row")));
    }
  }
  return null;
}

function checkPage(id: string, html: string): Problem[] {
  const problems: Problem[] = [];
  const fail = (problem: string) => problems.push({ page: id, problem });
  const document = parse(html);
  const all = elements(document);
  const body = all.find((e) => e.tagName === "body");
  if (!body) return [{ page: id, problem: "no body" }];
  const uf = /\/municipios\/([a-z]{2})\//.exec(html)?.[1]?.toUpperCase() ?? "";
  const inside = (e: El, tags: string[]) => closest(e, (x) => tags.includes(x.tagName)) !== null;

  // Structural marks (Figura N, Tabela N) follow their rules; their text is exempt.
  const marks = all.filter((e) => has(e, "data-structural") && attr(e, "data-structural") !== "list");
  const structural = checkStructuralMarks(
    marks.map((el) => ({
      kind: attr(el, "data-structural") ?? "",
      text: textOf(el),
      where: el.tagName,
      hasChildren: el.childNodes.some(isEl),
      citesData: closest(el, (e) => has(e, "data-src") || has(e, "data-row")) !== null,
    })),
  );
  for (const p of structural.problems) fail(p);

  // Every number in the text and in the attributes read by assistive technology.
  const items: { text: string; el: El }[] = [];
  for (const node of walk(body)) {
    if (node.nodeName !== "#text") continue;
    const text = (node as T.TextNode).value;
    const parent = parentEl(node);
    if (!parent || !/\d/.test(text) || inside(parent, ["script", "style", "noscript", "template"])) continue;
    const mark = closest(parent, (e) => marks.includes(e));
    if (mark && structural.valid[marks.indexOf(mark)]) continue;
    items.push({ text, el: parent });
  }
  const bodyElements = elements(body);
  for (const el of bodyElements) {
    for (const name of ["aria-label", "title", "alt"]) {
      const value = attr(el, name);
      if (value && /\d/.test(value)) items.push({ text: value, el });
    }
  }
  const title = all.find((e) => e.tagName === "title");
  if (title && /\d/.test(textOf(title))) fail(`a number in the title: ${textOf(title)}`);

  for (const { text, el } of items) {
    let refs: Ref[] | null;
    try {
      refs = refsOf(el);
    } catch (error) {
      fail(String(error));
      continue;
    }
    if (!refs) {
      fail(`number without provenance: "${text.trim()}" in ${el.tagName}.${attr(el, "class") ?? ""}`);
      continue;
    }
    const allowed = new Set<string>();
    try {
      for (const ref of refs) {
        const sibling = siblingFile(ref);
        const carried = closest(el, (e) => has(e, "data-src"));
        const rendered = renderRef(ref, load(ref.file), carried ? attr(carried, "data-value") : null, sibling ? load(sibling) : undefined);
        for (const token of numberTokens(rendered)) allowed.add(token);
      }
    } catch (error) {
      fail(`${String(error)} ("${text.trim()}")`);
      continue;
    }
    for (const token of numberTokens(text)) {
      if (!allowed.has(token)) fail(`${token} is not what ${refs.map(serializeRef).join("; ")} says`);
    }
  }

  // Contracts on the references themselves.
  const risk = bodyElements.find((e) => attr(e, "id") === "risco-de-seca") ?? null;
  const inRiskSet = new Set(risk ? elements(risk) : []);
  const cited: { ref: Ref; el: El }[] = [];
  for (const el of bodyElements) {
    for (const ref of parseRefs(attr(el, "data-src") ?? "")) cited.push({ ref, el });
    const table = attr(el, "data-src-table");
    if (table) cited.push({ ref: { file: table.split("#")[0] ?? "", pointer: table.split("#")[1] ?? "", format: "text" }, el });
  }
  for (const { ref, el } of cited) {
    const inRisk = inRiskSet.has(el);
    if (ref.pointer.startsWith("/climate/")) {
      if (!/^places\/region\/\d+\.json$/.test(ref.file)) fail(`climate from ${ref.file}, not a region file`);
      if (!inRisk) fail(`climate outside the region's drought risk: ${serializeRef(ref)}`);
    }
    if (inRisk && ref.pointer.startsWith("/municipalities/")) {
      fail(`a municipality's value in the drought risk: ${serializeRef(ref)}`);
    }
    if (ref.op === "share") {
      const ok =
        /^\/municipalities\/\d+\/series\/[a-z_]+\/production_t\/\d+$/.test(ref.pointer) &&
        (ref.arg === "region" || ref.arg === "country" || ref.arg === `state-${uf}`);
      if (!ok) fail(`a share that is not of the municipality's production over its territory: ${serializeRef(ref)}`);
    }
  }
  const heading = risk ? elements(risk).find((e) => e.tagName === "h2") : undefined;
  if (!heading || !textOf(heading).includes("região")) fail("the drought risk is not titled as the region's");

  // Each crop of Figura 1 cites only its own series.
  for (const panel of bodyElements.filter((e) => has(e, "data-series-panel"))) {
    const series = attr(panel, "data-series-panel") ?? "";
    const refs = elements(panel).flatMap((e) => [
      ...parseRefs(attr(e, "data-src") ?? "").map(serializeRef),
      ...(attr(e, "data-src-columns") ?? "").split(/\s+/).filter(Boolean),
    ]);
    for (const text of refs) {
      const found = SERIES_OF.exec(text)?.[1];
      // References outside the series (the year of the coffee's unit break, in the catalog)
      // belong to no crop.
      if (found !== undefined && found !== series) fail(`the ${series} panel cites ${text}`);
    }
  }
  return problems;
}

// The pages do not depend on the colour scheme: one project is enough.
test.beforeEach(() => test.skip(test.info().project.name === "dark", "theme-independent"));

test("every municipality page cites its numbers and keeps the data contract", async () => {
  test.setTimeout(10 * 60_000);
  const ids = readdirSync(DIST).slice(0, Number(process.env.SCAN_LIMIT ?? Infinity));
  const catalog = load("catalog.json") as { municipality_count: number };
  if (!process.env.SCAN_LIMIT) expect(ids.length).toBe(catalog.municipality_count);
  const problems: Problem[] = [];
  for (const id of ids) problems.push(...checkPage(id, readFileSync(path.join(DIST, id, "index.html"), "utf8")));
  if (process.env.SCAN_LIMIT) console.log(JSON.stringify(process.memoryUsage()));
  expect(problems.slice(0, 20)).toEqual([]);
});

test("the scan catches what it must (negative cases)", () => {
  const html = readFileSync(path.join(DIST, "5107925", "index.html"), "utf8");
  const broken = html
    // a number without provenance
    .replace("Risco de seca na região de", "Risco de seca na região de 3 safras de")
    // a share of another state
    .replace(/share:state-MT/, "share:state-PR")
    // the coffee in husk cited in the soybean panel
    .replace(/(data-series-panel="soybean"[\s\S]*?data-src-columns=")places\/region\/(\d+)\.json#\/municipalities\/(\d+)\/series\/soybean/, "$1places/region/$2.json#/municipalities/$3/series/coffee_in_husk");
  const problems = checkPage("5107925", broken).map((p) => p.problem).join("\n");
  expect(problems).toMatch(/number without provenance: "Risco de seca/);
  expect(problems).toMatch(/share that is not of the municipality's production/);
  expect(problems).toMatch(/the soybean panel cites .*coffee_in_husk/);
});
