import {
  checkNumberedLists,
  checkStructuralMarks,
  type NumberedList,
  type StructuralMark,
  structuralText,
} from "../src/lib/structural";

const mark = (kind: string, text: string, extra: Partial<StructuralMark> = {}): StructuralMark => ({
  kind,
  text,
  where: `${kind}:${text}`,
  hasChildren: false,
  citesData: false,
  ...extra,
});

const list = (extra: Partial<NumberedList> = {}): NumberedList => ({
  where: "ol.sources",
  tag: "ol",
  structural: true,
  start: 1,
  reversed: false,
  values: [null, null, null],
  ...extra,
});

describe("structural marks", () => {
  it("accept figures, tables and notes numbered in document order, per kind", () => {
    expect(structuralText("figure", 1)).toBe("Figura 1");
    const result = checkStructuralMarks([
      mark("figure", "Figura 1"),
      mark("table", "Tabela 1"),
      mark("table", " Tabela 2 "),
      mark("figure", "Figura 2"),
      mark("note", "Nota 1"),
    ]);
    expect(result.problems).toEqual([]);
    expect(result.valid).toEqual([true, true, true, true, true]);
  });

  it("refuse a data number dressed as a structural one", () => {
    const result = checkStructuralMarks([
      mark("figure", "Figura 1"),
      mark("figure", "Figura 88"),
      mark("note", "73%"),
      mark("table", "Tabela 1 de 537"),
      mark("figure", "Figura 3", { hasChildren: true }),
      mark("table", "Tabela 2", { citesData: true }),
      mark("count", "Contagem 1"),
    ]);
    expect(result.valid).toEqual([true, false, false, false, false, false, false]);
    expect(result.problems).toHaveLength(6);
    expect(result.problems[0]).toContain('must read "Figura 2"');
  });

  it("accept only <ol> lists counting from 1, always marked", () => {
    expect(checkNumberedLists([list()])).toEqual([]);
    expect(checkNumberedLists([list({ structural: false })])).toEqual([
      "ol.sources: numbered list not marked as structural",
    ]);
    for (const wrong of [{ start: 88 }, { reversed: true }, { tag: "ul" }]) {
      expect(checkNumberedLists([list(wrong)])).toHaveLength(1);
    }
  });

  it("accept items that carry their own position, and nothing else", () => {
    // A list reordered in place numbers its items explicitly (browsers do not always
    // renumber moved items): 1, 2, 3 in document order passes.
    expect(checkNumberedLists([list({ values: [1, 2, 3] })])).toEqual([]);
    for (const values of [[2, 1, 3], [1, 2, 537], [1, null, 3], [0, 1, 2]]) {
      expect(checkNumberedLists([list({ values })]), JSON.stringify(values)).toHaveLength(1);
    }
  });
});
