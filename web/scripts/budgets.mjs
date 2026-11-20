// The transfer budgets of the site's pages. The single source is lighthouserc.desktop.json
// (the local Lighthouse run asserts them); the verification of the published site
// (scripts/verify-site.mjs) compares the real transfer with the same numbers.
import { readFileSync } from "node:fs";

const LIGHTHOUSE = JSON.parse(readFileSync(new URL("../lighthouserc.desktop.json", import.meta.url), "utf8"));

/** The total-transfer budget of a page, from the assertion whose URL pattern matches it. */
export function budgetFor(path, config = LIGHTHOUSE) {
  const url = `http://localhost${path}`;
  for (const entry of config.ci.assert.assertMatrix) {
    if (!new RegExp(entry.matchingUrlPattern).test(url)) continue;
    const total = entry.assertions["resource-summary:total:size"];
    if (total) return total[1].maxNumericValue;
  }
  return undefined;
}
