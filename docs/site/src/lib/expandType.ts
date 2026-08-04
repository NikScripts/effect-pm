// Compiler-API type expansion for the docs "dual preview".
//
// Twoslash gives us each hover's COMPACT type (e.g. `WorkPool<{ to: string }>`). To show the
// full member shape in the SAME popover — the split prettify-ts gives in the editor — we run our own
// language service over the block's full code (imports + `---cut---` preamble included) and, at each
// hover position, expand the value's type to its members via the checker.
//
// This must be a compiler-API walk, not a `Prettify<T>` type: a written type alias is echoed
// as-written, only an inferred/compiler-resolved type resolves a mapped type to concrete members.

import * as nodePath from "node:path";
import * as ts from "typescript";
import { Effect, Layer, Option } from "effect";
import * as Annotate from "@nikscripts/docgen/Annotate";
import * as LinkResolver from "@nikscripts/docgen/LinkResolver";
import * as SymbolIndex from "@nikscripts/docgen/SymbolIndex";
import * as TsProgram from "@nikscripts/docgen/TsProgram";
import * as TypePrinter from "@nikscripts/docgen/TypePrinter";

export interface ExpanderOptions {
  readonly compilerOptions: ts.CompilerOptions;
  readonly vfsRoot: string;
  /**
   * The documented declarations' location→url entries (api-data/locations.json), read lazily —
   * they load AFTER the expander is constructed. Present = each hover also carries its
   * compiler-printed type parts (`typeText` + `links`) for zero-guess popup linking.
   */
  readonly getLocations?: () => ReadonlyArray<SymbolIndex.Entry>;
  /**
   * Extra `paths` merged into the compiler options (read lazily, same loading story) — maps
   * package imports to the DOCUMENTED source so guide-example hovers resolve to declarations the
   * location index knows. Only this expander program uses it; twoslash (display text, diagnostics)
   * keeps resolving the real runtime dependencies.
   */
  readonly getPaths?: () => Readonly<Record<string, Array<string>>>;
}

const FILE = "__docs_expand__.ts";

// The wrapper lines OUR pipelines prepend around real source (highlightSourceWithHovers and
// gen-hovers). When a block carries `// @filename: <rel>`, stripping exactly these reconstructs the
// real file text, and hosting it AT the real path makes every resolution real: relative imports
// resolve, and self-declared symbols land on their true file:line — the SymbolIndex's key.
const directiveLine = /^\/\/ (?:@noErrors|@filename: .*|---cut---|---cut-after---)\s*$/;

interface Prepared {
  readonly fileName: string; // the language-service file name (absolute)
  readonly text: string; // the content the language service sees
  readonly toLocal: (fullOffset: number) => number; // full-code offset → offset in `text`
}

