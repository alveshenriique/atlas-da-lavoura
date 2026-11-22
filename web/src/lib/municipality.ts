// The municipality page (pages/municipio/[id].astro), built at build time from the data
// package: the municipality's block in its immediate region's file (places/region/<id>.json),
// the region's own series and climate, the state's file and Brazil's. The browser fetches no
// data file. Nothing here aggregates territories (rule 1 of the data contract): territory
// values come from their own files; the only computations are a yield (production over
// harvested area of the same place) and a share (a value over the published total of the
// same series and year). Every printed number carries its reference (lib/provenance.ts).
import { isSmallArea, yieldCell } from "./classify";
import { loadCatalog, loadDataFile } from "./data";
import { type DroughtReading, droughtReading } from "./drought";
import { format, type FormatName } from "./format";
import { type Sourced, sourced } from "./sourced";
import type { MunicipalitiesJson } from "../types/data/municipalities";
import type { MunicipalBlock, PlacesBrasilMacrorregiaoUFOuRegiaoImediata, TerritoryBlock } from "../types/data/place";

type Place = PlacesBrasilMacrorregiaoUFOuRegiaoImediata;
type Values = (number | null)[];

/** The series of the page, in order. The coffee in husk (until 2001) is only in the tables. */
export const SERIES = [
  { id: "soybean", label: "Soja", lower: "soja", figure: true, sub: false },
  { id: "corn", label: "Milho", lower: "milho", figure: true, sub: false },
  { id: "coffee_processed", label: "Café beneficiado", lower: "café beneficiado", figure: true, sub: false },
  { id: "coffee_arabica", label: "Café arábica", lower: "café arábica", figure: true, sub: true },
  { id: "coffee_canephora", label: "Café canéfora", lower: "café canéfora", figure: true, sub: true },
  { id: "coffee_in_husk", label: "Café em coco", lower: "café em coco", figure: false, sub: false },
] as const;
export type SeriesId = (typeof SERIES)[number]["id"];
/** The crops of the drought analysis (rule 4 of the contract): soybean and arabica coffee. */
export const CLIMATE_SERIES = ["soybean", "coffee_arabica"] as const;
export type ClimateSeriesId = (typeof CLIMATE_SERIES)[number];

export type CellKind = "value" | "zero" | "nodata" | "notyet" | "small";

export interface Cell {
  kind: CellKind;
  /** The number with its reference, when there is one to print. */
  n: Sourced | null;
}

export interface Rank {
  position: Sourced;
  of: Sourced;
}

export interface CropRow {
  id: SeriesId;
  label: string;
  lower: string;
  sub: boolean;
  unit: string;
  year: Sourced;
  production: Cell;
  area: Cell;
  yieldKgHa: Cell;
  ranks: { region: Rank | null; state: Rank | null; country: Rank | null };
  shares: { region: Sourced | null; state: Sourced | null; country: Sourced | null };
  /** The last harvest with production, when the latest had none. */
  lastProduced: Sourced | null;
  /** Production from the first year of the series (or of the municipality) to the latest. */
  spark: { years: number[]; values: Values };
}

export interface Line {
  key: "municipality" | "region" | "state" | "country";
  label: string;
  values: Values;
  /** The last plotted value, with its reference, and its year. */
  end: { n: Sourced; year: Sourced } | null;
}

/** One column template of a table (data-src-columns): `{row}` is the row's index. */
export interface Column {
  header: string;
  template: string;
}

export interface SeriesFigure {
  id: SeriesId;
  label: string;
  lower: string;
  chart: boolean;
  years: number[];
  firstYear: Sourced;
  lastYear: Sourced;
  lines: Line[];
  /** Rows of the data table: the index in the series' years, and the cells as printed. */
  table: { columns: Column[]; rows: { index: number; cells: string[] }[] };
}

export interface ClimateBlock {
  id: ClimateSeriesId;
  lower: string;
  deficitLabel: string;
  file: string;
  status: "summary" | "short" | "none";
  reading: DroughtReading | null;
  summary: Record<string, Sourced> | null;
  bars: { row: number; year: number; anomaly: number; deficit: boolean }[];
  missingYears: number[];
  years: [number, number] | null;
  extent: [number, number];
  last: Record<string, Sourced> | null;
  lastDeficit: boolean | null;
}

