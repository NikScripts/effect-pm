#!/usr/bin/env node
/**
 * Waku's DEFAULT_HTML_HEAD injects
 *   <meta name="viewport" content="width=device-width, initial-scale=1"/>
 * Our layouts add the same tag with `viewport-fit=cover` (React key="viewport").
 * SSG still emits both; strip the bare default so cover is the only viewport.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "dist/public");

const BARE =
  /<meta name="viewport" content="width=device-width, initial-scale=1"\s*\/?>/gi;
const COVER = 'viewport-fit=cover';

async function* walkHtml(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      console.error(`fix-waku-viewport: missing ${dir} (run waku build first)`);
      process.exit(1);
    }
    throw err;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walkHtml(full);
    else if (ent.name.endsWith(".html")) yield full;
  }
}

let scanned = 0;
let rewritten = 0;
for await (const file of walkHtml(publicDir)) {
  scanned++;
  const html = await readFile(file, "utf8");
  if (!html.includes(COVER) || !BARE.test(html)) continue;
  BARE.lastIndex = 0;
  const next = html.replace(BARE, "");
  if (next === html) continue;
  await writeFile(file, next);
  rewritten++;
}

console.log(`fix-waku-viewport: scanned ${scanned} html, stripped bare viewport from ${rewritten}`);
