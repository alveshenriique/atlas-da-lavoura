import { createHash } from "node:crypto";

import {
  CACHE,
  checkLimits,
  contentSecurityPolicy,
  hashSource,
  inlineBlocks,
  LIMITS,
  renderHeaders,
} from "../scripts/make-headers.mjs";

describe("the _headers generator", () => {
  it("hashes the exact text of each executable inline script and style", () => {
    const html = [
      "<script>window.a = 1;</script>",
      '<script type="module">import "/x.js";</script>',
      '<script type="application/json">{"not": "code"}</script>',
      '<script src="/_astro/a.js"></script>',
      "<style>.b { color: red; }</style>",
    ].join("");
    const found = inlineBlocks(html);
    expect(found.scripts).toEqual(["window.a = 1;", 'import "/x.js";']);
    expect(found.styles).toEqual([".b { color: red; }"]);
    expect(found.problems).toEqual([]);
    const digest = createHash("sha256").update("window.a = 1;").digest("base64");
    expect(hashSource("window.a = 1;")).toBe(`'sha256-${digest}'`);
  });

  it("finds the analytics beacon a CDN injects for browsers (a script from another origin)", () => {
    // The tag Cloudflare adds before </body> when Web Analytics is on (seen in production).
    const beacon =
      '<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v1" ' +
      'integrity="sha512-x" data-cf-beacon=\'{"version":"2024.11.0","token":"t","spa":2}\' crossorigin="anonymous"></script>';
    expect(inlineBlocks(`<body><p>x</p>${beacon}</body>`).problems).toEqual([
      "script from another origin: https://static.cloudflareinsights.com/beacon.min.js/v1",
    ]);
  });

  it("refuses what the policy would block anyway", () => {
    const found = inlineBlocks(
      [
        '<button onclick="go()">x</button>',
        '<a href="javascript:go()">y</a>',
        '<script src="https://cdn.example.com/x.js"></script>',
        '<link rel="stylesheet" href="//fonts.example.com/a.css">',
      ].join(""),
    );
    expect(found.problems).toEqual([
      "script from another origin: https://cdn.example.com/x.js",
      "stylesheet from another origin: //fonts.example.com/a.css",
      "inline event handler: onclick",
      "javascript: URL",
    ]);
  });

  it("allows scripts only from the site and the hashes, never unsafe-inline", () => {
    const csp = contentSecurityPolicy({ scriptHashes: ["'sha256-AAA='"], styleHashes: [] });
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'self' 'sha256-AAA='");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("caches versioned files forever and pages never, and keeps within Cloudflare's limits", () => {
    const text = renderHeaders({ csp: "default-src 'none'" });
    expect(text).toContain(`/data/*\n  ! Cache-Control\n  Cache-Control: ${CACHE.immutable}`);
    expect(text).toContain(`/*\n  Content-Security-Policy: default-src 'none'`);
    expect(text).toContain(`Cache-Control: ${CACHE.html}`);
    expect(checkLimits(text)).toEqual([]);
    expect(checkLimits(`/*\n  X: ${"a".repeat(LIMITS.lineLength)}\n`)).toEqual([
      `a line of ${LIMITS.lineLength + 5} characters (limit ${LIMITS.lineLength})`,
    ]);
  });
});