export interface Municipality {
  id: number;
  index: number;
  code: Sourced;
  name: string;
  uf: string;
  stateName: string;
  regionId: number;
  regionName: string;
  regionFile: string;
  stateFile: string;
  firstPamYear: Sourced | null;
  neverInPam: boolean;
  rows: CropRow[];
  main: CropRow | null;
  latestYear: Sourced;
  figures: SeriesFigure[];
  climate: ClimateBlock[];
  /** The other municipalities of the region, for the list under the minimap. */
  neighbours: { id: number; name: string }[];
}

const COUNTRY_FILE = "places/country.json";

function index() {
  return loadDataFile<MunicipalitiesJson>("municipalities.json");
}

/** Every municipality, in the order of the index: the static paths of the pages. */
export function municipalityIds(): number[] {
  return index().municipalities.municipality_id;
}

function block(place: Place, file: string, series: string): TerritoryBlock {
  const b = place.series[series];
  if (!b) throw new Error(`${file} has no series ${series}`);
  return b;
}

function sameYears(a: number[], b: number[], what: string) {
  if (a.length !== b.length || a.some((year, i) => year !== b[i])) {
    throw new Error(`${what}: the years of the municipality and of the territory differ`);
  }
}

export function municipalityModel(id: number): Municipality {
  const catalog = loadCatalog();
  const { municipalities, states, immediate_regions: regions } = index();
  const i = municipalities.municipality_id.indexOf(id);
  if (i < 0) throw new Error(`no municipality ${id}`);
  const name = municipalities.municipality_name[i] ?? "";
  const uf = municipalities.state_abbreviation[i] ?? "";
  const regionId = municipalities.immediate_region_id[i] ?? 0;
  const firstPam = municipalities.first_pam_year[i] ?? null;
  const stateName = states.state_name[states.state_abbreviation.indexOf(uf)] ?? uf;
  const regionName = regions.immediate_region_name[regions.immediate_region_id.indexOf(regionId)] ?? "";
  const regionFile = `places/region/${regionId}.json`;
  const stateFile = `places/state/${uf}.json`;
  const region = loadDataFile<Place>(regionFile);
  const state = loadDataFile<Place>(stateFile);
  const country = loadDataFile<Place>(COUNTRY_FILE);
  const mi = (region.municipalities ?? []).findIndex((m) => m.municipality_id === id);
  const own = region.municipalities?.[mi];
  if (!own) throw new Error(`${regionFile} does not list municipality ${id}`);
  const base = (series: string) => `/municipalities/${mi}/series/${series}`;
  const seriesIndex = (series: string) => (catalog.series.series as string[]).indexOf(series);
  const lastYearOf = (series: string) => catalog.series.last_year[seriesIndex(series)] ?? 0;
  const firstYearOf = (series: string) => catalog.series.first_year[seriesIndex(series)] ?? 0;
  const unitOf = (series: string) => catalog.series.production_unit_pt[seriesIndex(series)] ?? "t";

  // --- the latest harvest of each series ---
  const cell = (series: string, field: "production_t" | "harvested_area_ha", at: number, year: number): Cell => {
    if (firstPam === null) return { kind: "nodata", n: null };
    if (year < firstPam) return { kind: "notyet", n: null };
    const value = (own.series[series] as MunicipalBlock)[field][at] ?? null;
    if (value === null) return { kind: "nodata", n: null };
    if (value === 0) return { kind: "zero", n: null };
    return { kind: "value", n: sourced(regionFile, `${base(series)}/${field}/${at}`, field === "production_t" ? "compact" : "compact") };
  };
  const yieldOf = (series: string, at: number, year: number, fmt: FormatName = "int"): Cell => {
    if (firstPam === null) return { kind: "nodata", n: null };
    if (year < firstPam) return { kind: "notyet", n: null };
    const b = own.series[series] as MunicipalBlock;
    const area = b.harvested_area_ha[at] ?? null;
    const value = yieldCell(b.production_t[at] ?? null, area);
    if (value === null) return { kind: "nodata", n: null };
    if (value === 0) return { kind: "zero", n: null };
    const n = sourced(regionFile, `${base(series)}/production_t/${at}`, fmt, "areayield");
    return { kind: isSmallArea(area) ? "small" : "value", n };
  };

  const rows: CropRow[] = SERIES.filter((s) => s.id !== "coffee_in_husk").map((s) => {
    const own_ = own.series[s.id] as MunicipalBlock;
    sameYears(own_.years, block(region, regionFile, s.id).years, `${regionFile} ${s.id}`);
    sameYears(own_.years, block(state, stateFile, s.id).years, `${stateFile} ${s.id}`);
    sameYears(own_.years, block(country, COUNTRY_FILE, s.id).years, `${COUNTRY_FILE} ${s.id}`);
    const year = lastYearOf(s.id);
    const at = own_.years.indexOf(year);
    const production = cell(s.id, "production_t", at, year);
    const positive = production.kind === "value";
    const rank = (field: "rank_immediate_region" | "rank_state" | "rank_country", file: string): Rank | null => {
      if (!positive || own_[field][at] === null || own_[field][at] === undefined) return null;
      return {
        position: sourced(regionFile, `${base(s.id)}/${field}/${at}`, "int"),
        of: sourced(file, `/series/${s.id}/producing_municipalities/${at}`, "int"),
      };
    };
    const share = (arg: string): Sourced | null =>
      positive ? sourced(regionFile, `${base(s.id)}/production_t/${at}`, "pct", "share", arg) : null;
    let lastProduced: Sourced | null = null;
    if (!positive && firstPam !== null) {
      for (let k = at - 1; k >= 0; k--) {
        if ((own_.production_t[k] ?? 0) > 0) {
          lastProduced = sourced(regionFile, `${base(s.id)}/years/${k}`, "year");
          break;
        }
      }
    }
    const from = Math.max(firstYearOf(s.id), firstPam ?? Infinity);
    const sparkIdx = own_.years.flatMap((y, k) => (y >= from && y <= year ? [k] : []));
    return {
      id: s.id,
      label: s.label,
      lower: s.lower,
      sub: s.sub,
      unit: unitOf(s.id),
      year: sourced(regionFile, `${base(s.id)}/years/${at}`, "year"),
      production,
      area: cell(s.id, "harvested_area_ha", at, year),
      yieldKgHa: yieldOf(s.id, at, year),
      ranks: {
        region: rank("rank_immediate_region", regionFile),
        state: rank("rank_state", stateFile),
        country: rank("rank_country", COUNTRY_FILE),
      },
      shares: { region: share("region"), state: share(`state-${uf}`), country: share("country") },
      lastProduced,
      spark: { years: sparkIdx.map((k) => own_.years[k] ?? 0), values: sparkIdx.map((k) => own_.production_t[k] ?? null) },
    };
  });
  // Arabica and canephora (since 2012) only when the municipality ever grew them.
  const ever = (series: string) => ((own.series[series] as MunicipalBlock).production_t ?? []).some((v) => (v ?? 0) > 0);
  const shownRows = rows.filter((row) => !row.sub || ever(row.id));

  // The main crop: the largest value of production in the latest year (the one measure that
  // compares crops), among soybean, corn and coffee.
  let main: CropRow | null = null;
  let best = 0;
  for (const row of shownRows.filter((r) => !r.sub && r.production.kind === "value")) {
    const real = (own.series[row.id] as MunicipalBlock).real_value;
    const k = real.years.indexOf(lastYearOf(row.id));
    const value = real.production_value_real_thousand_brl[k] ?? 0;
    if (value > best) {
      best = value;
      main = row;
    }
  }

  // --- the series figures: yields of the municipality, the region, the state and Brazil ---
  const figures: SeriesFigure[] = SERIES.filter((s) => ever(s.id)).map((s) => {
    const own_ = own.series[s.id] as MunicipalBlock;
    const first = firstYearOf(s.id);
    const last = lastYearOf(s.id);
    const idx = own_.years.flatMap((y, k) => (y >= first && y <= last ? [k] : []));
    const years = idx.map((k) => own_.years[k] ?? 0);
    const territoryLine = (key: Line["key"], label: string, place: Place, file: string, pointer: string): Line => {
      const b = key === "municipality" ? own_ : block(place, file, s.id);
      const values = idx.map((k, j) => {
        if (key === "municipality" && (firstPam === null || (years[j] ?? 0) < firstPam)) return null;
        const area = b.harvested_area_ha[k] ?? null;
        const v = yieldCell(b.production_t[k] ?? null, area);
        return v === null || v === 0 || isSmallArea(area) ? null : v;
      });
      let end: Line["end"] = null;
      for (let j = values.length - 1; j >= 0; j--) {
        if (values[j] !== null) {
          const k = idx[j] ?? 0;
          end = {
            n: sourced(file, `${pointer}/production_t/${k}`, "int", "areayield"),
            year: sourced(file, `${pointer}/years/${k}`, "year"),
          };
          break;
        }
      }
      return { key, label, values, end };
    };
    const lines = [
      territoryLine("municipality", name, region, regionFile, base(s.id)),
      territoryLine("region", "Região", region, regionFile, `/series/${s.id}`),
      territoryLine("state", uf, state, stateFile, `/series/${s.id}`),
      territoryLine("country", "Brasil", country, COUNTRY_FILE, `/series/${s.id}`),
    ];
    const columns: Column[] = [
      { header: "Safra", template: `${regionFile}#${base(s.id)}/years/{row}|year` },
      { header: `Produção (${unitOf(s.id)})`, template: `${regionFile}#${base(s.id)}/production_t/{row}|int` },
      { header: "Área colhida (ha)", template: `${regionFile}#${base(s.id)}/harvested_area_ha/{row}|int` },
      { header: `Rendimento em ${name} (kg/ha)`, template: `${regionFile}#${base(s.id)}/production_t/{row}!areayield|int` },
      { header: `Rendimento na região (kg/ha)`, template: `${regionFile}#/series/${s.id}/production_t/{row}!areayield|int` },
      { header: `Rendimento no ${uf} (kg/ha)`, template: `${stateFile}#/series/${s.id}/production_t/{row}!areayield|int` },
      { header: "Rendimento no Brasil (kg/ha)", template: `${COUNTRY_FILE}#/series/${s.id}/production_t/{row}!areayield|int` },
    ];
    const tableRows = idx.map((k, j) => {
      const year = years[j] ?? 0;
      const ownCell = (v: number | null | undefined) => {
        if (firstPam === null) return "sem dado";
        if (year < firstPam) return "ainda não existia";
        if (v === null || v === undefined) return "sem dado";
        return null;
      };
      const intOf = (v: number) => format(v, "int");
      const p = own_.production_t[k];
      const a = own_.harvested_area_ha[k];
      const yieldText = (b: { production_t: Values; harvested_area_ha: Values }, isOwn: boolean) => {
        if (isOwn) {
          const missing = ownCell(p);
          if (missing) return missing;
        }
        const area = b.harvested_area_ha[k] ?? null;
        const v = yieldCell(b.production_t[k] ?? null, area);
        if (v === null) return "sem dado";
        if (v === 0) return "não produziu";
        return isSmallArea(area) && isOwn ? `${intOf(v)} (área pequena)` : intOf(v);
      };
      return {
        index: k,
        cells: [
          String(year),
          ownCell(p) ?? (p === 0 ? "0" : intOf(p ?? 0)),
          ownCell(a) ?? (a === 0 ? "0" : intOf(a ?? 0)),
          yieldText(own_, true),
          yieldText(block(region, regionFile, s.id), false),
          yieldText(block(state, stateFile, s.id), false),
          yieldText(block(country, COUNTRY_FILE, s.id), false),
        ],
      };
    });
    return {
      id: s.id,
      label: s.label,
      lower: s.lower,
      chart: s.figure,
      years,
      firstYear: sourced(regionFile, `${base(s.id)}/years/${idx[0] ?? 0}`, "year"),
      lastYear: sourced(regionFile, `${base(s.id)}/years/${idx[idx.length - 1] ?? 0}`, "year"),
      lines,
      table: { columns, rows: tableRows },
    };
  });

  // --- the drought risk of the immediate region (never of the municipality) ---
  const labels = catalog.climate_labels as Record<string, { is_water_deficit: string } | undefined>;
  const climate: ClimateBlock[] = CLIMATE_SERIES.map((crop) => {
    const lower = SERIES.find((s) => s.id === crop)?.lower ?? crop;
    const deficitLabel = labels[crop]?.is_water_deficit ?? "seca";
    const c = region.climate?.[crop];
    const empty = { id: crop, lower, deficitLabel, file: regionFile, reading: null, summary: null, bars: [], missingYears: [], years: null, extent: [0, 0] as [number, number], last: null, lastDeficit: null };
    if (!c) return { ...empty, status: "none" as const };
    const y = c.years;
    const at = (field: string, k: number, fmt: FormatName, op?: "hits") =>
      sourced(regionFile, `/climate/${crop}/years/${field}/${k}`, fmt, op);
    // The last harvest of the region: the latest one with a drought class.
    let lastK = -1;
    for (let k = y.harvest_year.length - 1; k >= 0; k--) {
      if (y.is_water_deficit[k] !== null && y.is_water_deficit[k] !== undefined) {
        lastK = k;
        break;
      }
    }
    const last =
      lastK < 0
        ? null
        : Object.fromEntries(
            [
              ["year", at("harvest_year", lastK, "year")],
              ...(y.precipitation_pct_of_normal[lastK] !== null ? [["rain", at("precipitation_pct_of_normal", lastK, "int")]] : []),
              ...(y.water_balance_z[lastK] !== null ? [["balance", at("water_balance_z", lastK, "dec2")]] : []),
              ...(y.hot_days_anomaly_days[lastK] !== null ? [["hot", at("hot_days_anomaly_days", lastK, "absint")]] : []),
            ] as [string, Sourced][],
          );
    const bars = y.harvest_year.flatMap((year, k) => {
      const anomaly = y.yield_anomaly[k];
      return anomaly === null || anomaly === undefined ? [] : [{ row: k, year, anomaly, deficit: y.is_water_deficit[k] === true }];
    });
    const barYears = bars.map((b) => b.year);
    const span: [number, number] | null = bars.length ? [Math.min(...barYears), Math.max(...barYears)] : null;
    const missingYears = span ? y.harvest_year.filter((year, k) => year >= span[0] && year <= span[1] && (y.yield_anomaly[k] === null || y.yield_anomaly[k] === undefined)) : [];
    const anomalies = bars.map((b) => b.anomaly);
    const extent: [number, number] = anomalies.length ? [Math.min(...anomalies, 0), Math.max(...anomalies, 0)] : [0, 0];
    const s = c.summary;
    if (!s) return { ...empty, status: "short" as const, bars, missingYears, years: span, extent, last, lastDeficit: lastK < 0 ? null : y.is_water_deficit[lastK] === true };
    const sum = (field: string, fmt: FormatName, op?: "hits") => sourced(regionFile, `/climate/${crop}/summary/${field}`, fmt, op);
    const summary: Record<string, Sourced> = {
      years: sum("n_years", "int"),
      first: sum("first_year", "year"),
      last: sum("last_year", "year"),
      deficits: sum("water_deficit_years", "int"),
    };
    if ((s.water_deficit_years ?? 0) > 0) {
      summary.meanDeficit = sum("mean_anomaly_water_deficit_years", "spct");
      summary.hits = sum("water_deficit_hit_rate", "int", "hits");
      summary.hitRate = sum("water_deficit_hit_rate", "pct");
    }
    if (s.mean_anomaly_no_water_deficit_years !== null) summary.meanOther = sum("mean_anomaly_no_water_deficit_years", "spct");
    if (s.negative_anomaly_share_all_years !== null) summary.baseRate = sum("negative_anomaly_share_all_years", "pct");
    if (s.corr_water_balance_yield !== null) summary.corr = sum("corr_water_balance_yield", "sdec2");
    return {
      ...empty,
      status: "summary" as const,
      reading: droughtReading(y, s),
      summary,
      bars,
      missingYears,
      years: span,
      extent,
      last,
      lastDeficit: lastK < 0 ? null : y.is_water_deficit[lastK] === true,
    };
  });

  const neighbours = (region.municipalities ?? [])
    .filter((m) => m.municipality_id !== id)
    .map((m) => ({ id: m.municipality_id, name: m.municipality_name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return {
    id,
    index: i,
    code: sourced("municipalities.json", `/municipalities/municipality_id/${i}`, "text"),
    name,
    uf,
    stateName,
    regionId,
    regionName,
    regionFile,
    stateFile,
    firstPamYear: firstPam === null ? null : sourced("municipalities.json", `/municipalities/first_pam_year/${i}`, "year"),
    neverInPam: firstPam === null,
    rows: shownRows,
    main,
    latestYear: sourced(regionFile, `${base("soybean")}/years/${(own.series.soybean as MunicipalBlock).years.length - 1}`, "year"),
    figures,
    climate,
    neighbours,
  };
}
