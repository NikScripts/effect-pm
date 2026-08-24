// Link-integrity gate: every href the docgen emits must resolve to a documented page — the
// zero-guess ruling as an ENFORCED invariant, not a one-time verification. Checks the model's
// sidecars (locations, doclinks) and every anchor baked into the precomputed hover HTML against
// the page set (paths.json).
//
//   tsx scripts/check-links.ts     (exit 1 on any dead link)

import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { Console, Data, Effect, Exit, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { NodeServices } from "@effect/platform-node";

class DeadLinks extends Data.TaggedError("DeadLinks")<{
  readonly count: number;
}> {}

const repoRoot = nodePath.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const dataDir = nodePath.join(repoRoot, "docs/site/api-data");
const hoversDir = nodePath.join(repoRoot, "docs/site/api-hovers");

const pathsSchema = Schema.Struct({
  symbols: Schema.Array(Schema.Tuple([Schema.String, Schema.String, Schema.String])),
});
const locationsSchema = Schema.Struct({
  locations: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      line: Schema.Number,
      url: Schema.String,
    })
  ),
});
const doclinksSchema = Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String));
const referencesSchema = Schema.Struct({
  references: Schema.Record(Schema.String, Schema.Array(Schema.String)),
});

const readJson = <S extends Schema.Top>(
  path: string,
  schema: S
): Effect.Effect<S["Type"], never, FileSystem.FileSystem | S["DecodingServices"]> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(path);
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text);
  }).pipe(Effect.orDie);

const anchorHref = /class="api-typelink" href="([^"]+)"/g;

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* readJson(nodePath.join(dataDir, "paths.json"), pathsSchema);
  const valid = new Set(
    paths.symbols.map(([pkg, module, name]) => `/api/${pkg}/${module}/${name}`)
  );
  const failures: Array<string> = [];
  let checked = 0;
  const check = (url: string, source: string): void => {
    checked += 1;
    if (!valid.has(url)) failures.push(`${source} -> ${url}`);
  };

  const locations = yield* readJson(nodePath.join(dataDir, "locations.json"), locationsSchema);
  for (const location of locations.locations) check(location.url, "locations.json");

  const doclinks = yield* readJson(nodePath.join(dataDir, "doclinks.json"), doclinksSchema);
  for (const [owner, links] of Object.entries(doclinks)) {
    for (const url of Object.values(links)) check(url, `doclinks.json ${owner}`);
  }

  const references = yield* readJson(nodePath.join(dataDir, "references.json"), referencesSchema);
  for (const [target, referrers] of Object.entries(references.references)) {
    check(target, "references.json target");
    for (const url of referrers) check(url, `references.json ${target}`);
  }

  // Every anchor baked into the precomputed hover sidecars.
  const hoversExist = yield* fs.exists(hoversDir).pipe(Effect.orElseSucceed(() => false));
  let sidecars = 0;
  if (hoversExist) {
    const pkgs = yield* fs.readDirectory(hoversDir).pipe(Effect.orElseSucceed(() => []));
    for (const pkg of pkgs) {
      const pkgDir = nodePath.join(hoversDir, pkg);
      const modules = yield* fs.readDirectory(pkgDir).pipe(Effect.orElseSucceed(() => []));
      for (const module of modules) {
        const moduleDir = nodePath.join(pkgDir, module);
        const files = yield* fs.readDirectory(moduleDir).pipe(Effect.orElseSucceed(() => []));
        for (const file of files) {
          if (!file.endsWith(".src.html")) continue;
          sidecars += 1;
          const html = yield* fs
            .readFileString(nodePath.join(moduleDir, file))
            .pipe(Effect.orElseSucceed(() => ""));
          for (const m of html.matchAll(anchorHref)) {
            check(m[1], `${pkg}/${module}/${file}`);
          }
        }
      }
    }
  } else {
    yield* Console.log("api-hovers/ absent — sidecar anchors not checked (run gen-hovers first)");
  }

  // Prose /docs/* links in the content markdown — the class of link the api-only sets above
  // never covered (a renamed chapter slug sailed through as "0 dead"). Valid slugs are md
  // BASENAMES from the real content walk: chapter urls are /docs/<basename> regardless of the
  // file's directory. Non-content trees (site, handoffs, legacy, plans, docgen) neither
  // contribute slugs nor get their links checked.
  const docsRoot = nodePath.join(repoRoot, "docs");
  const skipDirs = new Set(["site", "handoffs", "legacy", "plans", "docgen"]);
  const contentFiles: Array<string> = [];
  const walk = (dir: string): Effect.Effect<void, never, FileSystem.FileSystem> =>
    Effect.gen(function* () {
      for (const entry of yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => []))) {
        const abs = nodePath.join(dir, entry);
        const info = yield* fs.stat(abs).pipe(Effect.orElseSucceed(() => undefined));
        if (info === undefined) continue;
        if (info.type === "Directory") {
          if (dir !== docsRoot || !skipDirs.has(entry)) yield* walk(abs);
        } else if (entry.endsWith(".md") && entry !== "README.md") {
          contentFiles.push(abs);
        }
      }
    });
  yield* walk(docsRoot);
  const pageSlugs = new Set(
    contentFiles.map((f) => nodePath.basename(f).replace(/\.md$/, ""))
  );
  let proseChecked = 0;
  for (const file of contentFiles) {
    const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
    for (const m of text.matchAll(/\]\(\/docs\/([A-Za-z0-9-]+)(?:#[^)\s]*)?\)/g)) {
      proseChecked += 1;
      if (!pageSlugs.has(m[1])) {
        failures.push(`${nodePath.relative(repoRoot, file)} -> /docs/${m[1]}`);
      }
    }
  }
  checked += proseChecked;

  yield* Console.log(
    `link check: ${valid.size} pages, ${checked} links checked (${sidecars} sidecars, ${proseChecked} prose docs links), ${failures.length} dead`
  );
  if (failures.length > 0) {
    for (const failure of failures.slice(0, 25)) yield* Console.error(`DEAD ${failure}`);
    if (failures.length > 25) yield* Console.error(`… and ${failures.length - 25} more`);
    return yield* new DeadLinks({ count: failures.length });
  }
});

const exit = await Effect.runPromiseExit(program.pipe(Effect.provide(NodeServices.layer)));
process.exit(Exit.isSuccess(exit) ? 0 : 1);
