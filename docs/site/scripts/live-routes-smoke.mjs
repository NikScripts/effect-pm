#!/usr/bin/env node
// Post-deploy / live HTTP gate: critical routes must be 200 with a real page title.
//
// Catches production 404s for module/package API pages even when the image pushed
// successfully. Run against production after deploy, or against a local `waku start`:
//
//   node scripts/live-routes-smoke.mjs [baseUrl]
//   DOCS_SITE_ORIGIN=https://hyperlink.cool node scripts/live-routes-smoke.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const base = (process.argv[2] ?? process.env.DOCS_SITE_ORIGIN ?? "http://localhost:5190").replace(
  /\/$/,
  "",
);

/** Fixed canaries — the URLs that already burned us once. */
const canaries = [
  "/",
  "/docs/install",
  "/docs/managing-layers",
  "/api",
  "/api/hyperlink-ts",
  "/api/hyperlink-ts/WorkPool",
  "/api/hyperlink-ts/WorkPool/make",
  "/api/hyperlink-ts/Daemon",
  "/api/effect",
  "/api/effect/Effect",
  "/healthz",
];

// Every hyperlink-ts module index from the baked model (when present).
const indexPath = path.join(siteRoot, "api-data/index.json");
if (fs.existsSync(indexPath)) {
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const own = (index.packages ?? []).find((p) => p.slug === "hyperlink-ts");
  for (const mod of own?.modules ?? []) {
    const p = `/api/hyperlink-ts/${mod.slug}`;
    if (!canaries.includes(p)) canaries.push(p);
  }
  for (const pkg of index.packages ?? []) {
    const p = `/api/${pkg.slug}`;
    if (!canaries.includes(p)) canaries.push(p);
  }
}

const fail = (msg) => {
  console.error(`live-routes-smoke FAIL: ${msg}`);
  process.exit(1);
};

const isNotFoundPage = (status, body) => {
  if (status === 404) return true;
  return /<title>\s*Page not found/i.test(body) || />Page not found</i.test(body);
};

/** @type {Array<{ path: string; ok: boolean; detail: string }>} */
const results = [];

for (const route of canaries) {
  const url = `${base}${route}`;
  try {
    const res = await fetch(url, {
      redirect: "manual",
      headers: {
        "user-agent": "hyperlink-docs-live-routes-smoke",
        "cache-control": "no-cache",
      },
    });
    const body = await res.text();
    if (res.status >= 300 && res.status < 400) {
      results.push({ path: route, ok: false, detail: `redirect ${res.status}` });
      continue;
    }
    if (isNotFoundPage(res.status, body)) {
      results.push({ path: route, ok: false, detail: `not-found status=${res.status}` });
      continue;
    }
    if (res.status !== 200) {
      results.push({ path: route, ok: false, detail: `status=${res.status}` });
      continue;
    }
    if (body.includes("encrypted:")) {
      results.push({ path: route, ok: false, detail: "ciphertext in body" });
      continue;
    }
    results.push({ path: route, ok: true, detail: "200" });
  } catch (err) {
    results.push({
      path: route,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "OK  " : "FAIL"} ${r.path}  ${r.detail}`);
}
if (failed.length > 0) {
  fail(`${failed.length}/${results.length} route(s) bad against ${base}`);
}
console.log(`live-routes-smoke OK — ${results.length} routes against ${base}`);
