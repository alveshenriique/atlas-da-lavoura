import { MIN_YIELD_AREA_HA } from "../src/lib/classify";
import { type PlaceFile, stateRanking, territorySeries, territoryValue } from "../src/lib/places";
import { renderRef } from "../src/lib/provenance";

const place = (abbr: string, production: (number | null)[], area: (number | null)[]): PlaceFile => ({
  territory: { level: "state", id: 1, name: abbr, state_abbreviation: abbr },
  series: {
    soybean: {
      years: [2024, 2025],
      production_t: production,
      harvested_area_ha: area,
      planted_or_bearing_area_ha: area,
      real_value: { years: [2025], production_value_real_thousand_brl: [production[1] ?? null] },
    },
  },
});

const states = [
  { abbr: "MT", name: "Mato Grosso", place: place("MT", [40_000_000, 50_000_000], [12_000_000, 12_500_000]) },
  { abbr: "PR", name: "Paraná", place: place("PR", [20_000_000, 22_000_000], [5_500_000, 5_600_000]) },
  { abbr: "AM", name: "Amazonas", place: place("AM", [100, 300], [50, 60]) },
  { abbr: "AC", name: "Acre", place: place("AC", [0, 0], [0, 0]) },
  { abbr: "AP", name: "Amapá", place: place("AP", [null, null], [null, null]) },
];

describe("territories of the side panel", () => {
  it("read a total and cite its place in the file", () => {
    const v = territoryValue("places/state/MT.json", states[0]?.place, "soybean", "production_t", 2025);
    expect(v).toEqual({ kind: "value", value: 50_000_000, src: "places/state/MT.json#/series/soybean/production_t/1|compact" });
    const real = territoryValue("places/state/MT.json", states[0]?.place, "soybean", "production_value_real_thousand_brl", 2025);
    expect(real.src).toBe("places/state/MT.json#/series/soybean/real_value/production_value_real_thousand_brl/0|brl");
    expect(territoryValue("x.json", states[0]?.place, "soybean", "production_value_real_thousand_brl", 2024).kind).toBe(
      "nodata",
    );
  });

  it("take the yield as production over harvested area, flagging a small area", () => {
    const mt = territoryValue("places/state/MT.json", states[0]?.place, "soybean", "yield", 2025);
    expect(mt.value).toBe(4000);
    expect(mt.src).toBe("places/state/MT.json#/series/soybean/production_t/1!areayield|int");
    const am = territoryValue("places/state/AM.json", states[2]?.place, "soybean", "yield", 2025);
    expect(am.kind).toBe("small");
    expect(60).toBeLessThan(MIN_YIELD_AREA_HA);
    expect(territorySeries(states[0]?.place, "soybean", "yield").values).toEqual([(40_000_000 / 12_000_000) * 1000, 4000]);
  });

  it("rank the states, with the share of Brazil for totals", () => {
    const rows = stateRanking(states, 72_000_300, "soybean", "production_t", 2025);
    expect(rows.map((r) => r.abbr)).toEqual(["MT", "PR", "AM", "AC", "AP"]);
    expect(rows.map((r) => r.kind)).toEqual(["value", "value", "value", "zero", "nodata"]);
    expect(rows[0]?.shareSrc).toBe("places/state/MT.json#/series/soybean/production_t/1!share|pct");
    const country = { series: { soybean: { production_t: [60_000_100, 72_000_300] } } };
    const ref = rows[0]?.shareSrc ?? "";
    const [file, rest = ""] = ref.split("#");
    const [pointer = "", tail = ""] = rest.split("!");
    expect(renderRef({ file: file ?? "", pointer, op: "share", format: "pct" }, states[0]?.place, null, country)).toBe(
      "69%",
    );
    expect(tail).toBe("share|pct");
  });

  it("put the small-area yields after the comparable ones, and give the yield no share", () => {
    const rows = stateRanking(states, 72_000_300, "soybean", "yield", 2025);
    expect(rows.map((r) => r.abbr)).toEqual(["MT", "PR", "AM", "AC", "AP"]);
    expect(rows[2]?.kind).toBe("small");
    expect(rows.every((r) => r.share === null && r.shareSrc === null)).toBe(true);
  });
});
