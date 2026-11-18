import { type ExploreView, parseView, readView, serializeView, withYearFor, yearRange } from "../src/lib/explore-view";

const late = { production_value_real_thousand_brl: 1995, planted_or_bearing_area_ha: 1988 };
const series = [
  { id: "soybean", firstYear: 1974, lastYear: 2025, measureFirst: late },
  { id: "coffee_in_husk", firstYear: 1974, lastYear: 2001, measureFirst: late },
  { id: "coffee_processed", firstYear: 2002, lastYear: 2025 },
];
const ufs = ["MT", "PR"];
const fallback: ExploreView = { series: "soybean", measure: "production_t", year: 2025, uf: null };

describe("Explorar view in the URL", () => {
  it("round-trips through a readable query string", () => {
    const view: ExploreView = { series: "coffee_processed", measure: "yield", year: 2010, uf: "PR" };
    const search = serializeView(view);
    expect(search).toBe("?serie=cafe-beneficiado&medida=rendimento&ano=2010&uf=PR");
    expect(parseView(search, series, ufs, fallback)).toEqual(view);
  });

  it("falls back to the default for anything unknown", () => {
    expect(parseView("?serie=trigo&medida=preco&ano=abc&uf=XX", series, ufs, fallback)).toEqual(fallback);
    expect(parseView("", series, ufs, fallback)).toEqual(fallback);
  });

  it("keeps the year inside the series, so coffee never crosses the 2002 break", () => {
    expect(parseView("?serie=cafe-em-coco&ano=2025", series, ufs, fallback).year).toBe(2001);
    expect(parseView("?serie=cafe-beneficiado&ano=1990", series, ufs, fallback).year).toBe(2002);
  });

  it("starts a later measure at its own first year, and reports a year moved there", () => {
    const soybean = series[0]!;
    expect(yearRange(soybean, "production_value_real_thousand_brl")).toEqual({ first: 1995, last: 2025 });
    expect(yearRange(soybean, "planted_or_bearing_area_ha")).toEqual({ first: 1988, last: 2025 });
    expect(yearRange(soybean, "production_t")).toEqual({ first: 1974, last: 2025 });
    expect(readView("?serie=soja&medida=area-plantada&ano=1980", series, ufs, fallback).moved).toEqual({
      from: 1980,
      to: 1988,
    });
    expect(readView("?serie=soja&medida=valor&ano=1975", series, ufs, fallback)).toEqual({
      view: { series: "soybean", measure: "production_value_real_thousand_brl", year: 1995, uf: null },
      moved: { from: 1975, to: 1995 },
    });
    expect(readView("?serie=soja&medida=valor&ano=2000", series, ufs, fallback).moved).toBeNull();
    // Choosing the value from 1980 moves to 1995; choosing the production keeps the year.
    const at1980: ExploreView = { ...fallback, year: 1980 };
    expect(withYearFor(soybean, at1980, { series: "soybean", measure: "production_value_real_thousand_brl" })).toEqual({
      view: { ...at1980, measure: "production_value_real_thousand_brl", year: 1995 },
      moved: { from: 1980, to: 1995 },
    });
    expect(withYearFor(soybean, at1980, { series: "soybean", measure: "yield" }).moved).toBeNull();
    // The coffee break moves the year without a report: that is the series' range, not the
    // measure's (and its value starts with the series).
    const coffee = series[2]!;
    expect(withYearFor(coffee, at1980, { series: "coffee_processed", measure: "production_value_real_thousand_brl" })).toEqual({
      view: { ...at1980, series: "coffee_processed", measure: "production_value_real_thousand_brl", year: 2002 },
      moved: null,
    });
  });
});