/** Reusable expander: one language service, swap the in-memory file per block (fast across a page). */
export const makeTypeExpander = (opts: ExpanderOptions) => {
  let current = "";
  let currentFile = nodePath.join(opts.vfsRoot, FILE);
  let version = 0;
  let cachedPaths: Readonly<Record<string, Array<string>>> | undefined;
  let cachedSettings: ts.CompilerOptions = opts.compilerOptions;

  const prepare = (fullCode: string): Prepared => {
    const named = /^\/\/ @filename: (.+)$/m.exec(fullCode);
    if (named === null) {
      // A synthetic doc block — compile as-is under the virtual name (directives are inert comments).
      return {
        fileName: nodePath.join(opts.vfsRoot, FILE),
        text: fullCode,
        toLocal: (offset) => offset,
      };
    }
    const lines = fullCode.split("\n");
    const removals: Array<readonly [number, number]> = [];
    const kept: Array<string> = [];
    let pos = 0;
    for (const line of lines) {
      const lineEnd = pos + line.length + 1;
      if (directiveLine.test(line)) removals.push([pos, lineEnd]);
      else kept.push(line);
      pos = lineEnd;
    }
    return {
      fileName: nodePath.join(opts.vfsRoot, named[1].trim()),
      text: kept.join("\n"),
      toLocal: (offset) => {
        let local = offset;
        for (const [start, end] of removals) if (end <= offset) local -= end - start;
        return local;
      },
    };
  };

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [currentFile],
    // Only OUR file changes between blocks; imported files (`effect`, `src`) are stable, so give them
    // a constant version — otherwise the registry re-parses the entire library on every block (the
    // slowdown that hung handle-heavy pages).
    getScriptVersion: (f) => (f === currentFile ? String(version) : "1"),
    getScriptSnapshot: (f) =>
      f === currentFile
        ? ts.ScriptSnapshot.fromString(current)
        : ts.sys.fileExists(f)
        ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)!)
        : undefined,
    getCurrentDirectory: () => opts.vfsRoot,
    getCompilationSettings: (): ts.CompilerOptions => {
      // Merge the (lazily-loaded) documented-source paths ONCE per change — the language service
      // compares settings by identity, so a fresh object per call would re-parse the world.
      const paths = opts.getPaths?.();
      if (paths !== cachedPaths) {
        cachedPaths = paths;
        cachedSettings =
          paths === undefined || Object.keys(paths).length === 0
            ? opts.compilerOptions
            : {
                ...opts.compilerOptions,
                paths: {
                  ...opts.compilerOptions.paths,
                  ...paths,
                },
              };
      }
      return cachedSettings;
    },
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => f === currentFile || ts.sys.fileExists(f),
    readFile: (f) => (f === currentFile ? current : ts.sys.readFile(f)),
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
      const inUserSrc = decls.some((d) => !d.getSourceFile().fileName.includes("/node_modules/"));
      if (!inUserSrc) return false;
    }
    return true;
  };

  // Per hover offset: the expanded member block (when worth expanding), the hovered symbol's
  // declaration location `relFile:line` (the key into the pre-resolved {@link} map, so hover docs
  // link the same as the pages), and the hover type as OUR compiler prints it — text plus exact
  // link ranges — for zero-guess popup linking (realigned onto the displayed text downstream).
  interface HoverInfo {
    readonly expanded?: string;
    readonly expandedLinks?: ReadonlyArray<Annotate.Link>; // offsets into `expanded`
    readonly ownerLoc?: string;
    readonly ownerUrl?: string; // the hovered symbol's OWN doc page (its declaration in the index)
    readonly typeText?: string;
    readonly typeLinks?: ReadonlyArray<Annotate.Link>;
  }

  // location "file:line" → doc url, built lazily from getLocations (loads after construction).
  let ownerIndex: Map<string, string> | undefined;
  let ownerIndexSize = -1;
  const ownerUrlOf = (loc: string): string | undefined => {
    const entries = opts.getLocations?.() ?? [];
    if (ownerIndex === undefined || entries.length !== ownerIndexSize) {
      ownerIndex = new Map(entries.map((entry) => [`${entry.file}:${entry.line}`, entry.url]));
      ownerIndexSize = entries.length;
    }
    return ownerIndex.get(loc);
  };

  // The parsed type annotation on a symbol's declaration, when it has one — property signatures,
  // variables, parameters, class fields. Real nodes resolve exactly; synthesized prints may not.
  const annotationOf = (symbol: ts.Symbol | undefined): ts.TypeNode | undefined => {
    const declaration = symbol?.valueDeclaration;
    if (declaration === undefined) return undefined;
    return ts.isPropertySignature(declaration) ||
      ts.isVariableDeclaration(declaration) ||
      ts.isParameter(declaration) ||
      ts.isPropertyDeclaration(declaration)
      ? declaration.type
      : undefined;
  };

  // Only a module-scope declaration site owns a page — a parameter/local/member shares its
  // statement's LINE and must not claim the enclosing export's page (the LinkResolver's rule).
  const pageOwner = (decl: ts.Declaration): ts.Node | undefined => {
    const owner =
      ts.isVariableDeclaration(decl) && ts.isVariableDeclarationList(decl.parent)
        ? decl.parent.parent
        : decl;
    return !ts.isSourceFile(owner) &&
      (ts.isSourceFile(owner.parent) || ts.isModuleBlock(owner.parent))
      ? owner
      : undefined;
  };

  // The docgen TypePrinter over THIS program — rebuilt per block (the program changes with the
  // swapped file), resolving through the same location index the source panels use.
  const printerFor = (program: ts.Program): TypePrinter.TypePrinter | undefined => {
    const locations = opts.getLocations?.() ?? [];
    if (locations.length === 0) return undefined;
    return Effect.runSync(
      TypePrinter.TypePrinter.pipe(
        Effect.provide(
          TypePrinter.layer.pipe(
            Layer.provideMerge(LinkResolver.layer({ repoRoot: opts.vfsRoot })),
            Layer.provideMerge(
              Layer.mergeAll(
                Layer.succeed(TsProgram.TsProgram)(TsProgram.fromProgram(program)),
                SymbolIndex.layer(locations)
              )
            )
          )
        )
      )
    );
  };

  /**
   * Given the block's full code and a set of full-code offsets, return offset → { expanded, ownerLoc }.
   */
  return (fullCode: string, offsets: readonly number[]): Map<number, HoverInfo> => {
    const out = new Map<number, HoverInfo>();
    const prep = prepare(fullCode);
    current = prep.text;
    currentFile = prep.fileName;
    version += 1;
    const program = service.getProgram();
    const sf = program?.getSourceFile(currentFile);
    const checker = program?.getTypeChecker();
    if (!sf || !checker) return out;
    const printer = program ? printerFor(program) : undefined;

    for (const offset of offsets) {
      const node = nodeAt(sf, prep.toLocal(offset));
      if (!node) continue;
      let expanded: string | undefined;
      let ownerLoc: string | undefined;
      let typeText: string | undefined;
      let typeLinks: ReadonlyArray<Annotate.Link> | undefined;

      // owner location: the declaration of the hovered symbol (keys the {@link} map), and its own
      // doc page when the index documents that declaration (the popup-head link on mobile)
      const sym = checker.getSymbolAtLocation(node);
      const decl = sym?.getDeclarations()?.[0];
      let ownerUrl: string | undefined;
      if (decl !== undefined) {
        const f = decl.getSourceFile();
        const rel = nodePath.relative(opts.vfsRoot, f.fileName);
        const line = f.getLineAndCharacterOfPosition(decl.getStart()).line + 1;
        ownerLoc = `${rel}:${line}`;
        const owner = pageOwner(decl);
        if (owner !== undefined) {
          const ownerLine = f.getLineAndCharacterOfPosition(owner.getStart()).line + 1;
          ownerUrl = ownerUrlOf(`${rel}:${ownerLine}`);
        }
      }

      // the hover type with exact link ranges. PREFER the parsed type ANNOTATION when the hovered
      // symbol's declaration has one: parsed nodes ALWAYS resolve (the builder sometimes
      // synthesizes references without symbols — `Hyperlink.Subscribable<QueueStatus>` came out
      // link-less), and the text is exactly what the author wrote. Inferred types fall back to
      // the checker print (with the TypePrinter's home retry).
      const type = checker.getTypeAtLocation(node);
      if (printer !== undefined) {
        const annotation = annotationOf(sym);
        const parts =
          annotation !== undefined ? printer.printNode(annotation) : printer.printType(type, node);
        const links = Annotate.fromParts(parts);
        if (links.length > 0) {
          typeText = parts.map((part) => part.text).join("");
          typeLinks = links;
        }
      }

      // expanded member block (dual-preview), each member type printed with compiler links when
      // the printer is available (falls back to the plain checker string otherwise)
      let expandedLinks: ReadonlyArray<Annotate.Link> | undefined;
      if (isExpandable(type)) {
        const lines: string[] = [];
        const links: Array<Annotate.Link> = [];
        let cursor = 2; // past the leading "{\n"
        // One member type → display text + text-relative links.
        // NOTE (capture-rate follow-up): the node builder only attaches symbols to references
        // whose names are in scope at `node` — library-internal member types often print
        // unresolvable here. Printing from `member.valueDeclaration` attached 154 members'
        // symbols on one hover in an experiment, but regressed block-authored shapes; the real
        // fix is a per-reference fallback inside the TypePrinter, with docgen-level tests.
        const renderType = (
          mt: ts.Type,
          annotation?: ts.TypeNode
        ): { readonly text: string; readonly links: ReadonlyArray<Annotate.Link> } => {
          if (printer !== undefined) {
            const parts =
              annotation !== undefined
                ? printer.printNode(annotation)
                : printer.printType(mt, node);
            const raw = parts.map((part) => part.text).join("");
            const collapsed = raw.replace(/\s*\n\s*/g, " ");
            const rawLinks = Annotate.fromParts(parts);
            return {
              text: collapsed,
              links:
                collapsed === raw
                  ? rawLinks
                  : Option.getOrElse(Annotate.realign(rawLinks, raw, collapsed), () => []),
            };
          }
          return {
            text: checker
              .typeToString(mt, node, FLAGS)
              .replace(/import\("[^"]*"\)\./g, "")
              .replace(/\s*\n\s*/g, " "),
            links: [],
          };
        };
        const pushMember = (
          name: string,
          mt: ts.Type,
          indent: string,
          annotation?: ts.TypeNode
        ): void => {
          const head = `${indent}${name}: `;
          const r = renderType(mt, annotation);
          let rendered = r.text;
          let memberLinks = r.links;
          if (rendered.length > MAX_MEMBER_LEN) {
            rendered = `${rendered.slice(0, MAX_MEMBER_LEN - 1)}…`;
            memberLinks = memberLinks.filter((link) => link.end <= MAX_MEMBER_LEN - 1);
          }
          for (const link of memberLinks) {
            links.push({
              start: cursor + head.length + link.start,
              end: cursor + head.length + link.end,
              url: link.url,
            });
          }
          const line = `${head}${rendered};`;
          lines.push(line);
          cursor += line.length + 1;
        };
        const pushRaw = (line: string): void => {
          lines.push(line);
          cursor += line.length + 1;
        };
        // Phantom brands (`~effect/...`), symbol-keyed members (`__@iterator@...`) and
        // `prototype` are machinery, not API — hide them so previews read as the real surface.
        const isVisible = (member: ts.Symbol): boolean =>
          !member.getName().startsWith("~") &&
          !member.getName().startsWith("__@") &&
          member.getName() !== "prototype";
        const visible = type.getProperties().filter(isVisible);

        // A SERVICE (Context.Service / Hyperlink.Service convention): the type carries `key` +
        // `Service`. Identify it and spell the service SHAPE out one member per line — the key
        // first, so the preview reads `class Random { key: 'app/Random'; Service: { … } }`.
        const serviceMember = visible.find((member) => member.getName() === "Service");
        const keyMember = visible.find((member) => member.getName() === "key");
        let serviceRendered = false;
        if (serviceMember !== undefined && keyMember !== undefined) {
          const serviceType = checker.getTypeOfSymbolAtLocation(serviceMember, node);
          const shape =
            (serviceType.flags & ts.TypeFlags.Object) !== 0 &&
            serviceType.getCallSignatures().length === 0
              ? serviceType.getProperties().filter(isVisible)
              : [];
          if (shape.length > 0 && shape.length <= MAX_PROPS) {
            pushMember(
              "key",
              checker.getTypeOfSymbolAtLocation(keyMember, node),
              "  ",
              annotationOf(keyMember)
            );
            pushRaw("  Service: {");
            for (const sub of shape) {
              pushMember(
                sub.getName(),
                checker.getTypeOfSymbolAtLocation(sub, node),
                "    ",
                annotationOf(sub)
              );
            }
            pushRaw("  };");
            for (const member of visible) {
              if (member !== serviceMember && member !== keyMember) {
                pushMember(
                  member.getName(),
                  checker.getTypeOfSymbolAtLocation(member, node),
                  "  ",
                  annotationOf(member)
                );
              }
            }
            serviceRendered = true;
          }
        }
        if (!serviceRendered) {
          for (const member of visible) {
            pushMember(
              member.getName(),
              checker.getTypeOfSymbolAtLocation(member, node),
              "  ",
              annotationOf(member)
            );
          }
        }
        // Every member can be phantom machinery (filtered above) — no box beats an empty one.
        if (lines.length > 0) {
          expanded = `{\n${lines.join("\n")}\n}`;
          if (links.length > 0) expandedLinks = links;
        }
      }

      if (expanded !== undefined || ownerLoc !== undefined || typeText !== undefined) {
        out.set(offset, { expanded, expandedLinks, ownerLoc, ownerUrl, typeText, typeLinks });
      }
    }
    return out;
  };
};
