#!/usr/bin/env node
// Fail-fast artifact gate: refuse a truncated / mis-baked docs build.
//
// Catches the class of bug that shipped 404s for every /api/<pkg> and
// /api/<pkg>/<module> page (waku-only rebuild without api-data/index.json →
// empty staticPaths → ~89 HTML files instead of ~1800+).
//
// Run: node scripts/check-ssg.mjs
// Wired as `postbuild` and from deploy-do.sh (do not rely on humans noticing).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distPublic = path.join(siteRoot, "dist/public");
const distApi = path.join(distPublic, "api");
const distDocs = path.join(distPublic, "docs");
const indexPath = path.join(siteRoot, "api-data/index.json");

const fail = (msg) => {
  console.error(`check-ssg FAIL: ${msg}`);
  process.exit(1);
};

const exists = (p) => fs.existsSync(p);

if (!exists(indexPath)) {
  fail("api-data/index.json missing — run a full `pnpm build` (gen-api must run first)");
}

/** @type {{ packages: Array<{ slug: string; modules: Array<{ slug: string }> }> }} */
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const packages = index.packages ?? [];
if (packages.length === 0) fail("api-data/index.json has zero packages");

const walkHtml = (dir) => {
  if (!exists(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkHtml(p));
    else if (ent.name.endsWith(".html")) out.push(p);
  }
  return out;
};

const apiHtml = walkHtml(distApi);
if (apiHtml.length < 200) {
  fail(
    `only ${apiHtml.length} api HTML page(s) under dist/public/api (need ≥200). ` +
      "Truncated SSG — usually missing api-data/index.json during `waku build`.",
  );
}

/** @type {string[]} */
const missing = [];

// Package + module indexes must be prerendered for every package in the index.
for (const pkg of packages) {
  if (!exists(path.join(distApi, pkg.slug, "index.html"))) {
    missing.push(`/api/${pkg.slug}/`);
  }
  for (const mod of pkg.modules ?? []) {
    if (!exists(path.join(distApi, pkg.slug, mod.slug, "index.html"))) {
      missing.push(`/api/${pkg.slug}/${mod.slug}/`);
    }
  }
}

// Own-package symbols are static. Filenames use symbolFileKey; URLs use the symbol name —
// read each JSON's `url` field so we check the path users actually hit.
const own = packages.find((p) => p.slug === "hyperlink-ts");
if (own === undefined) fail("hyperlink-ts missing from api-data/index.json");
const ownData = path.join(siteRoot, "api-data/hyperlink-ts");
let ownSymbolsChecked = 0;
for (const mod of own.modules ?? []) {
  const modDir = path.join(ownData, mod.slug);
  if (!exists(modDir)) continue;
  for (const ent of fs.readdirSync(modDir, { withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.endsWith(".json")) continue;
    const rel = path.join(modDir, ent.name);
    let url;
    try {
      url = JSON.parse(fs.readFileSync(rel, "utf8")).url;
    } catch {
      missing.push(`(unreadable ${path.relative(siteRoot, rel)})`);
      continue;
    }
    if (typeof url !== "string" || !url.startsWith("/api/")) {
      missing.push(`(bad url in ${path.relative(siteRoot, rel)})`);
      continue;
    }
    const html = path.join(distPublic, url.slice(1), "index.html");
    if (!exists(html)) missing.push(`${url}/`);
    ownSymbolsChecked++;
  }
}
if (ownSymbolsChecked < 100) {
  fail(`only ${ownSymbolsChecked} hyperlink-ts symbol JSON files found under api-data (need ≥100)`);
}

// Guide canaries (table pages + install).
for (const slug of ["install", "managing-layers", "core-concepts"]) {
  if (!exists(path.join(distDocs, slug, "index.html"))) missing.push(`/docs/${slug}/`);
}

if (missing.length > 0) {
  const sample = missing.slice(0, 20).join("\n  ");
  fail(
    `${missing.length} expected prerendered page(s) missing from dist. First:\n  ${sample}` +
      (missing.length > 20 ? `\n  … +${missing.length - 20} more` : ""),
  );
}

// Never ship dotenvx ciphertext into canonical/og tags again.
const cipherHits = [];
for (const file of [...apiHtml, ...walkHtml(distDocs)].slice(0, 5000)) {
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("encrypted:")) cipherHits.push(path.relative(siteRoot, file));
  if (cipherHits.length >= 5) break;
}
if (cipherHits.length > 0) {
  fail(`ciphertext "encrypted:" found in built HTML:\n  ${cipherHits.join("\n  ")}`);
}

// One viewport meta, and it must include viewport-fit=cover (Waku's default lacks it).
const landingHtmlPath = path.join(distPublic, "index.html");
if (!exists(landingHtmlPath)) fail("dist/public/index.html missing");
{
  const landing = fs.readFileSync(landingHtmlPath, "utf8");
  const viewports = landing.match(/<meta[^>]*name="viewport"[^>]*>/gi) ?? [];
  if (viewports.length !== 1) {
    fail(`landing index has ${viewports.length} viewport meta(s); want exactly 1 with viewport-fit=cover`);
  }
  if (!/viewport-fit=cover/i.test(viewports[0] ?? "")) {
    fail(`landing viewport missing viewport-fit=cover: ${viewports[0]}`);
  }
}

console.log(
  `check-ssg OK — ${apiHtml.length} api HTML; ${packages.length} packages; ` +
    `${own.modules.length} hyperlink-ts modules; ${ownSymbolsChecked} own symbols prerendered`,
);
