// Compiler-API type expansion for the docs "dual preview".
//
// Twoslash gives us each hover's COMPACT type (e.g. `QueueResource<{ to: string }>`). To show the
// full member shape in the SAME popover — the split prettify-ts gives in the editor — we run our own
// language service over the block's full code (imports + `---cut---` preamble included) and, at each
// hover position, expand the value's type to its members via the checker.
//
// This must be a compiler-API walk, not a `Prettify<T>` type: a written type alias is echoed
// as-written, only an inferred/compiler-resolved type resolves a mapped type to concrete members.

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
    getScriptVersion: () => String(version),
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

  /**
   * Given the block's full code and a set of full-code offsets, return offset → expanded member
   * block (or undefined when the type isn't an object worth expanding). The result is code-like text
   * ready to append under the compact type in the popover.
   */
  return (fullCode: string, offsets: readonly number[]): Map<number, string> => {
    const out = new Map<number, string>();
    current = fullCode;
    version += 1;
    const program = service.getProgram();
    const sf = program?.getSourceFile(FILE);
    const checker = program?.getTypeChecker();
    if (!sf || !checker) return out;

    for (const offset of offsets) {
      const node = nodeAt(sf, offset);
      if (!node) continue;
      const type = checker.getTypeAtLocation(node);
      const props = type.getProperties();
      // Only expand object-ish types with members and no call surface at the top level that already
      // reads fine; skip primitives / unions / functions where a member dump adds nothing.
      if (props.length === 0) continue;
      if (type.getCallSignatures().length > 0) continue;
      const lines: string[] = [];
      for (const sym of props) {
        const mt = checker.getTypeOfSymbolAtLocation(sym, node);
        const rendered = checker
          .typeToString(mt, node, FLAGS)
          .replace(/import\("[^"]*"\)\./g, "")
          .replace(/\s*\n\s*/g, " ");
        lines.push(`  ${sym.getName()}: ${rendered};`);
      }
      out.set(offset, `{\n${lines.join("\n")}\n}`);
    }
    return out;
  };
};
