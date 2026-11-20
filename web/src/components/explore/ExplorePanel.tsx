// The side panel of the Explorar: the series of Brazil (or of the state in focus) for the
// series and measure of the map, with the year of the map marked, and the states ranked in
// that year, with their share of Brazil's total. It holds no view of its own: the view, and
// the way to change it, come from the map (ExploreView), whose URL is the source of truth.
// Totals come from the territorial levels the data package publishes (the matrices' country
// total, the state files), never summed from municipalities; a yield is sum over sum.
import { useEffect, useMemo, useRef, useState } from "react";

import { yieldCell } from "../../lib/classify";
import type { ExploreView as View, Measure } from "../../lib/explore-view";
import { format } from "../../lib/format";
import { measureFormat, type PlaceFile, type RankingRow, stateRanking, territorySeries, territoryValue } from "../../lib/places";
import { type ExploreFile, fetchJson } from "./data";

export interface DefaultRanking {
  series: string;
  measure: Measure;
  year: number;
  rows: RankingRow[];
}

interface Props {
  dataBase: string;
  view: View;
  ufs: { abbr: string; name: string }[];
  /** The explore matrices the map has loaded, by file name. */
  files: Record<string, ExploreFile>;
  measureLabel: string;
  /** The series as the title sentence names it ("soja", "café arábica"). */
  seriesPhrase: string;
  unit: string;
  firstYear: number;
  /** The first year of the measure (later than the series' for the value and the planted
   *  area): the line starts there, as the timeline does. */
  fromYear: number;
  defaultRanking: DefaultRanking;
  /** Puts a state in focus on the map (or Brazil, with null). */
  onFocus: (uf: string | null) => void;
  /** Moves the map to a year. */
  onYear: (year: number) => void;
}

const SHOWN = 10;
const fileOf = (series: string, measure: string) => `explore/${series}/${measure}.json`;

interface Point {
  year: number;
  value: number | null;
}

