// Generate the search-document corpus — gitignored per-type chunks (public/search/{api,pages,
// glossary}.json + precompressed .gz/.br) the client fetches lazily and the ranking wrapper
// (src/lib/search-core.ts) indexes. Engine-agnostic on
// purpose: plain typed documents from the SSOT (api-data for symbols/modules, the docs tree for
// pages at HEADING granularity, the glossary), so the engine can be swapped without regenerating
// anything upstream. Runs AFTER gen-api (needs api-data).
//
//   tsx scripts/gen-search.ts

import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { Console, Data, Effect, Exit, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { NodeServices } from "@effect/platform-node";
import { slugify } from "../src/lib/slug-text.js";

const repoRoot = nodePath.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const dataDir = nodePath.join(repoRoot, "docs/site/api-data");
const docsDir = nodePath.join(repoRoot, "docs");
const outDir = nodePath.join(repoRoot, "docs/site/public/search");

// Content dirs that are chapters (url = /docs/<basename>). legacy/handoffs/site never index.
const contentDirs = ["", "getting-started", "guides", "standards", "examples"];

class FileError extends Data.TaggedError("FileError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

// The search document — the durable shape (see src/lib/search-core.ts for the index side).
interface SearchDoc {
  readonly id: string; // unique (the url, plus #anchor for sections)
  readonly type: "api" | "page" | "glossary";
  readonly title: string;
  readonly url: string;
  readonly summary: string;
  readonly kind?: string; // api: symbol kind or "module"
  readonly pkg?: string; // api: package slug
  readonly name?: string; // api: bare export name
  readonly refs?: number; // api: documented-declaration reference count
  readonly context?: string; // page sections: the chapter title
  readonly text?: string; // extra searchable prose (not displayed)
}

const referencesSchema = Schema.Struct({
  references: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});
const symbolSchema = Schema.Struct({
  name: Schema.String,
  qualifiedName: Schema.String,
  url: Schema.String,
  kind: Schema.String,
  summary: Schema.String,
});
const moduleSchema = Schema.Struct({
  package: Schema.String,
  entry: Schema.String,
  symbols: Schema.Array(Schema.Struct({ name: Schema.String })),
});

const readJson = <S extends Schema.Top>(
  path: string,
  schema: S
): Effect.Effect<S["Type"] | undefined, never, FileSystem.FileSystem | S["DecodingServices"]> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(path);
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text);
  }).pipe(Effect.orElseSucceed(() => undefined));

