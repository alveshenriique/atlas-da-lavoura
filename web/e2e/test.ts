// The test and expect of every end-to-end spec: Playwright's, plus a guard that fails any test
// in which the browser reports a Content-Security-Policy violation. The tests run against
// `wrangler dev` (playwright.config.ts), which serves dist/ with the headers of dist/_headers,
// the same file Cloudflare applies in production, so a script, style or request the policy
// would block in production fails here first.
import { test as base, expect } from "@playwright/test";

export * from "@playwright/test";

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

export const test = base.extend<{ cspGuard: void }>({
  cspGuard: [
    async ({ page }, use) => {
      const reported: string[] = [];
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (e) => {
          window.__cspViolations ??= [];
          window.__cspViolations.push(
            `${e.effectiveDirective} blocked ${e.blockedURI || "inline"} at ${e.sourceFile}:${e.lineNumber}`,
          );
        });
      });
      // The console catches violations on pages the test has already left.
      page.on("console", (message) => {
        const text = message.text();
        if (/Content Security Policy|Refused to (execute|apply|load|connect|frame)/i.test(text)) reported.push(text);
      });
      await use();
      const onPage = page.isClosed() ? [] : await page.evaluate(() => window.__cspViolations ?? []).catch(() => []);
      expect([...reported, ...onPage], "Content-Security-Policy violations").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
