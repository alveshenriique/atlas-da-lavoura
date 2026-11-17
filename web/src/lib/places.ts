// Territories of the Explorar side panel: Brazil and the states, read from the place files of
// the data package (places/country.json, places/state/<UF>.json), never summed from the
// municipalities (rule 1 of the data contract). A territory's yield is its production over
// its harvested area, sum over sum, with the same minimum harvested area as the map. Each
// value carries its reference into the file, for the provenance rule. Shared by the build
// (the default ranking, in the HTML) and the browser.
import { isSmallArea, yieldCell } from "./classify";
import type { Measure } from "./explore-view";
import type { FormatName } from "./format";

type Values = (number | null)[];

export interface PlaceSeries {
  years: number[];
  production_t: Values;
  harvested_area_ha: Values;
  planted_or_bearing_area_ha: Values;
  real_value?: { years: number[]; production_value_real_thousand_brl: Values };
}

export interface PlaceFile {
  territory: { level: string; id: number; name: string; state_abbreviation?: string };
  series: Record<string, PlaceSeries | undefined>;
}

export interface TerritoryValue {
  kind: "value" | "small" | "zero" | "nodata";
  value: number | null;
  /** Reference of the value (file#/pointer[!op]|format), when there is one. */
  src: string | null;
}

/** How a measure is printed in the panel. */
export function measureFormat(measure: Measure): FormatName {
  if (measure === "yield") return "int";
  if (measure === "production_value_real_thousand_brl") return "brl";
  return "compact";
}

/** The years and values of a measure in a place file (the real value has its own years). */
function column(series: PlaceSeries, measure: Measure): { years: number[]; values: Values; key: string } {
  if (measure === "production_value_real_thousand_brl") {
    const real = series.real_value;
    return {
      years: real?.years ?? [],
      values: real?.production_value_real_thousand_brl ?? [],
      key: "real_value/production_value_real_thousand_brl",
    };
  }
  const key = measure === "yield" ? "production_t" : measure;
  return { years: series.years, values: series[key], key };
}

/** The value of a measure for a territory in a year, with its reference. */
export function territoryValue(
  file: string,
  place: PlaceFile | undefined,
  seriesId: string,
  measure: Measure,
  year: number,
): TerritoryValue {
  const series = place?.series[seriesId];
  if (!series) return { kind: "nodata", value: null, src: null };
  const { years, values, key } = column(series, measure);
  const i = years.indexOf(year);
  const raw = i >= 0 ? (values[i] ?? null) : null;
  if (raw === null) return { kind: "nodata", value: null, src: null };
  const pointer = `/series/${seriesId}/${key}/${i}`;
  if (measure === "yield") {
    const area = series.harvested_area_ha[i] ?? null;
    const value = yieldCell(raw, area);
    if (value === null) return { kind: "nodata", value: null, src: null };
    if (value === 0) return { kind: "zero", value: 0, src: null };
    return { kind: isSmallArea(area) ? "small" : "value", value, src: `${file}#${pointer}!areayield|int` };
  }
  if (raw === 0) return { kind: "zero", value: 0, src: null };
  return { kind: "value", value: raw, src: `${file}#${pointer}|${measureFormat(measure)}` };
}

/** The whole series of a measure for a territory, for the panel's chart. */
export function territorySeries(
  place: PlaceFile | undefined,
  seriesId: string,
  measure: Measure,
): { years: number[]; values: Values } {
  const series = place?.series[seriesId];
  if (!series) return { years: [], values: [] };
  if (measure !== "yield") {
    const { years, values } = column(series, measure);
    return { years, values };
  }
  return {
    years: series.years,
    values: series.production_t.map((p, i) => yieldCell(p, series.harvested_area_ha[i] ?? null)),
  };
}

export interface RankingRow {
  abbr: string;
  name: string;
  kind: TerritoryValue["kind"];
  value: number | null;
  src: string | null;
  /** Share of Brazil's total (totals only), and its reference. */
  share: number | null;
  shareSrc: string | null;
}

const order: Record<TerritoryValue["kind"], number> = { value: 0, small: 1, zero: 2, nodata: 3 };

/**
 * The states ranked by a measure in a year: comparable values first, largest first; then the
 * yields from too small a harvested area; then the states that produced nothing; then those
 * without data. Totals get their share of Brazil's total.
 */
export function stateRanking(
  states: readonly { abbr: string; name: string; place: PlaceFile | undefined }[],
  countryTotal: number | null,
  seriesId: string,
  measure: Measure,
  year: number,
): RankingRow[] {
  const collator = new Intl.Collator("pt-BR");
  return states
    .map(({ abbr, name, place }) => {
      const file = `places/state/${abbr}.json`;
      const v = territoryValue(file, place, seriesId, measure, year);
      const withShare = measure !== "yield" && v.kind === "value" && countryTotal ? countryTotal : null;
      return {
        abbr,
        name,
        kind: v.kind,
        value: v.value,
        src: v.src,
        share: withShare && v.value !== null ? v.value / withShare : null,
        shareSrc: withShare && v.src ? `${v.src.replace(/\|\w+$/, "")}!share|pct` : null,
      };
    })
    .sort(
      (a, b) =>
        order[a.kind] - order[b.kind] || (b.value ?? 0) - (a.value ?? 0) || collator.compare(a.name, b.name),
    );
}
