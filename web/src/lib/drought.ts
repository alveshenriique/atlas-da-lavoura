// How the municipality page reads the drought risk of an immediate region: the region within
// the whole set, never as if it stood alone (docs/DECISOES.md, "Leitura do risco de seca").
//
// The reading is decided by the measure the page shows, the main finding's: the comparison
// of the drought harvests with the others (their mean yield anomaly against the others', and
// the share of them below the trend against the share of all harvests). One region has about
// 35 harvests and a handful with drought, so a test on it alone has little power: not
// confirming is a lack of evidence, not evidence that there is no association, and the page
// must never suggest that there is no risk. The readings:
// - `shows`: both comparisons go the set's way (lower mean, larger share below the trend)
//   and Welch's one-sided t test at 5% confirms the lower mean;
// - `unconfirmed`: both go the set's way, without that confirmation: the region's series is
//   short to confirm it alone; the set's result follows;
// - `not-here`: the comparisons do not both go the set's way;
// - `few`: fewer than MIN_DROUGHT_HARVESTS drought harvests, too few to compare.
// The correlation between water balance and yield over all harvests is complementary: when
// it disagrees with the comparison (practically zero or negative where the comparison goes
// the set's way, or positive where it does not), the page says so. No correction for the
// many regions: each page reads one region. The harvests are exactly those of the summary
// (the reading fails if they are not).
import { correlationPValue, welchLessPValue } from "./stats";

export const DROUGHT_ALPHA = 0.05;
export const MIN_DROUGHT_HARVESTS = 3;
/** Below it a correlation is practically zero (Cohen's "small" effect size, 0.1). */
export const NEGLIGIBLE_CORRELATION = 0.1;

export type DroughtReadingKind = "shows" | "unconfirmed" | "not-here" | "few";
/** The correlation over all harvests, against the comparison of the drought harvests. */
export type CorrelationReading = "agrees" | "flat-while-comparison-holds" | "positive-while-comparison-fails" | "none";

export interface ClimateYears {
  harvest_year: number[];
  yield_anomaly: (number | null)[];
  is_water_deficit: (boolean | null)[];
}

export interface ClimateSummary {
  n_years: number;
  first_year: number | null;
  last_year: number | null;
  water_deficit_years: number | null;
  corr_water_balance_yield: number | null;
  mean_anomaly_water_deficit_years?: number | null;
  mean_anomaly_no_water_deficit_years?: number | null;
  water_deficit_hit_rate?: number | null;
  negative_anomaly_share_all_years?: number | null;
}

export interface DroughtReading {
  kind: DroughtReadingKind;
  correlation: CorrelationReading;
  /** One-sided p-values of the two tests (1 when a test cannot run). */
  correlationP: number;
  fallP: number;
  /** Indexes, in the years table, of the harvests the summary counts. */
  rows: number[];
}

/** The harvests of the summary: within its years, with an anomaly and a drought class. */
export function summaryRows(years: ClimateYears, summary: ClimateSummary): number[] {
  const first = summary.first_year ?? Infinity;
  const last = summary.last_year ?? -Infinity;
  return years.harvest_year.flatMap((year, i) =>
    year >= first &&
    year <= last &&
    years.yield_anomaly[i] !== null &&
    years.yield_anomaly[i] !== undefined &&
    years.is_water_deficit[i] !== null &&
    years.is_water_deficit[i] !== undefined
      ? [i]
      : [],
  );
}

export function droughtReading(years: ClimateYears, summary: ClimateSummary): DroughtReading {
  const rows = summaryRows(years, summary);
  const drought = rows.filter((i) => years.is_water_deficit[i] === true);
  if (rows.length !== summary.n_years || drought.length !== (summary.water_deficit_years ?? 0)) {
    throw new Error(
      `the harvests of the years table (${rows.length}, ${drought.length} with drought) are not the summary's (${summary.n_years}, ${summary.water_deficit_years})`,
    );
  }
  const anomaly = (i: number) => years.yield_anomaly[i] ?? 0;
  const others = rows.filter((i) => years.is_water_deficit[i] === false);
  const correlationP =
    summary.corr_water_balance_yield === null ? 1 : correlationPValue(summary.corr_water_balance_yield, rows.length);
  const fallP = welchLessPValue(drought.map(anomaly), others.map(anomaly));
  const r = summary.corr_water_balance_yield;
  if (drought.length < MIN_DROUGHT_HARVESTS) {
    return { kind: "few", correlation: "none", correlationP, fallP, rows };
  }
  // The comparison the page prints, from the published summary.
  const lower =
    (summary.mean_anomaly_water_deficit_years ?? Infinity) < (summary.mean_anomaly_no_water_deficit_years ?? -Infinity);
  const moreBelow = (summary.water_deficit_hit_rate ?? -Infinity) > (summary.negative_anomaly_share_all_years ?? Infinity);
  const setsWay = lower && moreBelow;
  const kind: DroughtReadingKind = !setsWay ? "not-here" : fallP < DROUGHT_ALPHA ? "shows" : "unconfirmed";
  const positive = r !== null && r >= NEGLIGIBLE_CORRELATION;
  const correlation: CorrelationReading =
    r === null
      ? "none"
      : setsWay && !positive
        ? "flat-while-comparison-holds"
        : !setsWay && positive
          ? "positive-while-comparison-fails"
          : "agrees";
  return { kind, correlation, correlationP, fallP, rows };
}
