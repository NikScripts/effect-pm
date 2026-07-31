// Enforce the corpus rule `mark-the-surface` (documentation.md, .must): every declaration exported
// from `src/` carries exactly one visibility marker — `@public` or `@internal` — in its leading
// JSDoc. Parsing is via the TypeScript compiler API (not regex) so overload sets count once and the
// marker is read from the real leading comment, not a line-window guess.
//
// Per Effect Style ("isolate a Node primitive behind a small Effect-returning helper rather than
// scattering raw calls"), the fs touches sit in typed helpers below; the rest is an ordinary Effect
// program and every failure is a value in the error channel.
//
//   tsx scripts/mark-the-surface-check.ts                 fail (exit 1) on ANY unmarked export
//   tsx scripts/mark-the-surface-check.ts --baseline      fail only on exports NOT in the baseline
//   tsx scripts/mark-the-surface-check.ts --write-baseline rewrite the baseline to today's violations
//
// Re-export specifiers (`export { x } from "…"`, `export * from "…"`) are aggregation, not a
// declaration with a JSDoc home, so they are out of scope — the marker lives on the definition.

import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { Console, Data, Effect, Exit } from "effect";
import ts from "typescript";

const scriptDir = nodePath.dirname(fileURLToPath(import.meta.url));
const srcDir = nodePath.resolve(scriptDir, "../src");
const baselinePath = nodePath.join(scriptDir, "mark-the-surface-baseline.txt");

// One named error per failure mode (Principles → Errors are values).
class FileError extends Data.TaggedError("FileError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

class Violations extends Data.TaggedError("Violations")<{
  readonly count: number;
}> {}

// --- isolated Node IO — the only raw node:* in the program, behind typed effects ---
const listSourceFiles = Effect.try({
  try: (): ReadonlyArray<string> =>
    nodeFs
      .readdirSync(srcDir, { recursive: true, encoding: "utf8" })
      .filter((p) => p.endsWith(".ts") && !p.endsWith(".d.ts"))
      .map((p) => nodePath.join(srcDir, p))
      .sort(),
  catch: (cause) => new FileError({ path: srcDir, cause }),
});

const readText = (path: string) =>
  Effect.try({
    try: () => nodeFs.readFileSync(path, "utf8"),
    catch: (cause) => new FileError({ path, cause }),
  });

// The baseline is one "relpath:name" id per line (plain text — readable diffs, no JSON to parse).
const readBaseline = Effect.try({
  try: (): ReadonlyArray<string> =>
    nodeFs.existsSync(baselinePath)
      ? nodeFs
          .readFileSync(baselinePath, "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith("#"))
      : [],
  catch: (cause) => new FileError({ path: baselinePath, cause }),
});

const writeBaseline = (ids: ReadonlyArray<string>) =>
  Effect.try({
    try: () =>
      nodeFs.writeFileSync(
        baselinePath,
        `# mark-the-surface backlog — exports awaiting a @public/@internal marker.\n` +
          `# Regenerate: tsx scripts/mark-the-surface-check.ts --write-baseline\n` +
          `${[...ids].join("\n")}\n`,
      ),
    catch: (cause) => new FileError({ path: baselinePath, cause }),
  });

// --- pure analysis: one unmarked export per (file, name) ---
interface Unmarked {
  readonly id: string; // "relpath:name" — stable across line moves, the baseline key
  readonly path: string;
  readonly line: number;
  readonly name: string;
  readonly reason: "Missing" | "Both";
}

// A statement is an exported declaration when it carries the `export` keyword.
const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

// The visibility marker lives in the JSDoc immediately preceding the declaration. Read the real
// leading comment text (the compiler attaches it to the node) rather than scanning nearby lines.
const markerVerdict = (
  node: ts.Node,
  full: string,
): "public" | "internal" | "Both" | "Missing" => {
  const lead = full.slice(node.getFullStart(), node.getStart());
  const isPublic = lead.includes("@public");
  const isInternal = lead.includes("@internal");
  if (isPublic && isInternal) return "Both";
  if (isPublic || isInternal) return isPublic ? "public" : "internal";
  return "Missing";
};

// Exported declaration names in one file, each mapped to its marker verdict. Overload sets collapse
// to their first signature (the JSDoc home), so a name is reported once.
const analyzeFile = (relPath: string, path: string, text: string): ReadonlyArray<Unmarked> => {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const out: Array<Unmarked> = [];
  const seen = new Set<string>();

  const record = (name: string, node: ts.Node): void => {
    if (seen.has(name)) return; // overload continuation / re-declaration — first wins
    seen.add(name);
    const verdict = markerVerdict(node, text);
    if (verdict === "public" || verdict === "internal") return;
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    out.push({
      id: `${relPath}:${name}`,
      path: relPath,
      line,
      name,
      reason: verdict,
    });
  };

  for (const stmt of source.statements) {
    if (!isExported(stmt)) continue;
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations)
        if (ts.isIdentifier(decl.name)) record(decl.name.text, stmt);
    } else if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt) ||
        ts.isModuleDeclaration(stmt)) &&
      stmt.name !== undefined &&
      ts.isIdentifier(stmt.name)
    ) {
      record(stmt.name.text, stmt);
    }
    // ExportDeclaration (`export { … }`, `export * from`) is aggregation — out of scope.
  }
  return out;
};

