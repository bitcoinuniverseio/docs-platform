#!/usr/bin/env node
// Accessibility gate for the built portal.
//
// Runs axe with every rule enabled over every published page, in both colour
// schemes, at a phone width and a desktop width, and fails on any violation.
// Colour contrast is why this drives a real browser rather than jsdom: nothing
// that does not paint can evaluate it.
//
// It also fails a page that scrolls sideways. A page a reader has to pan on a
// phone is broken whether or not axe has a rule for it, and wide tables and
// long code samples are exactly what a documentation site is full of.
//
// Routes come from the built sitemap rather than a hand-kept list, so a page
// added to the portal is audited without anyone remembering to register it.
// A list would drift, and the pages most likely to be forgotten are the new
// ones.
//
//   node bin/check-accessibility.mjs --dist ../../apps/portal/dist
//
//   --dist    built site to serve and audit (default apps/portal/dist)
//   --routes  comma separated subset, for a quick loop while fixing one page
//   --port    port for the temporary static server

import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve("axe-core/axe.min.js");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const DIST = resolve(args.get("dist") ?? "apps/portal/dist");
const PORT = Number(args.get("port") ?? 4330);

if (!existsSync(join(DIST, "index.html"))) {
  console.error(`no built site at ${DIST}; run the portal build first`);
  process.exit(2);
}

// Every route the build actually published.
async function discoverRoutes(dir, prefix = "") {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith("_") || entry.name === "pagefind") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await discoverRoutes(full, `${prefix}/${entry.name}`)));
    } else if (entry.name === "index.html") {
      found.push(`${prefix}/`);
    } else if (extname(entry.name) === ".html" && entry.name !== "404.html") {
      found.push(`${prefix}/${entry.name.replace(/\.html$/, "")}/`);
    }
  }
  return found;
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".woff2": "font/woff2", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
};

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = join(DIST, path);
    if (path.endsWith("/")) file = join(file, "index.html");
    else if (!extname(file) && existsSync(join(file, "index.html"))) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});
await new Promise((r) => server.listen(PORT, r));
const BASE = `http://127.0.0.1:${PORT}`;

const discovered = (await discoverRoutes(DIST)).sort();
const routes = args.get("routes")
  ? args.get("routes").split(",").map((r) => r.trim())
  : discovered;

// 375 is the narrowest phone worth supporting; 1440 is where the sidebar, the
// table of contents and the content column all appear at once.
const WIDTHS = [375, 1440];
const SCHEMES = ["light", "dark"];

const browser = await chromium.launch();
const failures = [];
let renders = 0;

for (const colorScheme of SCHEMES) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      colorScheme,
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    for (const route of routes) {
      const response = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      if (response === null || !response.ok()) {
        failures.push(`${colorScheme} ${width} ${route}: ${response?.status() ?? "no response"}`);
        continue;
      }
      await page.addScriptTag({ path: AXE_PATH });
      const result = await page.evaluate(async () =>
        await window.axe.run(document, { resultTypes: ["violations"] }));
      renders += 1;
      for (const v of result.violations) {
        failures.push(`${colorScheme} ${width} ${route}: ${v.id} (${v.impact}) on ${v.nodes.length} element(s)\n      ${v.help}`);
      }
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      // One pixel of slack for subpixel rounding, and no more.
      if (overflow > 1) {
        failures.push(`${colorScheme} ${width} ${route}: scrolls sideways by ${overflow}px`);
      }
    }
    await context.close();
  }
}

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`accessibility: ${failures.length} problem(s) across ${renders} renders\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`accessibility: ${renders} renders audited across ${routes.length} pages, ${SCHEMES.length} colour schemes and ${WIDTHS.length} widths, no violations and no sideways scroll`);
