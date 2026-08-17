/**
 * @module Document
 *
 * Document head — typed field bag + swappable renderer (`Document.make`).
 * Apps write with {@link ./Page.document}; Layers fulfill with {@link provide}.
 * Never `yield*` inside `()`. SSOT: `docs/handoffs/page-document-lock.md`.
 *
 * @public
 */
"use client";

import * as React from "react";
import { Context, Effect, Layer } from "effect";
import * as core from "./internal/documentCore";
import * as docReact from "./internal/documentReact";

export type DocumentMeta = core.DocumentMeta;
export type DocumentLink = core.DocumentLink;
export type DocumentScript = core.DocumentScript;
export type BaseFields = core.BaseFields;
export type FieldsOf<Extras extends object = Record<never, never>> = core.FieldsOf<Extras>;
export type Patch<
  F extends object = BaseFields,
  C extends object = Record<never, never>,
> = core.Patch<F, C>;

export const PatchTypeId = core.PatchTypeId;
export const isPatch = core.isPatch;

import { Cell, Fields } from "./internal/documentReact";

/** Current fields (`yield* Document.Fields` inside `Document.make` render). @public */
export { Cell, Fields };

const DocumentTypeId = "~last-ts/Document" as const;

export type AnyDocument<Extras extends object = Record<never, never>> = {
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
  <Extras extends object = Record<never, never>>() =>
  (
    key: string,
    render: Effect.Effect<React.ReactNode, never, Fields>,
  ): (abstract new (_: never) => Record<never, never>) & AnyDocument<Extras> => {
    const Head = docReact.makeHeadComponent(render);
    const Doc = class {
      static readonly [DocumentTypeId] = DocumentTypeId;
      static readonly key = key;
      static readonly render = render;
      static readonly Head = Head;
      declare static readonly "~last-ts/Document/fields": FieldsOf<Extras>;
    };
    // SAFE: class-factory erasure — the statics assembled above ARE the AnyDocument shape;
    // TS cannot compose the abstract-constructor intersection from the build.
    return Doc as unknown as (abstract new (_: never) => Record<never, never>) &
      AnyDocument<Extras>;
  };

const isDocumentClass = (u: unknown): u is AnyDocument =>
  typeof u === "function" &&
  u !== null &&
  DocumentTypeId in u &&
  // SAFE: inside the guard that proves the shape — the brand equality IS the validation.
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
            crossOrigin={l.crossOrigin}
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
  <F extends object, C extends object = Record<never, never>>(
    fn: (prev: F) => F,
  ): Patch<F, C>;
  <D extends AnyDocument<any>, C extends object = Record<never, never>>(
    doc: D,
    fn: (prev: D["~last-ts/Document/fields"]) => D["~last-ts/Document/fields"],
  ): Patch<D["~last-ts/Document/fields"], C>;
} = ((
  first: ((prev: any) => any) | AnyDocument,
  second?: (prev: any) => any,
): Patch<any, any> => {
  if (typeof first === "function" && !isDocumentClass(first) && second === undefined) {
    // SAFE: guarded to a bare function; the overloads above pinned its real signature.
    return core.makePatch(first as (prev: any) => any);
  }
  // SAFE: in the two-arg overload `second` is the transform fn per the contract above.
  return core.makePatch(second as (prev: any) => any);
  // SAFE: erased impl behind the typed overloads — they are the source of truth.
}) as typeof transform;

/** @public */
export const title = (
  value: string,
): Patch<BaseFields, { readonly title: string }> =>
  core.makePatch((prev) => ({ ...prev, title: value }));

/** @public */
export const titleTransform = (
  fn: (title: string) => string,
): Patch<BaseFields, { readonly titleTransform: (title: string) => string }> =>
  core.makePatch((prev) => ({ ...prev, titleTransform: fn }));

/** @public */
export const description = (
  value: string | undefined,
): Patch<BaseFields, { readonly description: string | undefined }> =>
  core.makePatch((prev) => ({ ...prev, description: value }));

/** @public */
export const lang = (
  value: string,
): Patch<BaseFields, { readonly lang: string }> =>
  core.makePatch((prev) => ({ ...prev, lang: value }));

/** @public */
export const meta = (
  entry: DocumentMeta,
): Patch<BaseFields, { readonly meta: ReadonlyArray<DocumentMeta> }> =>
  core.makePatch((prev) => ({
    ...prev,
    meta: [...(prev.meta ?? []), entry],
  }));

/** @public */
export const link = (
  entry: DocumentLink,
): Patch<BaseFields, { readonly links: ReadonlyArray<DocumentLink> }> =>
  core.makePatch((prev) => ({
    ...prev,
    links: [...(prev.links ?? []), entry],
  }));

/** @public */
export const styleSheet = (
  href: string,
  opts?: { readonly media?: string },
): Patch<BaseFields, { readonly links: ReadonlyArray<DocumentLink> }> =>
  link({ rel: "stylesheet", href, media: opts?.media });

/** @public */
export const style = (
  css: string,
): Patch<BaseFields, { readonly styles: ReadonlyArray<string> }> =>
  core.makePatch((prev) => ({
    ...prev,
    styles: [...(prev.styles ?? []), css],
  }));

/** @public */
export const script = (
  entry: DocumentScript,
): Patch<BaseFields, { readonly scripts: ReadonlyArray<DocumentScript> }> =>
  core.makePatch((prev) => ({
    ...prev,
    scripts: [...(prev.scripts ?? []), entry],
  }));

type ProvideArg = core.ProvideArg<
  core.BaseFieldsPartial & Record<string, unknown>
>;

/**
 * Build the fields cell from a full provide fold (shared by Layer + RSC root).
 * Incomplete required fields throw at runtime; prefer {@link provide} for Layers.
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
 * Layer fulfill — `title` + `titleTransform` required (type + runtime).
 * Installs {@link Cell} for {@link ./Page.document} + React {@link FieldsProvider}
 * via {@link ./Last.provider}.
 *
 * @public
 */
export const provide = <const Args extends ReadonlyArray<ProvideArg>>(
  doc: AnyDocument<any>,
  ...args: Args
): core.ProvideResult<Cell, Args> =>
  // SAFE: ProvideResult only refines the Layer error channel by Args at the type level;
  // makeCell performs the actual runtime validation (throws on missing title).
  Layer.succeed(Cell, makeCell(doc, ...args)) as core.ProvideResult<
    Cell,
    Args
  >;

export {
  Provider as FieldsProvider,
  useFields,
  useCell,
  cellFromProvide,
  ReferenceHead,
  type DocumentCell,
} from "./internal/documentReact";