const relOf = (path: string): string => nodePath.relative(nodePath.resolve(srcDir, ".."), path);

const program = Effect.gen(function* () {
  const args = process.argv.slice(2);
  const useBaseline = args.includes("--baseline");
  const rewrite = args.includes("--write-baseline");

  const files = yield* listSourceFiles;
  const found = yield* Effect.forEach(
    files,
    (path) => Effect.map(readText(path), (text) => analyzeFile(relOf(path), path, text)),
    { concurrency: "unbounded" },
  );
  const all = found.flat().sort((a, b) => a.id.localeCompare(b.id));

  if (rewrite) {
    yield* writeBaseline(all.map((u) => u.id));
    yield* Console.log(`mark-the-surface: wrote baseline with ${all.length} grandfathered exports.`);
    return;
  }

  const baseline = useBaseline ? new Set(yield* readBaseline) : new Set<string>();
  const active = all.filter((u) => !baseline.has(u.id));

  if (active.length === 0) {
    const suffix = useBaseline && baseline.size > 0 ? ` (${baseline.size} grandfathered)` : "";
    yield* Console.log(`mark-the-surface: clean — every checked export is marked${suffix}.`);
    return;
  }

  yield* Console.error(
    `mark-the-surface: ${active.length} export(s) missing exactly one @public/@internal marker:\n`,
  );
  const byFile = new Map<string, Array<Unmarked>>();
  for (const u of active) {
    const list = byFile.get(u.path);
    if (list === undefined) byFile.set(u.path, [u]);
    else list.push(u);
  }
  for (const [file, items] of byFile) {
    yield* Console.error(`  ${file}`);
    for (const u of items) {
      const why = u.reason === "Both" ? "has BOTH @public and @internal" : "no marker";
      yield* Console.error(`    L${u.line}  ${u.name} — ${why}`);
    }
  }
  yield* Console.error(
    `\nFix: give each export exactly one @public or @internal in its leading JSDoc.` +
      (useBaseline ? "" : `\n(Run with --baseline to grandfather the existing backlog and gate only new code.)`),
  );
  return yield* new Violations({ count: active.length });
});

// A FileError surfaces its cause here (Violations already printed its own report inside `program`);
// then the exit code is the only thing the top level decides.
const main = program.pipe(
  Effect.catchTag("FileError", (error) =>
    Console.error(`FileError at ${error.path}: ${String(error.cause)}`).pipe(
      Effect.flatMap(() => Effect.fail(error)),
    ),
  ),
);
const exit = await Effect.runPromiseExit(main);
process.exit(Exit.isSuccess(exit) ? 0 : 1);
