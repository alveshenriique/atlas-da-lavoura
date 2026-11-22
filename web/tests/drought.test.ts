// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { DROUGHT_ALPHA, droughtReading, MIN_DROUGHT_HARVESTS, NEGLIGIBLE_CORRELATION } from "../src/lib/drought";

// Thirty harvests with a little noise; the drought ones fall (or not), and the summary is
// computed from them, as the published one is.
function region(opts: { falls: number; correlation: number; droughts: number }) {
  const n = 30;
  const harvest_year = Array.from({ length: n }, (_, k) => 1991 + k);
  const step = Math.floor(n / opts.droughts);
  const drought = harvest_year.map((_, k) => k % step === 0 && k / step < opts.droughts);
  const yield_anomaly = harvest_year.map((_, k) => Math.sin(k * 2.7) * 0.03 + (drought[k] ? -opts.falls : 0));
  const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const dry = yield_anomaly.filter((_, k) => drought[k]);
  const wet = yield_anomaly.filter((_, k) => !drought[k]);
  return {
    years: { harvest_year, yield_anomaly, is_water_deficit: drought },
    summary: {
      n_years: n,
      first_year: 1991,
      last_year: 2020,
      water_deficit_years: dry.length,
      corr_water_balance_yield: opts.correlation,
      mean_anomaly_water_deficit_years: dry.length ? mean(dry) : null,
      mean_anomaly_no_water_deficit_years: mean(wet),
      water_deficit_hit_rate: dry.length ? dry.filter((v) => v < 0).length / dry.length : null,
      negative_anomaly_share_all_years: yield_anomaly.filter((v) => v < 0).length / n,
    },
  };
}

describe("the reading of a region's drought risk", () => {
  it("decides by the comparison the page shows, and says when the correlation disagrees", () => {
    const read = (o: Parameters<typeof region>[0]) => {
      const r = region(o);
      const reading = droughtReading(r.years, r.summary);
      return [reading.kind, reading.correlation];
    };
    expect(read({ falls: 0.15, correlation: 0.6, droughts: 6 })).toEqual(["shows", "agrees"]);
    // The set's way, confirmed, while the correlation over all harvests is flat (Sorriso).
    expect(read({ falls: 0.15, correlation: -0.01, droughts: 6 })).toEqual(["shows", "flat-while-comparison-holds"]);
    // The set's way, but too small a fall to confirm alone.
    expect(read({ falls: 0.02, correlation: 0.3, droughts: 6 })).toEqual(["unconfirmed", "agrees"]);
    // Drought harvests that did not fall: not here, even with a positive correlation.
    expect(read({ falls: -0.05, correlation: 0.3, droughts: 6 })).toEqual(["not-here", "positive-while-comparison-fails"]);
    expect(read({ falls: -0.05, correlation: 0.02, droughts: 6 })).toEqual(["not-here", "agrees"]);
    expect(read({ falls: 0.15, correlation: 0.6, droughts: MIN_DROUGHT_HARVESTS - 1 })).toEqual(["few", "none"]);
    expect([DROUGHT_ALPHA, NEGLIGIBLE_CORRELATION]).toEqual([0.05, 0.1]);
  });

  it("refuses harvests that are not the summary's", () => {
    const r = region({ falls: 0.15, correlation: 0.6, droughts: 6 });
    expect(() => droughtReading(r.years, { ...r.summary, n_years: 29 })).toThrow(/not the summary's/);
  });

  it("reads exactly the harvests of every published summary", () => {
    const release = JSON.parse(readFileSync(path.join("..", "data-release.json"), "utf8")) as { data_version: string };
    const dir = path.join("public", "data", release.data_version, "places", "region");
    let read = 0;
    for (const file of readdirSync(dir)) {
      const place = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      for (const block of Object.values<any>(place.climate ?? {})) {
        if (!block.summary) continue;
        expect(() => droughtReading(block.years, block.summary), file).not.toThrow();
        read++;
      }
    }
    expect(read).toBeGreaterThan(0);
  });
});
