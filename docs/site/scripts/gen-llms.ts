// Generate llms.txt + llms-full.txt (llmstxt.org convention, effect-ecosystem practice):
// an AI-consumable INDEX of the site and a FULL markdown dump of the docs — chapters verbatim
// (the .md sources are the SSOT), plus the API surface as module summaries with one line per
// effect-pm symbol (dep packages are documented upstream; their modules are listed, not dumped).
// Absolute links when DOCS_SITE_ORIGIN is set (same gate as the sitemap), relative otherwise.
//
//   tsx scripts/gen-llms.ts

import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { Console, Data, Effect, Exit, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { NodeServices } from "@effect/platform-node";

const repoRoot = nodePath.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const docsDir = nodePath.join(repoRoot, "docs");
const dataDir = nodePath.join(repoRoot, "docs/site/api-data");
const outDir = nodePath.join(repoRoot, "docs/site/public");

// reading order for the index: the book first, root-level extras last
const contentDirs = ["getting-started", "guides", "standards", "examples", ""];

class FileError extends Data.TaggedError("FileError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

const stripMarkers = (s: string): string =>
  s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*]/g, "");

interface Chapter {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly raw: string;
}

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const origin = (process.env.DOCS_SITE_ORIGIN ?? "").replace(/\/$/, "");
  const link = (path: string): string => `${origin}${path}`;

  // ---- chapters: raw markdown, title from the first H1, summary = first prose paragraph ----
  const chapters: Array<Chapter> = [];
  for (const dir of contentDirs) {
    const abs = nodePath.join(docsDir, dir);
    const files = (yield* fs.readDirectory(abs).pipe(Effect.orElseSucceed(() => []))).filter((f) =>
      f.endsWith(".md")
    );
    for (const file of files.sort()) {
      const slug = file.replace(/\.md$/, "");
      if (slug === "README") continue;
      const raw = yield* fs
        .readFileString(nodePath.join(abs, file))
        .pipe(Effect.orElseSucceed(() => ""));
      if (raw === "") continue;
      const lines = raw.split("\n");
      const title =
        stripMarkers(lines.find((l) => l.startsWith("# "))?.slice(2) ?? slug).trim() || slug;
      const prose = lines.find(
        (l) =>
          l.trim() !== "" &&
          !l.startsWith("#") &&
          !l.startsWith("{") &&
          !l.startsWith("```") &&
          !l.startsWith(">")
      );
      chapters.push({
        slug,
        title,
        summary: stripMarkers(prose ?? "").trim(),
        raw,
      });
    }
  }

  // ---- API surface from the generated model (Schema-decoded — no casts) ----
  const moduleInfo = Schema.Struct({
    slug: Schema.String,
    entry: Schema.String,
    count: Schema.Number,
    summary: Schema.optional(Schema.String),
  });
  const packageIndex = Schema.Struct({
    packages: Schema.Array(
      Schema.Struct({
        slug: Schema.String,
        name: Schema.String,
        modules: Schema.Array(moduleInfo),
      })
    ),
  });
  const index = yield* fs.readFileString(nodePath.join(dataDir, "index.json")).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(packageIndex))),
    Effect.map((d) => d.packages),
    Effect.orElseSucceed(() => [])
  );
  const own = index.find((p) => p.slug === "effect-pm");

  // ---- llms.txt: the index ----
  const indexLines: Array<string> = [
    "# effect-pm",
    "",
    "> Build cross-runtime Services on Effect: declare a service shape once as a Resource Tag,",
    "> run it on one runtime, and call it from another over RPC with the same typed Handle.",
    "",
    "## Docs",
    ...chapters.map(
      (c) => `- [${c.title}](${link(`/docs/${c.slug}`)})${c.summary !== "" ? `: ${c.summary}` : ""}`
    ),
    "",
    "## API Reference",
    ...(own?.modules ?? []).map(
      (m) =>
        `- [${m.entry}](${link(`/api/effect-pm/${m.slug}`)}) (${m.count} exports)${
          m.summary !== undefined ? `: ${stripMarkers(m.summary)}` : ""
        }`
    ),
    "",
    "## Optional",
    `- [All packages](${link("/api")}): effect dependencies' API reference`,
    `- [Releases](${link("/releases")}): version history`,
    `- [Full docs dump](${link("/llms-full.txt")}): every chapter + the API surface, one file`,
    "",
  ];

  // ---- llms-full.txt: chapters verbatim + API one-liners ----
  const fullParts: Array<string> = [
    "# effect-pm — full documentation",
    "",
    "Generated from the docs sources and the compiler-extracted API model.",
    "",
  ];
  for (const c of chapters) {
    fullParts.push("", "---", "", `<!-- ${link(`/docs/${c.slug}`)} -->`, "", c.raw.trim());
  }
  if (own !== undefined) {
    fullParts.push("", "---", "", "# API Reference — @nikscripts/effect-pm", "");
    for (const m of own.modules) {
      fullParts.push(`## ${m.entry} (${link(`/api/effect-pm/${m.slug}`)})`);
      if (m.summary !== undefined) fullParts.push("", stripMarkers(m.summary));
      const summaryFile = nodePath.join(dataDir, "effect-pm", `${m.slug}.json`);
      const rows = yield* fs.readFileString(summaryFile).pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.fromJsonString(
              Schema.Struct({
                symbols: Schema.Array(
                  Schema.Struct({
                    name: Schema.String,
                    kind: Schema.String,
                    summary: Schema.String,
                  })
                ),
              })
            )
          )
        ),
        Effect.map((d) => d.symbols),
        Effect.orElseSucceed(() => [])
      );
      fullParts.push("");
      for (const r of rows) {
        const s = stripMarkers(r.summary).split("\n")[0] ?? "";
        fullParts.push(`- ${r.name} (${r.kind})${s !== "" ? `: ${s}` : ""}`);
      }
      fullParts.push("");
    }
  }

  const write = (
    name: string,
    text: string
  ): Effect.Effect<void, FileError, FileSystem.FileSystem> =>
    fs
      .writeFileString(nodePath.join(outDir, name), text)
      .pipe(Effect.mapError((cause) => new FileError({ path: name, cause })));

  yield* write("llms.txt", `${indexLines.join("\n")}\n`);
  const full = `${fullParts.join("\n")}\n`;
  yield* write("llms-full.txt", full);
  yield* Console.log(
    `llms: llms.txt (${indexLines.length} lines) + llms-full.txt (${Math.round(
      full.length / 1024
    )} KB) -> ${outDir}`
  );
});

const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(NodeServices.layer)));
process.exit(Exit.isSuccess(exit) ? 0 : 1);
