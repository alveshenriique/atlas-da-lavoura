// Writes dist/_headers, the response headers of the site on Cloudflare Workers (static
// assets read this file; it is not served). Runs after `astro build` (npm run build).
//
// The Content-Security-Policy is built from the HTML that is about to be published: every
// inline <script> and <style> of every page is hashed (sha256), and script-src allows only
// the site's own files and those hashes, never 'unsafe-inline'. Style attributes are the
// one concession (style-src-attr 'unsafe-inline'; docs/DECISOES.md, "Publicação do site").
// The build fails when a page carries something the policy would block anyway (an inline
// event handler, a javascript: URL, a script or stylesheet from another origin), or when
// the file breaks Cloudflare's limits (100 rules, 2,000 characters per line).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

/** HSTS starts at one day; raised to a year after a week of green production checks. */
export const HSTS_MAX_AGE = 86_400;
export const LIMITS = { rules: 100, lineLength: 2_000 };
const YEAR = 31_536_000;

// Script types the browser executes; any other type (application/json, ...) is a data block.
const EXECUTABLE = new Set(["", "module", "text/javascript", "application/javascript"]);

/** The inline scripts and styles of a page, and what in it a strict policy would block. */
export function inlineBlocks(html) {
  const scripts = [];
  const styles = [];
  const problems = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? "";
    const src = /\ssrc\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
    if (src !== undefined) {
      if (/^(https?:)?\/\//i.test(src)) problems.push(`script from another origin: ${src}`);
      continue;
    }
    const type = (/\stype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? "").toLowerCase();
    if (EXECUTABLE.has(type)) scripts.push(m[2] ?? "");
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) styles.push(m[1] ?? "");
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = /\shref\s*=\s*["']?([^"'\s>]+)/i.exec(m[0])?.[1] ?? "";
    if (/\brel\s*=\s*["']?stylesheet/i.test(m[0]) && /^(https?:)?\/\//i.test(href)) {
      problems.push(`stylesheet from another origin: ${href}`);
    }
  }
  for (const m of html.matchAll(/<[a-z][^>]*?\s(on[a-z]+)\s*=/gi)) problems.push(`inline event handler: ${m[1]}`);
  if (/\s(?:href|src|action)\s*=\s*["']?\s*javascript:/i.test(html)) problems.push("javascript: URL");
  return { scripts, styles, problems };
}

/** The CSP source for a block's exact text. */
export function hashSource(content) {
  return `'sha256-${createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

export function contentSecurityPolicy({ scriptHashes, styleHashes }) {
  return [
    "default-src 'none'",
    ["script-src 'self'", ...scriptHashes].join(" "),
    // Browsers without style-src-elem/-attr (Safari < 15.4, Firefox < 108) fall back here.
    "style-src 'self' 'unsafe-inline'",
    ["style-src-elem 'self'", ...styleHashes].join(" "),
    "style-src-attr 'unsafe-inline'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; ");
}

export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "browsing-topics=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

/** Cache-Control by path: hashed or versioned files forever, HTML always revalidated. */
export const CACHE = {
  html: "public, max-age=0, must-revalidate",
  immutable: `public, max-age=${YEAR}, immutable`,
  fonts: "public, max-age=2592000",
  images: "public, max-age=86400",
};

export function renderHeaders({ csp }) {
  const rule = (pattern, lines) => [pattern, ...lines.map((l) => `  ${l}`)].join("\n");
  const cache = (value) => ["! Cache-Control", `Cache-Control: ${value}`];
  const rules = [
    rule("/*", [
      `Content-Security-Policy: ${csp}`,
      `Strict-Transport-Security: max-age=${HSTS_MAX_AGE}; includeSubDomains`,
      "X-Content-Type-Options: nosniff",
      "Referrer-Policy: strict-origin-when-cross-origin",
      `Permissions-Policy: ${PERMISSIONS_POLICY}`,
      "X-Frame-Options: DENY",
      "Cross-Origin-Opener-Policy: same-origin",
      `Cache-Control: ${CACHE.html}`,
    ]),
    // Bundles with a content hash in their names, and the data package of a fixed version.
    rule("/_astro/*", cache(CACHE.immutable)),
    rule("/data/*", cache(CACHE.immutable)),
    // Names without a hash: cached for a while, never forever.
    rule("/fonts/*", cache(CACHE.fonts)),
    rule("/og/*", cache(CACHE.images)),
    // Preview versions (Version URLs) on workers.dev stay out of search engines.
    rule("https://:version.:account.workers.dev/*", ["X-Robots-Tag: noindex"]),
  ];
  const header = [
    "# Generated by scripts/make-headers.mjs at build time; do not edit.",
    "# Rules apply in order; \"! Name\" drops a header an earlier rule set.",
  ].join("\n");
  return [header, ...rules].join("\n\n") + "\n";
}

/** Cloudflare's limits for the file: problems found, if any. */
export function checkLimits(text) {
  const problems = [];
  const rules = text.split("\n").filter((l) => l !== "" && !l.startsWith(" ") && !l.startsWith("#"));
  if (rules.length > LIMITS.rules) problems.push(`${rules.length} rules (limit ${LIMITS.rules})`);
  for (const line of text.split("\n")) {
    if (line.length > LIMITS.lineLength) problems.push(`a line of ${line.length} characters (limit ${LIMITS.lineLength})`);
  }
  return problems;
}

function htmlFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath, e.name));
}

/** Hashes every inline block of the build and writes <dist>/_headers. */
export function writeHeaders(dist) {
  const scripts = new Set();
  const styles = new Set();
  const problems = [];
  const files = htmlFiles(dist);
  for (const file of files) {
    const found = inlineBlocks(readFileSync(file, "utf8"));
    for (const s of found.scripts) scripts.add(hashSource(s));
    for (const s of found.styles) styles.add(hashSource(s));
    for (const p of found.problems) problems.push(`${relative(dist, file)}: ${p}`);
  }
  const csp = contentSecurityPolicy({ scriptHashes: [...scripts].sort(), styleHashes: [...styles].sort() });
  const text = renderHeaders({ csp });
  problems.push(...checkLimits(text));
  if (problems.length > 0) throw new Error(`_headers not written:\n${problems.join("\n")}`);
  writeFileSync(join(dist, "_headers"), text);
  return { pages: files.length, scripts: scripts.size, styles: styles.size, cspLength: csp.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const dist = process.argv[2] ?? "dist";
  const summary = writeHeaders(dist);
  console.log(
    `_headers: ${summary.pages} pages, ${summary.scripts} inline scripts and ${summary.styles} inline styles hashed, CSP of ${summary.cspLength} characters`,
  );
}
