import { correlationPValue, studentCdf, welchLessPValue } from "../src/lib/stats";

// Reference values from scipy.stats (t.cdf, the t test of a correlation and ttest_ind with
// equal_var=False, alternative="less").
describe("the Student t distribution", () => {
  it("matches scipy's cumulative distribution", () => {
    const cases: [number, number, number][] = [
      [0, 5, 0.5],
      [1.5, 3, 0.884708067378],
      [-2.2, 10, 0.026220534225],
      [2.0, 33, 0.973106884059],
      [-0.7, 7.3, 0.252808570093],
      [3.1, 40, 0.998231545795],
    ];
    for (const [t, df, expected] of cases) expect(studentCdf(t, df)).toBeCloseTo(expected, 9);
  });

  it("gives the one-sided p-values of the two tests of the drought reading", () => {
    expect(correlationPValue(0.3, 35)).toBeCloseTo(0.0399771611, 8);
    expect(correlationPValue(0.3, 2)).toBe(1);
    expect(welchLessPValue([-0.1, -0.2, 0.05, -0.15], [0.02, 0.03, -0.01, 0.05, 0, 0.04, -0.02])).toBeCloseTo(
      0.0599414673,
      8,
    );
    expect(welchLessPValue([-0.1], [0, 0.1])).toBe(1);
  });
});
