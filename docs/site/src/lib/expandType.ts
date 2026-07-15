// Compiler-API type expansion for the docs "dual preview".
//
// Twoslash gives us each hover's COMPACT type (e.g. `QueueResource<{ to: string }>`). To show the
// full member shape in the SAME popover — the split prettify-ts gives in the editor — we run our own
// language service over the block's full code (imports + `---cut---` preamble included) and, at each
// hover position, expand the value's type to its members via the checker.
//
// This must be a compiler-API walk, not a `Prettify<T>` type: a written type alias is echoed
// as-written, only an inferred/compiler-resolved type resolves a mapped type to concrete members.

import * as nodePath from "node:path";
import * as ts from "typescript";

export interface ExpanderOptions {
  readonly compilerOptions: ts.CompilerOptions;
  readonly vfsRoot: string;
}

const FILE = "__docs_expand__.ts";

/** Reusable expander: one language service, swap the in-memory file per block (fast across a page). */
export const makeTypeExpander = (opts: ExpanderOptions) => {
  let current = "";
  let version = 0;
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [FILE],
    // Only OUR file changes between blocks; imported files (`effect`, `src`) are stable, so give them
    // a constant version — otherwise the registry re-parses the entire library on every block (the
    // slowdown that hung handle-heavy pages).
    getScriptVersion: (f) => (f === FILE ? String(version) : "1"),
    getScriptSnapshot: (f) =>
      f === FILE
        ? ts.ScriptSnapshot.fromString(current)
        : ts.sys.fileExists(f)
          ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)!)
          : undefined,
    getCurrentDirectory: () => opts.vfsRoot,
    getCompilationSettings: () => opts.compilerOptions,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => f === FILE || ts.sys.fileExists(f),
    readFile: (f) => (f === FILE ? current : ts.sys.readFile(f)),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  /** The innermost named node at `offset` (an identifier/property we can type). */
  const nodeAt = (sf: ts.SourceFile, offset: number): ts.Node | undefined => {
    let found: ts.Node | undefined;
    const visit = (n: ts.Node): void => {
      if (offset >= n.getStart(sf) && offset < n.getEnd()) {
        found = n;
        n.forEachChild(visit);
      }
    };
    sf.forEachChild(visit);
    return found;
  };

  const FLAGS =
    ts.TypeFormatFlags.NoTruncation |
    ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType |
    ts.TypeFormatFlags.WriteArrayAsGenericType;

  const MAX_PROPS = 60; // don't dump enormous library shapes
  const MAX_MEMBER_LEN = 240; // cap a single member's rendered type

  // Worth expanding? A non-primitive OBJECT type with a handful of members and no call surface, whose
  // OWN declaration is in the user's source (not a library / built-in). This expands user handles /
  // interfaces / anonymous objects but skips `string`→String-methods, `Effect`/`Stream` internals, etc.
  const isExpandable = (type: ts.Type): boolean => {
    if (!(type.flags & ts.TypeFlags.Object)) return false;
    if (type.getCallSignatures().length > 0) return false;
    const props = type.getProperties();
    if (props.length === 0 || props.length > MAX_PROPS) return false;
    const sym = type.aliasSymbol ?? type.getSymbol();
    const decls = sym?.getDeclarations();
    if (decls && decls.length > 0) {
      // named type: only expand when it's declared in the user's source, not a dependency / lib.d.ts
      const inUserSrc = decls.some(
        (d) => !d.getSourceFile().fileName.includes("/node_modules/"),
      );
      if (!inUserSrc) return false;
    }
    return true;
  };

  // Per hover offset: the expanded member block (when worth expanding) AND the hovered symbol's
  // declaration location `relFile:line` — the key into the pre-resolved {@link} map, so hover docs
  // link the same as the pages.
  interface HoverInfo {
    readonly expanded?: string;
    readonly ownerLoc?: string;
  }

  /**
   * Given the block's full code and a set of full-code offsets, return offset → { expanded, ownerLoc }.
   */
  return (fullCode: string, offsets: readonly number[]): Map<number, HoverInfo> => {
    const out = new Map<number, HoverInfo>();
    current = fullCode;
    version += 1;
    const program = service.getProgram();
    const sf = program?.getSourceFile(FILE);
    const checker = program?.getTypeChecker();
    if (!sf || !checker) return out;

    for (const offset of offsets) {
      const node = nodeAt(sf, offset);
      if (!node) continue;
      let expanded: string | undefined;
      let ownerLoc: string | undefined;

      // owner location: the declaration of the hovered symbol (keys the {@link} map)
      const sym = checker.getSymbolAtLocation(node);
      const decl = sym?.getDeclarations()?.[0];
      if (decl !== undefined) {
        const f = decl.getSourceFile();
        const line = f.getLineAndCharacterOfPosition(decl.getStart()).line + 1;
        ownerLoc = `${nodePath.relative(opts.vfsRoot, f.fileName)}:${line}`;
      }

      // expanded member block (existing dual-preview)
      const type = checker.getTypeAtLocation(node);
      if (isExpandable(type)) {
        const lines: string[] = [];
        for (const member of type.getProperties()) {
          const mt = checker.getTypeOfSymbolAtLocation(member, node);
          let rendered = checker
            .typeToString(mt, node, FLAGS)
            .replace(/import\("[^"]*"\)\./g, "")
            .replace(/\s*\n\s*/g, " ");
          if (rendered.length > MAX_MEMBER_LEN)
            rendered = `${rendered.slice(0, MAX_MEMBER_LEN - 1)}…`;
          lines.push(`  ${member.getName()}: ${rendered};`);
        }
        expanded = `{\n${lines.join("\n")}\n}`;
      }

      if (expanded !== undefined || ownerLoc !== undefined) out.set(offset, { expanded, ownerLoc });
    }
    return out;
  };
};
