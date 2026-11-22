// @vitest-environment node
import { minimap } from "../src/lib/minimap";

describe("the minimap of a municipality", () => {
  it("draws the state, the region and the municipality, small enough for every page", async () => {
    const map = await minimap("MT", 51, [5107925, 5101837, 5105259], 5107925);
    expect(map.outline.length).toBeGreaterThan(100);
    expect(map.municipality.length).toBeGreaterThan(50);
    expect(map.region.length).toBeGreaterThan(50);
    expect(map.marker).toBeNull();
  });
});

describe("the minimap's simplification", () => {
  it("keeps a closed ring a ring (regression: it collapsed to a point)", async () => {
    const map = await minimap("SP", 35, [3530706], 3530706);
    expect(map.municipality).toMatch(/^M\d+ \d+l/);
    expect(map.marker).toBeNull();
  });
});
