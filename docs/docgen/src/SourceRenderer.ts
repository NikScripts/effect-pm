/**
 * Compiler-resolved links for a declaration's SOURCE — every identifier in a line span of a program
 * file, resolved through the {@link LinkResolver} exactly as an IDE would, as {@link Annotate.Link}
 * ranges relative to the span. Feed them to {@link Annotate.transformer} to render the source panel
 * with linked tokens; the caller owns slicing and any preamble shift (twoslash directives), so the
 * service stays a pure function of the program.
 *
 * @since 1.0.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import ts from "typescript";
import * as Annotate from "./Annotate.js";
import * as LinkResolver from "./LinkResolver.js";
import * as TsProgram from "./TsProgram.js";

const TypeId = "~docgen/SourceRenderer";

/**
 * A 1-based, inclusive line span of a program source file (`file` is the absolute path, as the
 * model's declaration spans are addressed).
 *
 * @category models
 * @since 1.0.0
 */
export interface Span {
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Resolves the linked identifier ranges of a source span.
 *
 * @category models
 * @since 1.0.0
 */
export interface SourceRenderer {
  readonly [TypeId]: typeof TypeId;
  /**
   * The doc links of every identifier inside the span, offsets relative to the span's first
   * character, in document order. None when the program has no such file or the span's start is
   * outside it — a silent empty result would read as "no links" and hide the wiring bug.
   */
  readonly links: (span: Span) => Option.Option<ReadonlyArray<Annotate.Link>>;
}

/**
 * The `SourceRenderer` service tag.
 *
 * @category tags
 * @since 1.0.0
 */
export const SourceRenderer: Context.Service<SourceRenderer, SourceRenderer> =
  Context.Service("docgen/SourceRenderer");

const linksWith = (
  resolver: LinkResolver.LinkResolver,
  sf: ts.SourceFile,
  span: Span
): Option.Option<ReadonlyArray<Annotate.Link>> => {
  const lineStarts = sf.getLineStarts();
  if (span.startLine < 1 || span.startLine > lineStarts.length) return Option.none();
  const spanStart = lineStarts[span.startLine - 1];
  const spanEnd = span.endLine < lineStarts.length ? lineStarts[span.endLine] : sf.text.length;
  if (spanEnd <= spanStart) return Option.none();
  const out: Array<Annotate.Link> = [];
  const visit = (node: ts.Node): void => {
    if (node.getStart(sf) >= spanEnd || node.getEnd() <= spanStart) return;
    if (ts.isIdentifier(node)) {
      const start = node.getStart(sf);
      if (start < spanStart || node.getEnd() > spanEnd) return;
      Option.match(resolver.resolve(node), {
        onNone: () => {},
        onSome: (url) =>
          out.push({
            start: start - spanStart,
            end: node.getEnd() - spanStart,
            url,
          }),
      });
      return;
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return Option.some(out);
};

/**
 * A {@link SourceRenderer} over the current {@link TsProgram} and {@link LinkResolver}.
 *
 * @category layers
 * @since 1.0.0
 */
export const layer: Layer.Layer<
  SourceRenderer,
  never,
  TsProgram.TsProgram | LinkResolver.LinkResolver
> = Layer.effect(SourceRenderer)(
  Effect.gen(function* () {
    const program = yield* TsProgram.TsProgram;
    const resolver = yield* LinkResolver.LinkResolver;
    return {
      [TypeId]: TypeId,
      links: (span) =>
        Option.flatMap(program.sourceFile(span.file), (sf) => linksWith(resolver, sf, span)),
    };
  })
);
