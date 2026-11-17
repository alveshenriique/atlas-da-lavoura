// Not a test of the site: the generator of its link preview image (npm run og-image, with
// playwright.og.config.ts). It renders the internal /og/ page, refuses to save the image if
// any number on it lacks provenance, and writes the PNG with a note of the data version it
// was drawn from (tests/og-image.test.ts compares that version with data-release.json).
import { readFileSync, writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { findUnsourcedNumbers } from "../e2e/provenance";

const NAME = "atlas-da-lavoura";

test("draws the link preview image from the Análise chart", async ({ page, request }) => {
  await page.goto(`/og/${NAME}/`);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".og__chart svg")).toBeVisible();
  expect(await findUnsourcedNumbers(page, request)).toEqual([]);
  await page.screenshot({ path: `public/og/${NAME}.png`, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  const pointer = JSON.parse(readFileSync("../data-release.json", "utf8")) as { data_version: string; sha256: string };
  const note = { image: `${NAME}.png`, data_version: pointer.data_version, data_sha256: pointer.sha256 };
  writeFileSync(`public/og/${NAME}.json`, `${JSON.stringify(note, null, 2)}\n`);
});
