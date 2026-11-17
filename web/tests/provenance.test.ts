import { MINUS } from "../src/lib/format";
import {
  getPointer,
  numberTokens,
  parseRef,
  parseRefs,
  renderRef,
  resolveRef,
  rowRefs,
  serializeRef,
  siblingFile,
} from "../src/lib/provenance";

const doc = {
  headline: { share: 0.7273, years: [1991, 2025] },
  table: { year: [2004, 2005], anomaly: [0.12, -0.6598] },
  source: { citation: "Xavier, A. C. (2022). New improved data (1961–2020)." },
  "a/b": 1,
};

describe("references", () => {
  it("round-trip through their text form", () => {
    const text = "analysis.json#/headline/share|pct";
    expect(serializeRef(parseRef(text))).toBe(text);
    expect(parseRefs("a.json#/x!max|year;b.json#/y|int")).toEqual([
      { file: "a.json", pointer: "/x", op: "max", format: "year" },
      { file: "b.json", pointer: "/y", format: "int" },
    ]);
  });

  it("reject malformed text, unknown operations and unknown formats", () => {
    expect(() => parseRef("analysis.json/headline|pct")).toThrow();
    expect(() => parseRef("analysis.json#/headline!median|pct")).toThrow();
    expect(() => parseRef("analysis.json#/headline|money")).toThrow();
  });

  it("follow RFC 6901 pointers, with escapes", () => {
    expect(getPointer(doc, "/table/anomaly/1")).toBe(-0.6598);
    expect(getPointer(doc, "/a~1b")).toBe(1);
    expect(() => getPointer(doc, "/table/anomaly/2")).toThrow();
    expect(() => getPointer(doc, "/nothing")).toThrow();
  });

  it("build one reference per column for a table row", () => {
    expect(rowRefs("analysis.json#/table", "year|year,anomaly|spct", 1).map(serializeRef)).toEqual([
      "analysis.json#/table/year/1|year",
      "analysis.json#/table/anomaly/1|spct",
    ]);
  });

  it("apply the operations", () => {
    const ref = (pointer: string, op?: "max" | "count" | "year" | "within" | "member") =>
      op ? parseRef(`x.json#${pointer}!${op}|text`) : parseRef(`x.json#${pointer}|text`);
    expect(resolveRef(ref("/headline/years", "max"), doc)).toBe(2025);
    expect(resolveRef(ref("/headline/years", "count"), doc)).toBe(2);
    const crops = { crop: ["coffee_arabica", "soybean", "soybean"] };
    const countSoy = parseRef("x.json#/crop!count:soybean|int");
    expect(serializeRef(countSoy)).toBe("x.json#/crop!count:soybean|int");
    expect(resolveRef(countSoy, crops)).toBe(2);
    expect(() => parseRef("x.json#/crop!max:soybean|int")).toThrow();
    expect(resolveRef(ref("/source/citation", "year"), doc)).toBe(2022);
    expect(resolveRef(ref("/table/anomaly", "within"), doc, "-0.4")).toBe(-0.4);
    expect(() => resolveRef(ref("/table/anomaly", "within"), doc, "-0.8")).toThrow();
    expect(resolveRef(ref("/table/year", "member"), doc, "2005")).toBe(2005);
    expect(() => resolveRef(ref("/table/year", "member"), doc, "2006")).toThrow();
    expect(() => resolveRef(ref("/table/year", "member"), doc, null)).toThrow();
  });

  it("render with the reference's format", () => {
    expect(renderRef(parseRef("x.json#/headline/share|pct"), doc)).toBe("73%");
    expect(renderRef(parseRef("x.json#/table/anomaly/1|spct"), doc)).toBe(`${MINUS}66%`);
  });
});

describe("number tokens", () => {
  it("split a text into the numbers as printed", () => {
    expect(numberTokens(`De 1991–2025, ${MINUS}9% contra +3% em 19.237 células; r = 0,75.`)).toEqual([
      "1991",
      "2025",
      `${MINUS}9%`,
      "+3%",
      "19.237",
      "0,75",
    ]);
    expect(numberTokens("Versão 2026.11.10")).toEqual(["2026.11.10"]);
    expect(numberTokens("BR-DWGD, sem números")).toEqual([]);
  });
});

describe("territory operations", () => {
  const country = { series: { soybean: { production_t: [100, 200], harvested_area_ha: [50, 80] } } };
  const state = { series: { soybean: { production_t: [30, 50], harvested_area_ha: [10, 0] } } };

  it("share a state's value of Brazil's at the same place", () => {
    const ref = parseRef("places/state/MT.json#/series/soybean/production_t/1!share|pct");
    expect(siblingFile(ref)).toBe("places/country.json");
    expect(resolveRef(ref, state, null, country)).toBe(0.25);
    expect(renderRef(ref, state, null, country)).toBe("25%");
  });

  it("take a territory's yield as its production over its harvested area", () => {
    const ref = parseRef("places/country.json#/series/soybean/production_t/1!areayield|int");
    expect(resolveRef(ref, country)).toBe(2500);
    expect(() =>
      resolveRef(parseRef("places/state/MT.json#/series/soybean/production_t/1!areayield|int"), state),
    ).toThrow(/no yield/);
    expect(() =>
      resolveRef(parseRef("places/country.json#/series/soybean/harvested_area_ha/1!areayield|int"), country),
    ).toThrow(/production/);
  });
});

