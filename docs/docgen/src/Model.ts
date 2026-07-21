/**
 * The API model the docgen extracts and the site renders. Schema IS the source of truth — the
 * interfaces derive from it and the JSON round-trips through a codec (no hand-rolled shapes). Field
 * order and optionality match what the pipeline writes today, so a swap to the extractor is
 * byte-identical.
 *
 * @since 1.0.0
 */
import * as Schema from "effect/Schema";

/**
 * A resolved JSDoc tag (`@category`, `@since`, …).
 *
 * @category model
 * @since 1.0.0
 */
export const tag = Schema.Struct({
  name: Schema.String,
  text: Schema.String,
});

/**
 * A resolved JSDoc tag.
 *
 * @category model
 * @since 1.0.0
 */
export interface Tag extends Schema.Schema.Type<typeof tag> {}

/**
 * Where a symbol is declared — repo-relative file, 1-based line, and a "view source" URL.
 *
 * @category model
 * @since 1.0.0
 */
export const source = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  url: Schema.optional(Schema.String),
});

/**
 * A symbol's declaration location.
 *
 * @category model
 * @since 1.0.0
 */
export interface Source extends Schema.Schema.Type<typeof source> {}

/**
 * One documented export — everything a symbol page needs. `docLinks` and `source.url` are filled after
 * extraction (once every symbol has a URL / the repo base is known).
 *
 * @category model
 * @since 1.0.0
 */
export const symbol = Schema.Struct({
  entry: Schema.String, // the namespace this symbol is grouped under ("(top-level)" for bare exports)
  name: Schema.String, // the bare export name
  qualifiedName: Schema.String, // how you reach it: `Namespace.name`, or just `name` at top level
  url: Schema.String,
  kind: Schema.String,
  signatures: Schema.Array(Schema.String), // one per overload (empty for non-callables)
  typeText: Schema.optional(Schema.String), // for non-callable values / type aliases / interfaces
  sourceText: Schema.String, // the export's actual source (the declaration as written), shown verbatim
  summary: Schema.String, // resolved doc summary (previews / search)
  rawComment: Schema.String, // raw /** … */ with {@link} intact (the site re-renders this)
  tags: Schema.Array(tag),
  category: Schema.optional(Schema.String),
  linkTargets: Schema.Array(Schema.String), // {@link X} names referenced
  docLinks: Schema.Record(Schema.String, Schema.String), // {@link X} -> resolved doc URL (compiler-resolved)
  source,
});

/**
 * A documented export.
 *
 * @category model
 * @since 1.0.0
 */
export interface Symbol extends Schema.Schema.Type<typeof symbol> {}

/**
 * One module entry — a namespace (or `(top-level)` for bare exports) and its symbols.
 *
 * @category model
 * @since 1.0.0
 */
export const entry = Schema.Struct({
  entry: Schema.String,
  /** First paragraph of the module's leading `@module` JSDoc header ("" when the file has none). */
  summary: Schema.optional(Schema.String),
  symbols: Schema.Array(symbol),
});

/**
 * A module entry and its symbols.
 *
 * @category model
 * @since 1.0.0
 */
export interface Entry extends Schema.Schema.Type<typeof entry> {}
