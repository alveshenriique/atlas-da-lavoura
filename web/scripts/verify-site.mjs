// Checks the published site after each deploy (.github/workflows/verify-site.yml) and on
// demand: node scripts/verify-site.mjs [https://atlasdalavoura.com.br] [--docs <url>]
//
// - HTTPS: http and www redirect (301/308) to https://<domain>, keeping path and query, and the
//   certificates are valid for at least 14 more days;
// - the main pages, robots.txt, the sitemap and the preview image answer 200, an unknown
//   address answers 404 with the site's page;
// - robots.txt is, byte for byte, the one the build writes (lib/site-pages.ts), so nothing
//   added on the way, such as a CDN's managed robots.txt, goes unnoticed;
// - every page carries the security headers, and every inline script of the HTML that
//   Cloudflare actually serves is allowed by the CSP (catches scripts injected on the way,
//   such as email obfuscation or Rocket Loader); data and bundles are immutable, HTML is not;
// - in a real browser, the Análise and the Explorar (map drawn) run without a single CSP
//   violation or page error;
// - the dbt docs answer over HTTPS (--docs).
// Exits 1 when any check fails; writes a summary to $GITHUB_STEP_SUMMARY when it exists.
import { appendFileSync, readFileSync } from "node:fs";
import { connect } from "node:tls";

import { chromium } from "@playwright/test";

import { robotsTxt } from "../src/lib/site-pages.ts";
import { CACHE, hashSource, inlineBlocks } from "./make-headers.mjs";

const args = process.argv.slice(2);
const docsAt = args.indexOf("--docs");
const docs = docsAt >= 0 ? args[docsAt + 1] : undefined;
const positional = args.filter((a, i) => !a.startsWith("--") && (docsAt < 0 || i !== docsAt + 1));
const site = new URL(positional[0] ?? "https://atlasdalavoura.com.br");
const origin = site.origin;
const host = site.hostname;
const pointer = JSON.parse(readFileSync(new URL("../../data-release.json", import.meta.url), "utf8"));
const PAGES = ["/", "/explorar/", "/municipios/", "/metodo/", "/municipio/5107925/"];
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` (${detail})` : ""}`);
}

async function get(url, init = {}) {
  // A fresh deploy reaches every Cloudflare location within seconds; retry briefly.
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init });
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
}

/** Runs a group of checks; a network error fails the group instead of stopping the run. */
async function guarded(name, fn) {
  try {
    await fn();
  } catch (error) {
    check(name, false, error.cause?.code ?? error.message);
  }
}

async function redirects(from, to) {
  await guarded(`${from} redirects to ${to}`, async () => {
    const response = await get(from);
    const location = response.headers.get("location");
    check(`${from} redirects to ${to}`, [301, 308].includes(response.status) && location === to, `${response.status} ${location ?? ""}`);
  });
}

function certificateDays(name) {
  return new Promise((resolve) => {
    const socket = connect({ host: name, port: 443, servername: name, timeout: 15_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(socket.authorized ? (new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000 : -1);
    });
    socket.on("error", () => resolve(-1));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(-1);
    });
  });
}

function directives(csp) {
  return new Map(
    (csp ?? "")
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.split(" ")[0], d.split(" ").slice(1)]),
  );
}

// --- HTTPS and redirects ---
await redirects(`http://${host}/explorar/?serie=milho`, `${origin}/explorar/?serie=milho`);
await redirects(`https://www.${host}/explorar/?serie=milho`, `${origin}/explorar/?serie=milho`);
for (const name of [host, `www.${host}`, ...(docs ? [new URL(docs).hostname] : [])]) {
  const days = await certificateDays(name);
  check(`certificate of ${name} is valid for 14 more days`, days >= 14, days >= 0 ? `${Math.floor(days)} days` : "invalid");
}