// Markdown → plain-ish text for snippets: strip fences, links, emphasis, inline code markers.
const plainText = (md: string): string =>
  md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\{\.[^}]*\}/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const docs: Array<SearchDoc> = [];

  // --- API: every documented symbol + every module page ---
  const refs =
    (yield* readJson(nodePath.join(dataDir, "references.json"), referencesSchema))?.references ??
    {};
  const pkgs = (yield* fs.readDirectory(dataDir).pipe(Effect.orElseSucceed(() => []))).filter(
    (entry) => !entry.endsWith(".json")
  );
  for (const pkg of pkgs) {
    const pkgDir = nodePath.join(dataDir, pkg);
    for (const entry of yield* fs.readDirectory(pkgDir).pipe(Effect.orElseSucceed(() => []))) {
      const entryPath = nodePath.join(pkgDir, entry);
      if (entry.endsWith(".json")) {
        // module summary → a module document
        const module = yield* readJson(entryPath, moduleSchema);
        if (module !== undefined) {
          const moduleSlug = entry.replace(/\.json$/, "");
          docs.push({
            id: `/api/${pkg}/${moduleSlug}`,
            type: "api",
            title: module.entry === "(top-level)" ? `${pkg} (top-level)` : module.entry,
            url: `/api/${pkg}/${moduleSlug}`,
            summary: `module — ${module.symbols.length} exports`,
            kind: "module",
            pkg,
            name: module.entry,
          });
        }
        continue;
      }
      // symbol detail files
      for (const file of yield* fs.readDirectory(entryPath).pipe(Effect.orElseSucceed(() => []))) {
        if (!file.endsWith(".json")) continue;
        const symbol = yield* readJson(nodePath.join(entryPath, file), symbolSchema);
        if (symbol === undefined) continue;
        docs.push({
          id: symbol.url,
          type: "api",
          title: symbol.qualifiedName,
          url: symbol.url,
          summary: symbol.summary.slice(0, 240),
          kind: symbol.kind,
          pkg,
          name: symbol.name,
          refs: (refs[symbol.url] ?? []).length,
        });
      }
    }
  }

  // --- Pages: every chapter, plus one document per ## / ### section (deep anchors) ---
  for (const dir of contentDirs) {
    const abs = nodePath.join(docsDir, dir);
    const files = (yield* fs.readDirectory(abs).pipe(Effect.orElseSucceed(() => []))).filter((f) =>
      f.endsWith(".md")
    );
    for (const file of files) {
      const slug = file.replace(/\.md$/, "");
      if (slug === "glossary" || slug === "README") continue;
      const text = yield* fs
        .readFileString(nodePath.join(abs, file))
        .pipe(Effect.orElseSucceed(() => ""));
      if (text === "") continue;
      const lines = text.split("\n");
      const pageTitle = plainText(lines.find((l) => l.startsWith("# ")) ?? slug).trim() || slug;
      const url = `/docs/${slug}`;
      // section split: heading → its prose until the next heading
      let heading = "";
      let buffer: Array<string> = [];
      const flush = (): void => {
        const body = plainText(buffer.join("\n"));
        if (heading === "") {
          docs.push({
            id: url,
            type: "page",
            title: pageTitle,
            url,
            summary: body.slice(0, 220),
            text: body.slice(0, 600),
          });
        } else if (body.length > 0 || heading.length > 0) {
          docs.push({
            id: `${url}#${slugify(heading)}`,
            type: "page",
            title: heading,
            url: `${url}#${slugify(heading)}`,
            summary: body.slice(0, 220),
            context: pageTitle,
            text: body.slice(0, 600),
          });
        }
        buffer = [];
      };
      for (const line of lines) {
        const m = /^#{2,3}\s+(.*)$/.exec(line);
        if (m !== null) {
          flush();
          heading = plainText(m[1]);
        } else if (!line.startsWith("# ")) {
          buffer.push(line);
        }
      }
      flush();
    }
  }

  // --- Glossary: one document per term ---
  const glossary = yield* fs
    .readFileString(nodePath.join(docsDir, "getting-started/glossary.md"))
    .pipe(Effect.orElseSucceed(() => ""));
  {
    let term = "";
    let buffer: Array<string> = [];
    const flush = (): void => {
      if (term !== "") {
        docs.push({
          id: `/docs/glossary#${slugify(term)}`,
          type: "glossary",
          title: term,
          url: `/docs/glossary#${slugify(term)}`,
          summary: plainText(buffer.join("\n")).slice(0, 220),
        });
      }
      buffer = [];
    };
    for (const line of glossary.split("\n")) {
      const m = /^##\s+(.*)$/.exec(line);
      if (m !== null) {
        flush();
        term = plainText(m[1]);
      } else buffer.push(line);
    }
    flush();
  }

  yield* fs
    .makeDirectory(outDir, { recursive: true })
    .pipe(Effect.mapError((cause) => new FileError({ path: outDir, cause })));
  // One chunk per doc type: the panel loads all three in parallel; a type-narrowed results page
  // fetches only its own. Precompressed variants sit beside each chunk so any static host / CDN
  // that negotiates encoding can serve them without a compression tier.
  const chunks: ReadonlyArray<readonly [string, ReadonlyArray<SearchDoc>]> = [
    ["api.json", docs.filter((d) => d.type === "api")],
    ["pages.json", docs.filter((d) => d.type === "page")],
    ["glossary.json", docs.filter((d) => d.type === "glossary")],
  ];
  for (const [file, chunk] of chunks) {
    const path = nodePath.join(outDir, file);
    const json = `${JSON.stringify({ docs: chunk })}\n`;
    const bytes = Buffer.from(json);
    const write = (p: string, data: Uint8Array): Effect.Effect<void, FileError, never> =>
      fs.writeFile(p, data).pipe(Effect.mapError((cause) => new FileError({ path: p, cause })));
    yield* write(path, bytes);
    yield* write(`${path}.gz`, gzipSync(bytes, { level: 9 }));
    yield* write(`${path}.br`, brotliCompressSync(bytes));
  }
  const counts = docs.reduce<Record<string, number>>((acc, d) => {
    acc[d.type] = (acc[d.type] ?? 0) + 1;
    return acc;
  }, {});
  yield* Console.log(
    `search: ${docs.length} documents (${Object.entries(counts)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ")}) -> ${outDir} (api/pages/glossary + .gz/.br)`
  );
});

const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(NodeServices.layer)));
process.exit(Exit.isSuccess(exit) ? 0 : 1);
