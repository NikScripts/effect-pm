/**
 * A global index from a symbol's DECLARATION LOCATION (`repo-relative file` + 1-based line) to its doc
 * URL. Compiler resolution lands on a declaration; the index turns that declaration back into the page
 * we published for it — across packages, since it spans every documented symbol.
 *
 * Kept decoupled from extraction: it takes plain {@link Entry} values, so the same index serves a live
 * program, a test, or the full model.
 *
 * @since 1.0.0
 */
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

const TypeId = "~docgen/SymbolIndex";

/**
 * One documented symbol's declaration location and the page it maps to.
 *
 * @category models
 * @since 1.0.0
 */
export interface Entry {
  /** Declaration file, repo-relative (matches a resolved declaration's path). */
  readonly file: string;
  /** 1-based declaration line (the statement line, as the extractor records it). */
  readonly line: number;
  /** The doc-page URL for the symbol declared there. */
  readonly url: string;
}

/**
 * Declaration location → doc URL.
 *
 * @category models
 * @since 1.0.0
 */
export interface SymbolIndex {
  readonly [TypeId]: typeof TypeId;
  /** The doc URL for the symbol declared at `file`:`line`, or none. */
  readonly urlAt: (file: string, line: number) => Option.Option<string>;
}

/**
 * The `SymbolIndex` service tag.
 *
 * @category tags
 * @since 1.0.0
 */
export const SymbolIndex: Context.Service<SymbolIndex, SymbolIndex> =
  Context.Service("docgen/SymbolIndex");

const keyOf = (file: string, line: number): string => `${file}#${line}`;

/**
 * A {@link SymbolIndex} over the given entries. One URL per location (a declaration maps to a single
 * page); duplicate locations keep the last.
 *
 * @category layers
 * @since 1.0.0
 */
export const layer = (entries: Iterable<Entry>): Layer.Layer<SymbolIndex> =>
  Layer.sync(SymbolIndex)(() => {
    const byLocation = new Map<string, string>();
    for (const entry of entries) byLocation.set(keyOf(entry.file, entry.line), entry.url);
    return {
      [TypeId]: TypeId,
      urlAt: (file, line) => Option.fromNullishOr(byLocation.get(keyOf(file, line))),
    };
  });
