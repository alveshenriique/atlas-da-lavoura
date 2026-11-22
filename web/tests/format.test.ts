import { format, MINUS } from "../src/lib/format";
import { tokens } from "../src/lib/tokens";

describe("format", () => {
  it("prints fractions as whole percentages", () => {
    expect(format(0.7273, "pct")).toBe("73%");
    expect(format(0.4302, "pct")).toBe("43%");
    expect(format(1, "pct")).toBe("100%");
    // Thousands are grouped, as in every other number of the site.
    expect(format(14.9277, "spct")).toBe("+1.493%");
  });

  it("signs percentages with the minus sign and a plus", () => {
    expect(format(-0.0899, "spct")).toBe(`${MINUS}9%`);
    expect(format(0.0306, "spct")).toBe("+3%");
    expect(format(-0.004, "spct")).toBe("0%");
    expect(format(0, "spct")).toBe("0%");
  });

  it("groups thousands the Brazilian way, even with four digits", () => {
    expect(format(19237, "int")).toBe("19.237");
    expect(format(5571, "int")).toBe("5.571");
    expect(format(537, "int")).toBe("537");
    expect(format(-53, "int")).toBe(`${MINUS}53`);
  });

  it("writes a count without its sign when the words around it carry the sense", () => {
    expect(format(-4, "absint")).toBe("4");
    expect(format(29.1, "absint")).toBe("29");
    expect(format(-1234.4, "absint")).toBe("1.234");
  });

  it("keeps years plain and decimals with a comma", () => {
    expect(format(2025, "year")).toBe("2025");
    expect(format(0.752, "dec2")).toBe("0,75");
    expect(format(-0.05, "dec2")).toBe(`${MINUS}0,05`);
  });

  it("turns the data version and ISO dates into dd/mm/yyyy", () => {
    expect(format("2026.11.10", "date")).toBe("10/11/2026");
    expect(format("2026-11-10T00:05:09Z", "date")).toBe("10/11/2026");
    expect(format("2026.11.10", "longdate")).toBe("10 de novembro de 2026");
    expect(format("2026-03-01T00:00:00Z", "longdate")).toBe("1º de março de 2026");
    expect(() => format("2026.13.01", "longdate")).toThrow(TypeError);
  });

  it("refuses to format what is not a number", () => {
    expect(() => format(null, "pct")).toThrow(TypeError);
    expect(() => format("73", "int")).toThrow(TypeError);
  });

  it("shortens large amounts for a headline number", () => {
    expect(format(165259014, "compact")).toBe("165,3 mi");
    expect(format(47621662, "compact")).toBe("47,6 mi");
    expect(format(2343000, "compact")).toBe("2,3 mi");
    expect(format(12345, "compact")).toBe("12,3 mil");
    expect(format(9999, "compact")).toBe("9.999");
    expect(format(999960, "compact")).toBe("1,0 mi");
    expect(format(1234567890, "compact")).toBe("1,2 bi");
    expect(format(315194933, "brl")).toBe("R$ 315,2 bi");
    expect(format(4329958, "brl")).toBe("R$ 4,3 bi");
  });

  it("writes round references as a legend shows them, the unit from a thousand", () => {
    expect(format(100_000, "short")).toBe("100 mil");
    expect(format(20_000, "short")).toBe("20 mil");
    expect(format(2_000, "short")).toBe("2 mil");
    expect(format(500, "short")).toBe("500");
    expect(format(2_500_000, "short")).toBe("2,5 mi");
    expect(format(999_960, "short")).toBe("1 mi");
    expect(format(5_000_000, "shortbrl")).toBe("R$ 5 bi");
    expect(format(1_000_000, "shortbrl")).toBe("R$ 1 bi");
    expect(format(200_000, "shortbrl")).toBe("R$ 200 mi");
  });

  it("prints display numbers only with the characters of the display-number font subset", () => {
    // The panel's display number uses a subset of IBM Plex Sans Bold (fonts.css); a character
    // outside it would fall back to the whole Bold file, beyond the Explorar's budget.
    const allowed = new Set(tokens.displayNumber.subset.characters);
    const samples = [0, 7, 999, 1234, 9999, 12_345, 999_960, 165_259_014, 1_234_567_890, 4.2e12, -5_432_100];
    for (const name of ["int", "compact", "brl"] as const) {
      for (const n of samples) {
        for (const c of format(n, name)) expect(allowed.has(c), `${name}(${n}) prints "${c}"`).toBe(true);
      }
    }
  });
});
