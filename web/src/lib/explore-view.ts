// The Explorar view (series, measure, year and the state in focus) and its permanent link:
// ?serie=soja&medida=producao&ano=2025&uf=MT. Unknown values fall back to the default and the
// year is kept inside the series' own years, so no coffee view crosses the 2002 unit break.
// Some measures start later than their series: the real value of production in 1995 (no
// deflation through the hyperinflation) and the planted area in 1988 (the PAM published only
// the harvested area before). For them the years start there, and a year before it moves
// to it, with the move reported, so a year the source left empty for every municipality
// never shows as missing data.

export const MEASURES = [
  "production_t",
  "harvested_area_ha",
  "planted_or_bearing_area_ha",
  "production_value_real_thousand_brl",
  "yield",
] as const;
export type Measure = (typeof MEASURES)[number];

export const SERIES_SLUG: Record<string, string> = {
  soybean: "soja",
  corn: "milho",
  coffee_processed: "cafe-beneficiado",
  coffee_in_husk: "cafe-em-coco",
  coffee_arabica: "cafe-arabica",
  coffee_canephora: "cafe-canefora",
};

export const MEASURE_SLUG: Record<Measure, string> = {
  production_t: "producao",
  harvested_area_ha: "area-colhida",
  planted_or_bearing_area_ha: "area-plantada",
  production_value_real_thousand_brl: "valor",
  yield: "rendimento",
};

export interface SeriesRange {
  id: string;
  firstYear: number;
  lastYear: number;
  /** The measures that start after the series, with their first year (the first year in
   *  which any municipality of the matrix has a value). */
  measureFirst?: Partial<Record<Measure, number>>;
}

/** A year moved to the first year of its measure, which starts after the series. */
export interface MovedYear {
  from: number;
  to: number;
}

export interface ExploreView {
  series: string;
  measure: Measure;
  year: number;
  uf: string | null;
}

const invert = <T extends string>(map: Record<T, string>) =>
  Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k])) as Record<string, T>;
const SERIES_BY_SLUG = invert(SERIES_SLUG);
const MEASURE_BY_SLUG = invert(MEASURE_SLUG);

/** The years a series offers for a measure: a measure that starts later, from its first year. */
export function yearRange(range: SeriesRange, measure: Measure): { first: number; last: number } {
  return { first: Math.max(range.firstYear, range.measureFirst?.[measure] ?? range.firstYear), last: range.lastYear };
}

/** The year inside the series and, with a measure, inside the measure's years. */
export function clampYear(range: SeriesRange, year: number, measure: Measure = "production_t"): number {
  const { first, last } = yearRange(range, measure);
  return Math.min(last, Math.max(first, year));
}

/**
 * The view with a new measure or series: the year is kept inside the series (silently) and
 * inside the measure's years, and a move made by the measure is reported.
 */
export function withYearFor(
  range: SeriesRange,
  view: ExploreView,
  next: Pick<ExploreView, "series" | "measure">,
): { view: ExploreView; moved: MovedYear | null } {
  const inSeries = clampYear(range, view.year);
  const year = clampYear(range, inSeries, next.measure);
  return {
    view: { ...view, ...next, year },
    moved: year !== inSeries ? { from: inSeries, to: year } : null,
  };
}

export function parseView(
  search: string,
  series: readonly SeriesRange[],
  ufs: readonly string[],
  fallback: ExploreView,
): ExploreView {
  return readView(search, series, ufs, fallback).view;
}

/** The view of a permanent link, and the move of its year, if its measure started later. */
export function readView(
  search: string,
  series: readonly SeriesRange[],
  ufs: readonly string[],
  fallback: ExploreView,
): { view: ExploreView; moved: MovedYear | null } {
  const params = new URLSearchParams(search);
  const seriesId = SERIES_BY_SLUG[params.get("serie") ?? ""] ?? fallback.series;
  const range = series.find((s) => s.id === seriesId) ?? series.find((s) => s.id === fallback.series);
  if (!range) throw new Error("no series to explore");
  const measure = MEASURE_BY_SLUG[params.get("medida") ?? ""] ?? fallback.measure;
  const rawYear = Number(params.get("ano"));
  const year = Number.isInteger(rawYear) && rawYear > 0 ? rawYear : fallback.year;
  const uf = (params.get("uf") ?? "").toUpperCase();
  const asked = { series: range.id, measure, year, uf: ufs.includes(uf) ? uf : null };
  return withYearFor(range, asked, asked);
}

export function serializeView(view: ExploreView): string {
  const params = new URLSearchParams({
    serie: SERIES_SLUG[view.series] ?? view.series,
    medida: MEASURE_SLUG[view.measure],
    ano: String(view.year),
  });
  if (view.uf) params.set("uf", view.uf);
  return `?${params.toString()}`;
}