export default function ExplorePanel(props: Props) {
  const { dataBase, view, ufs, files, measureLabel, unit } = props;
  const isYield = view.measure === "yield";
  const fmt = measureFormat(view.measure);
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [places, setPlaces] = useState<Record<string, PlaceFile>>({});
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);

  // The state files load only when the panel is on screen (on a phone it is below the map).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || visible) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [visible]);

  const usesDefault =
    view.series === props.defaultRanking.series &&
    view.measure === props.defaultRanking.measure &&
    view.year === props.defaultRanking.year;
  const needed = useMemo(() => {
    const out = new Set<string>();
    if (view.uf) out.add(view.uf);
    if (!usesDefault) for (const u of ufs) out.add(u.abbr);
    return [...out];
  }, [view.uf, usesDefault, ufs]);

  useEffect(() => {
    if (!visible) return;
    for (const abbr of needed) {
      if (places[abbr]) continue;
      fetchJson<PlaceFile>(dataBase, `places/state/${abbr}.json`)
        .then((place) => setPlaces((loaded) => ({ ...loaded, [abbr]: place })))
        .catch(() => setFailed(true));
    }
  }, [visible, needed, places, dataBase]);

  // Brazil: the country total of the matrices the map already has (sum over sum for yield).
  const national = useMemo((): { points: Point[]; srcAt: (year: number) => string | null } | null => {
    const main = files[fileOf(view.series, isYield ? "production_t" : view.measure)];
    const area = isYield ? files[fileOf(view.series, "harvested_area_ha")] : undefined;
    if (!main || (isYield && !area)) return null;
    const points = main.years.map((year, col) => {
      const total = main.country_total[col] ?? null;
      if (!isYield) return { year, value: total };
      const a = area?.country_total[col] ?? null;
      return { year, value: yieldCell(total, a) };
    });
    const srcAt = (year: number) => {
      const col = main.years.indexOf(year);
      if (col < 0) return null;
      return isYield
        ? `${fileOf(view.series, "production_t")}#/country_total/${col}!yield|int`
        : `${fileOf(view.series, view.measure)}#/country_total/${col}|${fmt}`;
    };
    return { points, srcAt };
  }, [files, view.series, view.measure, isYield, fmt]);

  const countryTotalAt = (year: number) => national?.points.find((p) => p.year === year)?.value ?? null;

  // The territory in focus: Brazil, or the state, from its place file.
  const focusPlace = view.uf ? places[view.uf] : undefined;
  const focusName = view.uf ? (ufs.find((u) => u.abbr === view.uf)?.name ?? view.uf) : "Brasil";
  const series: Point[] | null = (
    view.uf
      ? focusPlace
        ? (() => {
            const s = territorySeries(focusPlace, view.series, view.measure);
            return s.years.map((year, i) => ({ year, value: s.values[i] ?? null }));
          })()
        : null
      : (national?.points ?? null)
  )?.filter((p) => p.year >= props.fromYear) ?? null;
  const current = view.uf
    ? territoryValue(`places/state/${view.uf}.json`, focusPlace, view.series, view.measure, view.year)
    : (() => {
        const value = countryTotalAt(view.year);
        const src = national?.srcAt(view.year) ?? null;
        if (value === null || !src) return { kind: "nodata" as const, value: null, src: null };
        return { kind: value === 0 ? ("zero" as const) : ("value" as const), value, src };
      })();
  const focusShare =
    view.uf && !isYield && current.kind === "value" && current.src
      ? `${current.src.replace(/\|\w+$/, "")}!share|pct`
      : null;
  const focusShareValue =
    focusShare && current.value !== null ? current.value / (countryTotalAt(view.year) ?? Number.NaN) : null;

  // The ranking: built into the page for the default view, from the state files otherwise.
  const ranking: RankingRow[] | null = useMemo(() => {
    if (usesDefault) return props.defaultRanking.rows;
    if (ufs.some((u) => !places[u.abbr])) return null;
    return stateRanking(
      ufs.map((u) => ({ ...u, place: places[u.abbr] })),
      countryTotalAt(view.year),
      view.series,
      view.measure,
      view.year,
    );
    // countryTotalAt reads `national`, listed instead.
  }, [usesDefault, props.defaultRanking, ufs, places, national, view.series, view.measure, view.year]);
  const topValue = ranking?.find((r) => r.kind === "value")?.value ?? null;

  const yearSrc = `${fileOf(view.series, "production_t")}#/years/${view.year - props.firstYear}|year`;
  const valueText = (value: number | null, src: string | null, kind: string) => {
    if (kind === "nodata") return <span>sem dado</span>;
    if (kind === "zero") return <span>não produziu</span>;
    return (
      <span className="num" data-src={src ?? undefined}>
        {format(value, fmt)}
      </span>
    );
  };
  // Next to the large number, the unit is short ("t", not "t de café beneficiado"); what it
  // is a ton of goes in the line under the number, and the series in the line above.
  const shortUnit = unit.replace(/ de .+$/, "");
  const unitAfter = fmt === "brl" ? "" : shortUnit;
  const unitDetail = shortUnit !== unit ? `, em ${unit}` : "";

  return (
    <aside className="explore__panel explore-panel" aria-label={`Painel: ${focusName}`}>
      {/* The number of the territory apart from the rest: on a phone it comes right after the
          title, and the series and the states after the map (explore.css). */}
      <div className="explore-panel__head">
      <p className="explore-panel__kicker kicker">
        {focusName} · {props.seriesPhrase} ·{" "}
        <span className="num" data-src={yearSrc}>
          {format(view.year, "year")}
        </span>
      </p>
      <p className="explore-panel__number">
        {valueText(current.value, current.src, current.kind)}
        {(current.kind === "value" || current.kind === "small") && unitAfter ? (
          <span className="explore-panel__unit">{unitAfter}</span>
        ) : null}
      </p>
      <p className="explore-panel__sub small">
        {measureLabel}
        {unitDetail}
        {focusShare && focusShareValue !== null && Number.isFinite(focusShareValue) ? (
          <>
            {" "}
            ·{" "}
            <span className="num" data-src={focusShare}>
              {format(focusShareValue, "pct")}
            </span>{" "}
            do Brasil
          </>
        ) : null}
        {current.kind === "small" ? " · área colhida pequena demais para comparar" : null}
      </p>
      </div>

      {/* Observed for the state files: on a phone the aside has no box of its own. */}
      <div className="explore-panel__body" ref={rootRef}>
      <SeriesChart
        points={series}
        year={view.year}
        onYear={props.onYear}
        label={`${measureLabel} ao longo dos anos, ${focusName}`}
        srcAt={(year) =>
          view.uf
            ? territoryValue(`places/state/${view.uf}.json`, focusPlace, view.series, view.measure, year).src
            : (national?.srcAt(year) ?? null)
        }
        yearSrc={(year) => `${fileOf(view.series, "production_t")}#/years/${year - props.firstYear}|year`}
        fmt={fmt}
      />

      <h2 className="explore-panel__title kicker">
        Estados em{" "}
        <span className="num" data-src={yearSrc}>
          {format(view.year, "year")}
        </span>
      </h2>
      <p className="ranking__caption small">
        {measureLabel}
        {fmt === "brl" ? "" : `, em ${unit}`}
        {isYield ? "" : ", e participação no Brasil"}
      </p>
      {ranking ? (
        <>
          <ol className="ranking" data-structural="list" aria-label={`Ranking dos estados, ${measureLabel}`}>
            {/* Each item carries its rank: the rows move in place when the view changes, and
                a browser does not always renumber the items that move (Chrome kept the old
                numbers). */}
            {ranking.map((row, k) => (
              <li key={row.abbr} value={k + 1} className="ranking__row" hidden={!expanded && k >= SHOWN}>
                <button
                  type="button"
                  className="ranking__button"
                  aria-current={view.uf === row.abbr ? "true" : undefined}
                  onClick={() => props.onFocus(view.uf === row.abbr ? null : row.abbr)}
                >
                  <span className="ranking__name">{row.name}</span>
                  <span className="ranking__value small">
                    {valueText(row.value, row.src, row.kind)}
                    {row.kind === "small" ? <span className="ranking__flag"> área pequena</span> : null}
                  </span>
                  {row.share !== null && row.shareSrc ? (
                    <span className="ranking__share small num" data-src={row.shareSrc}>
                      {format(row.share, "pct")}
                    </span>
                  ) : (
                    <span className="ranking__share" aria-hidden="true" />
                  )}
                  <span
                    className="ranking__bar"
                    aria-hidden="true"
                    style={{
                      width: `${row.kind === "value" && row.value !== null && topValue ? (100 * row.value) / topValue : 0}%`,
                    }}
                  />
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="ranking__more small"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "Mostrar menos UFs" : "Mostrar todas as UFs"}
          </button>
          <p className="ranking__hint small">Escolha um estado para vê-lo no mapa.</p>
        </>
      ) : (
        <p className="ranking__status small" role="status">
          {failed ? "Não foi possível carregar os estados." : visible ? "Carregando os estados…" : ""}
        </p>
      )}
      </div>
    </aside>
  );
}

interface ChartProps {
  points: Point[] | null;
  year: number;
  onYear: (year: number) => void;
  label: string;
  srcAt: (year: number) => string | null;
  yearSrc: (year: number) => string;
  fmt: ReturnType<typeof measureFormat>;
}

const W = 300;
const H = 110;

/** A small line of the series over the years, with the map's year marked. */
function SeriesChart({ points, year, onYear, label, srcAt, yearSrc, fmt }: ChartProps) {
  if (!points || points.length === 0) return <div className="series-chart series-chart--empty" aria-hidden="true" />;
  const first = points[0]?.year ?? year;
  const last = points.at(-1)?.year ?? year;
  const max = Math.max(0, ...points.map((p) => p.value ?? 0));
  const x = (y: number) => (last === first ? W / 2 : ((y - first) / (last - first)) * W);
  const yOf = (v: number) => (max > 0 ? H - (v / max) * H : H);
  let d = "";
  let drawing = false;
  for (const p of points) {
    if (p.value === null) {
      drawing = false;
      continue;
    }
    d += `${drawing ? "L" : "M"}${x(p.year).toFixed(1)},${yOf(p.value).toFixed(1)}`;
    drawing = true;
  }
  const atYear = points.find((p) => p.year === year);
  const peak = points.reduce<Point | null>((best, p) => (p.value !== null && (best === null || p.value > (best.value ?? -1)) ? p : best), null);
  const peakSrc = peak ? srcAt(peak.year) : null;
  const pick = (event: React.MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const t = (event.clientX - box.left) / box.width;
    const target = Math.round(first + t * (last - first));
    if (points.some((p) => p.year === target)) onYear(target);
  };
  const inRange = year >= first && year <= last;
  return (
    <figure className="series-chart">
      <div className="series-chart__plot" onClick={pick} role="presentation">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <path className="series-chart__line" d={d} />
          {inRange && (
            <line className="series-chart__year" x1={x(year)} x2={x(year)} y1={0} y2={H} />
          )}
          {atYear?.value !== null && atYear?.value !== undefined && (
            <circle className="series-chart__dot" cx={x(year)} cy={yOf(atYear.value)} r={3} />
          )}
        </svg>
        {peak && peakSrc && peak.value !== null && (
          <span
            className="series-chart__peak small"
            style={{
              left: `${(x(peak.year) / W) * 100}%`,
              // Near an edge, the label hangs to the inside of the chart.
              transform: x(peak.year) > 0.75 * W ? "translateX(-100%)" : x(peak.year) < 0.25 * W ? "none" : undefined,
            }}
          >
            <span className="num" data-src={peakSrc}>
              {format(peak.value, fmt)}
            </span>
          </span>
        )}
      </div>
      <figcaption className="series-chart__axis meta">
        <span className="num" data-src={yearSrc(first)}>
          {format(first, "year")}
        </span>
        <span className="visually-hidden">{label}</span>
        <span className="num" data-src={yearSrc(last)}>
          {format(last, "year")}
        </span>
      </figcaption>
    </figure>
  );
}
