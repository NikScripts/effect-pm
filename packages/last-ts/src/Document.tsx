/**
 * @module Document
 *
 * Head chrome — typed field bag + swappable renderer (`Document.make`).
 * Apps write with {@link ./Page.document}; Layers fulfill with {@link provide}.
 * Never `yield*` inside `()`. SSOT: `docs/handoffs/page-document-lock.md`.
 *
 * @public
 */
"use client";

import * as React from "react";
import { Context, Effect, Layer } from "effect";import * as core from "./internal/documentCore";
import * as docReact from "./internal/documentReact";

export type DocumentMeta = core.DocumentMeta;
export type DocumentLink = core.DocumentLink;
export type DocumentScript = core.DocumentScript;
export type BaseFields = core.BaseFields;
export type FieldsOf<Extras extends object = {}> = core.FieldsOf<Extras>;
export type Patch<F extends object = BaseFields> = core.Patch<F>;

export const PatchTypeId = core.PatchTypeId;
export const isPatch = core.isPatch;

import { Cell, Fields } from "./internal/documentReact";

/** Current fields (`yield* Document.Fields` inside `Document.make` render). @public */
export { Cell, Fields };

const DocumentTypeId = "~last-ts/Document" as const;

export type AnyDocument<Extras extends object = {}> = {
  readonly [DocumentTypeId]: typeof DocumentTypeId;
  readonly key: string;
  readonly render: docReact.HeadRender;
  readonly Head: React.FC;
  readonly "~last-ts/Document/fields": FieldsOf<Extras>;
};

const identityTitle = (title: string): string => title;

/**
 * Mint a Document — Effect → head children; fields via {@link Fields}.
 *
 * @public
 */
export const make =
  <Extras extends object = {}>() =>
  (
    key: string,
    render: Effect.Effect<React.ReactNode, never, Fields>,
  ): (abstract new (_: never) => {}) & AnyDocument<Extras> => {
    const Head = docReact.makeHeadComponent(render);
    const Doc = class {
      static readonly [DocumentTypeId] = DocumentTypeId;
      static readonly key = key;
      static readonly render = render;
      static readonly Head = Head;
      declare static readonly "~last-ts/Document/fields": FieldsOf<Extras>;
    };
    return Doc as unknown as (abstract new (_: never) => {}) &
      AnyDocument<Extras>;
  };

const isDocumentClass = (u: unknown): u is AnyDocument =>
  typeof u === "function" &&
  u !== null &&
  DocumentTypeId in u &&
  (u as unknown as AnyDocument)[DocumentTypeId] === DocumentTypeId;

/** Package default Document. @public */
export class Default extends make()(
  "last-ts/Document/default",
  Effect.gen(function* () {
    const {
      title,
      titleTransform,
      description,
      meta,
      links,
      scripts,
      styles,
    } = yield* Fields;
    const resolved = titleTransform(title);
    return (
      <>
        <title>{resolved}</title>
        {description !== undefined ? (
          <meta name="description" content={description} />
        ) : null}
        {meta.map((m, i) => (
          <meta
            key={`meta-${i}`}
            name={m.name}
            property={m.property}
            httpEquiv={m.httpEquiv}
            content={m.content}
          />
        ))}
        {links.map((l, i) => (
          <link
            key={`link-${i}`}
            rel={l.rel}
            href={l.href}
            media={l.media}
            as={l.as}
            type={l.type}
            crossOrigin={l.crossOrigin as "anonymous" | "use-credentials" | "" | undefined}
            sizes={l.sizes}
          />
        ))}
        {styles.map((css, i) => (
          <style key={`style-${i}`}>{css}</style>
        ))}
        {scripts.map((s, i) =>
          s.content !== undefined ? (
            <script key={`script-${i}`} type={s.type}>
              {s.content}
            </script>
          ) : (
            <script
              key={`script-${i}`}
              src={s.src}
              type={s.type}
              async={s.async}
              defer={s.defer}
            />
          ),
        )}
      </>
    );
  }),
) {}

/**
 * Active head slot — renders the cell’s current Document Head.
 *
 * @public
 */
export const Head: Context.Reference<React.FC> = Context.Reference(
  "last-ts/Document/Head",
  { defaultValue: () => docReact.ReferenceHead },
);

/**
 * Branded patch. Pass a Document class to tighten `prev` to its fields.
 *
 * @public
 */
