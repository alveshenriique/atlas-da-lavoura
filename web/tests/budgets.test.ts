// @vitest-environment node
import { budgetFor } from "../scripts/budgets.mjs";

describe("the page budgets", () => {
  it("are read from the local Lighthouse configuration, one per main page", () => {
    // The verification of the published site compares the real transfer with these numbers.
    expect(budgetFor("/")).toBe(358_400);
    expect(budgetFor("/explorar/")).toBe(716_800);
    expect(budgetFor("/municipios/")).toBe(327_680);
    expect(budgetFor("/metodo/")).toBe(122_880);
    expect(budgetFor("/municipio/3155504/")).toBe(327_680);
    expect(budgetFor("/nao-existe/")).toBeUndefined();
  });
});
