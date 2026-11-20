// Number formats of the site, in Brazilian Portuguese. Negative numbers use the minus sign
// (U+2212), as in the charts; percentages come from fractions (-0.09 -> "−9%"), as the data
// contract publishes them. `compact` shortens large amounts for a headline number
// (165259014 -> "165,3 mi"); `brl` does the same for thousands of reais
// (315194933 -> "R$ 315,2 bi"). `short` and `shortbrl` write round references the same
// way, as a legend shows them: the unit from a thousand and no trailing zero ("2 mil",
// "200 mil", "R$ 5 bi", "2,5 mi"). `date` writes a day as "10/11/2026", `longdate` as
// "10 de novembro de 2026" (and "1º de março de 2026").
export type FormatName =
  | "int"
  | "year"
  | "pct"
  | "spct"
  | "dec2"
  | "sdec2"
  | "text"
  | "date"
  | "longdate"
  | "compact"
  | "brl"
  | "short"
  | "shortbrl";

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export const MINUS = "−";

const integer = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
  useGrouping: "always",
});

function rounded(value: number, digits: number): number {
  const factor = 10 ** digits;
  const result = (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
  return result === 0 ? 0 : result;
}

function withSign(text: string, value: number, signed: boolean): string {
  if (value < 0) return `${MINUS}${text}`;
  return signed && value > 0 ? `+${text}` : text;
}

function asNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`expected a finite number, got ${JSON.stringify(value)}`);
  }
  return value;
}

const oneDecimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const upToOneDecimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** "165,3 mi", "4,2 bi", "12,5 mil"; below ten thousand, the whole number. With `short`,
 *  the unit starts at a thousand and a zero decimal is left out ("2 mil", "5 bi"). */
function compact(n: number, short = false): string {
  const sign = n < 0 ? MINUS : "";
  const a = Math.abs(n);
  const decimals = short ? upToOneDecimal : oneDecimal;
  if (a < (short ? 1e3 : 1e4)) return `${sign}${integer.format(Math.round(a))}`;
  const units: [number, string][] = [
    [1e9, "bi"],
    [1e6, "mi"],
    [1e3, "mil"],
  ];
  for (let k = 0; k < units.length; k++) {
    const [size, word] = units[k] ?? [1, ""];
    if (a < size) continue;
    const r = Math.round((a / size) * 10) / 10;
    // Rounding can reach the next unit: 999,960 reads "1,0 mi", not "1.000,0 mil".
    const up = units[k - 1];
    if (r >= 1000 && up) return `${sign}${decimals.format(Math.round((a / up[0]) * 10) / 10)} ${up[1]}`;
    return `${sign}${decimals.format(r)} ${word}`;
  }
  return `${sign}${integer.format(Math.round(a))}`;
}

export function format(value: unknown, name: FormatName): string {
  if (name === "text") return String(value);
  if (name === "date" || name === "longdate") {
    // The data version ("2026.11.10") or an ISO date ("2026-11-10T00:05:09Z").
    const match = /^(\d{4})[.-](\d{2})[.-](\d{2})/.exec(String(value));
    const month = MONTHS[Number(match?.[2]) - 1];
    if (!match || !month) throw new TypeError(`expected a date, got ${JSON.stringify(value)}`);
    if (name === "date") return `${match[3]}/${match[2]}/${match[1]}`;
    // The first day of a month is written as an ordinal in Portuguese: "1º de março".
    const day = Number(match[3]);
    return `${day === 1 ? "1º" : day} de ${month} de ${match[1]}`;
  }
  const n = asNumber(value);
  switch (name) {
    case "int": {
      const r = rounded(n, 0);
      return withSign(integer.format(Math.abs(r)), r, false);
    }
    case "year":
      return String(Math.trunc(n));
    case "pct":
    case "spct": {
      const r = rounded(n * 100, 0);
      return withSign(`${integer.format(Math.abs(r))}%`, r, name === "spct");
    }
    case "compact":
      return compact(n);
    case "brl":
      // Thousands of reais, as the data contract publishes values.
      return `R$ ${compact(n * 1000)}`;
    case "short":
      return compact(n, true);
    case "shortbrl":
      return `R$ ${compact(n * 1000, true)}`;
    case "dec2":
    case "sdec2": {
      const r = rounded(n, 2);
      return withSign(Math.abs(r).toFixed(2).replace(".", ","), r, name === "sdec2");
    }
  }
}