export const transform: {
  <F extends object>(fn: (prev: F) => F): Patch<F>;
  <D extends AnyDocument<any>>(
    doc: D,
    fn: (prev: D["~last-ts/Document/fields"]) => D["~last-ts/Document/fields"],
  ): Patch<D["~last-ts/Document/fields"]>;
} = ((
  first: ((prev: any) => any) | AnyDocument,
  second?: (prev: any) => any,
): Patch<any> => {
  if (typeof first === "function" && !isDocumentClass(first) && second === undefined) {
    return core.makePatch(first as (prev: any) => any);
  }
  return core.makePatch(second as (prev: any) => any);
}) as typeof transform;

/** @public */
export const title = (value: string): Patch<BaseFields> =>
  transform((prev) => ({ ...prev, title: value }));

/** @public */
export const titleTransform = (
  fn: (title: string) => string,
): Patch<BaseFields> => transform((prev) => ({ ...prev, titleTransform: fn }));

/** @public */
export const description = (
  value: string | undefined,
): Patch<BaseFields> => transform((prev) => ({ ...prev, description: value }));

/** @public */
export const lang = (value: string): Patch<BaseFields> =>
  transform((prev) => ({ ...prev, lang: value }));

/** @public */
export const meta = (entry: DocumentMeta): Patch<BaseFields> =>
  transform((prev) => ({
    ...prev,
    meta: [...(prev.meta ?? []), entry],
  }));

/** @public */
export const link = (entry: DocumentLink): Patch<BaseFields> =>
  transform((prev) => ({
    ...prev,
    links: [...(prev.links ?? []), entry],
  }));

/** @public */
export const styleSheet = (
  href: string,
  opts?: { readonly media?: string },
): Patch<BaseFields> =>
  link({ rel: "stylesheet", href, media: opts?.media });

/** @public */
export const style = (css: string): Patch<BaseFields> =>
  transform((prev) => ({
    ...prev,
    styles: [...(prev.styles ?? []), css],
  }));

/** @public */
export const script = (entry: DocumentScript): Patch<BaseFields> =>
  transform((prev) => ({
    ...prev,
    scripts: [...(prev.scripts ?? []), entry],
  }));

type ProvideArg = core.ProvideArg<
  core.BaseFieldsPartial & Record<string, unknown>
>;

/**
 * Build the fields cell from a full provide fold (shared by Layer + RSC root).
 *
 * @public
 */
export const makeCell = (
  doc: AnyDocument<any>,
  ...args: ReadonlyArray<ProvideArg>
): docReact.DocumentCell => {
  const folded = core.foldArgs(
    {
      ...core.emptyPartial(),
      titleTransform: identityTitle,
    },
    args,
  );
  return docReact.cellFromProvide(folded, doc.Head);
};

/**
 * Layer fulfill — complete bag required; installs {@link Cell} for
 * {@link ./Page.document} + React {@link FieldsProvider} via {@link ./Last.provider}.
 *
 * @public
 */
export const provide = (
  doc: AnyDocument<any>,
  ...args: ReadonlyArray<ProvideArg>
): Layer.Layer<Cell> => Layer.succeed(Cell, makeCell(doc, ...args));

/**
 * Apply `Page.document` args to {@link Cell}.
 *
 * @internal
 */
export const applyDocumentArgs = (
  ...args: ReadonlyArray<unknown>
): Effect.Effect<void, never, Cell> =>
  Effect.gen(function* () {
    const cell = yield* Cell;
    let rest = args;
    if (rest.length > 0 && isDocumentClass(rest[0])) {
      const doc = rest[0];
      rest = rest.slice(1);
      cell.setHead(doc.Head);
    }
    const patches: Array<ProvideArg> = [];
    for (const arg of rest) {
      if (core.isPatch(arg)) {
        patches.push(arg);
      } else if (typeof arg === "object" && arg !== null) {
        patches.push(arg as ProvideArg);
      }
    }
    if (patches.length === 0) return;
    cell.update((prev) => {
      const asPartial: core.BaseFieldsPartial = { ...prev };
      const folded = core.foldArgs(asPartial, patches);
      const next = core.finalizeFields(folded);
      return (next ?? prev) as BaseFields;
    });
  });

export {
  Provider as FieldsProvider,
  useFields,
  useCell,
  cellFromProvide,
  ReferenceHead,
  type DocumentCell,
} from "./internal/documentReact";
