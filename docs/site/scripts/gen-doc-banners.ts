// MAINTENANCE script — inserts/updates the GitHub-facing banner in every chapter SOURCE file.
// Deliberately NOT in the build chains: it mutates docs/ content. Run once at launch (and on a
// domain change):
//
//   DOCS_SITE_ORIGIN=https://your.domain tsx scripts/gen-doc-banners.ts
//
// Idempotent: an existing banner is replaced; without DOCS_SITE_ORIGIN it refuses to write.

import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { Console, Effect, Exit } from "effect";
import * as FileSystem from "effect/FileSystem";
import { NodeServices } from "@effect/platform-node";
import { docBanner, stripDocBanner } from "../src/lib/doc-banner.js";

const repoRoot = nodePath.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const docsDir = nodePath.join(repoRoot, "docs");
const contentDirs = ["getting-started", "guides", "standards", "examples", ""];

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const origin = (process.env.DOCS_SITE_ORIGIN ?? "").replace(/\/$/, "");
  if (origin === "") {
    yield* Console.log("gen-doc-banners: set DOCS_SITE_ORIGIN to write banners (nothing changed)");
    return;
  }
  let written = 0;
  for (const dir of contentDirs) {
    const abs = nodePath.join(docsDir, dir);
    const files = (yield* fs.readDirectory(abs).pipe(Effect.orElseSucceed(() => []))).filter((f) =>
      f.endsWith(".md")
    );
    for (const file of files) {
      const slug = file.replace(/\.md$/, "");
      if (slug === "README") continue;
      const path = nodePath.join(abs, file);
      const raw = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => ""));
      if (raw === "") continue;
      const stripped = stripDocBanner(raw);
      const banner = docBanner(`${origin}/docs/${slug}`);
      // insert after the page attr block when present (first line `{#…}`), else at the top
      const lines = stripped.split("\n");
      const attr = lines[0]?.startsWith("{#") === true ? 1 : 0;
      const next = [...lines.slice(0, attr), banner, ...lines.slice(attr)].join("\n");
      if (next !== raw) {
        yield* fs.writeFileString(path, next).pipe(Effect.orElseSucceed(() => undefined));
        written += 1;
      }
    }
  }
  yield* Console.log(`gen-doc-banners: ${written} file(s) updated for ${origin}`);
});

const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(NodeServices.layer)));
process.exit(Exit.isSuccess(exit) ? 0 : 1);