// --- pages and their headers ---
for (const path of PAGES) await guarded(`${path} answers`, async () => {
  const response = await get(`${origin}${path}`);
  const h = response.headers;
  const html = await response.text();
  check(`${path} answers 200`, response.status === 200, String(response.status));
  const csp = directives(h.get("content-security-policy"));
  const scriptSrc = csp.get("script-src") ?? [];
  const allowed = new Set(scriptSrc);
  const strict = scriptSrc[0] === "'self'" && scriptSrc.slice(1).every((s) => /^'sha256-[A-Za-z0-9+/]+={0,2}'$/.test(s));
  check(`${path} script-src is 'self' and hashes only`, strict, `${scriptSrc.length - 1} hashes`);
  const blocks = inlineBlocks(html);
  const unlisted = blocks.scripts.map(hashSource).filter((hash) => !allowed.has(hash));
  check(`${path} every inline script is in the CSP`, unlisted.length === 0 && blocks.problems.length === 0, [...unlisted, ...blocks.problems].join(", "));
  check(`${path} frame-ancestors 'none'`, (csp.get("frame-ancestors") ?? []).join(" ") === "'none'");
  check(`${path} HSTS with includeSubDomains`, /^max-age=[1-9]\d*; includeSubDomains/.test(h.get("strict-transport-security") ?? ""), h.get("strict-transport-security") ?? "missing");
  check(`${path} nosniff, referrer, permissions, frame options`,
    h.get("x-content-type-options") === "nosniff" &&
      h.get("referrer-policy") === "strict-origin-when-cross-origin" &&
      (h.get("permissions-policy") ?? "").includes("camera=()") &&
      h.get("x-frame-options") === "DENY");
  check(`${path} HTML is always revalidated`, h.get("cache-control") === CACHE.html, h.get("cache-control") ?? "missing");
});

// --- files ---
await guarded("files answer", async () => {
const data = await get(`${origin}/data/${pointer.data_version}/catalog.json`);
check("versioned data is immutable", data.status === 200 && data.headers.get("cache-control") === CACHE.immutable, `${data.status} ${data.headers.get("cache-control")}`);
const explore = await (await get(`${origin}/explorar/`)).text();
const bundle = /\/_astro\/[^"']+\.(?:js|css)/.exec(explore)?.[0];
const bundled = bundle ? await get(`${origin}${bundle}`) : undefined;
check("hashed bundles are immutable", bundled?.status === 200 && bundled.headers.get("cache-control") === CACHE.immutable, bundle ?? "no bundle found");
for (const [path, type] of [["/robots.txt", "text/plain"], ["/sitemap.xml", "xml"], ["/og/atlas-da-lavoura.png", "image/png"]]) {
  const response = await get(`${origin}${path}`);
  check(`${path} answers 200 (${type})`, response.status === 200 && (response.headers.get("content-type") ?? "").includes(type), `${response.status} ${response.headers.get("content-type")}`);
}
const robots = Buffer.from(await (await get(`${origin}/robots.txt`)).arrayBuffer());
const expected = Buffer.from(robotsTxt(), "utf8");
check("robots.txt is byte for byte the one of the build", robots.equals(expected),
  robots.equals(expected) ? `${robots.length} bytes` : `${robots.length} bytes served, ${expected.length} expected; starts with ${JSON.stringify(robots.subarray(0, 60).toString("utf8"))}`);
const missing = await get(`${origin}/nao-existe/`);
check("an unknown address answers 404 with the site's page", missing.status === 404 && (await missing.text()).includes("Este endereço não existe"), String(missing.status));
if (docs) {
  const response = await get(docs);
  check(`the dbt docs answer at ${docs}`, response.status === 200, String(response.status));
}
});

// --- a real browser: no CSP violation, no page error ---
const browser = await chromium.launch();
for (const path of ["/", "/explorar/"]) {
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text());
  });
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (e) => console.error(`Refused to load: ${e.effectiveDirective} ${e.blockedURI}`)),
  );
  // A page that does not load fails its check; the summary is still written.
  const loaded = await page.goto(`${origin}${path}`, { waitUntil: "load", timeout: 60_000 }).then(
    () => true,
    (error) => (problems.push(error.message.split("\n")[0]), false),
  );
  if (loaded && path === "/explorar/") {
    await page.locator(".explore__map[data-ready='true']").waitFor({ timeout: 60_000 }).catch(() => problems.push("the map was not drawn"));
  }
  check(`${path} runs in the browser without CSP violations or errors`, problems.length === 0, problems.join(" | "));
  await page.close();
}
await browser.close();

const failed = results.filter((r) => !r.ok);
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map((r) => `| ${r.ok ? "ok" : "**falhou**"} | ${r.name} | ${r.detail.replaceAll("|", "\\|")} |`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`### Verificação de ${origin}`, "", "| | Verificação | Detalhe |", "|---|---|---|", ...rows, ""].join("\n"));
}
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
