/**
 * Document fields, patches, and fold — no React.
 *
 * @internal
 */
import type { Effect } from "effect";

export const PatchTypeId = "~last-ts/Document/Patch" as const;

export type DocumentMeta = {
  readonly content: string;
  readonly name?: string;
  readonly property?: string;
  readonly httpEquiv?: string;
};

export type DocumentLink = {
  readonly rel: string;
  readonly href: string;
  readonly media?: string;
  readonly as?: string;
  readonly type?: string;
  readonly crossOrigin?: string;
  readonly sizes?: string;
};

export type DocumentScript = {
  readonly src?: string;
  readonly type?: string;
  readonly async?: boolean;
  readonly defer?: boolean;
  readonly content?: string;
};

/**
 * Library base bag. `title` + `titleTransform` required after `Document.provide`.
 *
 * @public
 */
export type BaseFields = {
  readonly title: string;
  readonly titleTransform: (title: string) => string;
  readonly description?: string;
  readonly lang?: string;
  readonly meta: ReadonlyArray<DocumentMeta>;
  readonly links: ReadonlyArray<DocumentLink>;
  readonly scripts: ReadonlyArray<DocumentScript>;
  readonly styles: ReadonlyArray<string>;
};

/** Partial bag used while folding provide / Page.document. @public */
export type BaseFieldsPartial = {
  readonly title?: string;
  readonly titleTransform?: (title: string) => string;
  readonly description?: string;
  readonly lang?: string;
  readonly meta?: ReadonlyArray<DocumentMeta>;
  readonly links?: ReadonlyArray<DocumentLink>;
  readonly scripts?: ReadonlyArray<DocumentScript>;
  readonly styles?: ReadonlyArray<string>;
};

export type FieldsOf<Extras extends object = {}> = BaseFields & Extras;
export type FieldsPartialOf<Extras extends object = {}> = BaseFieldsPartial &
  Partial<Extras>;

/**
 * Branded field patch for `Page.document` / `Document.provide` only.
 *
 * @public
 */
export type Patch<F extends object = BaseFields> = {
  readonly [PatchTypeId]: typeof PatchTypeId;
  readonly transform: (prev: F) => F;
};

export const isPatch = (u: unknown): u is Patch<any> =>
  typeof u === "object" &&
  u !== null &&
  PatchTypeId in u &&
  (u as Patch)[PatchTypeId] === PatchTypeId;

export const makePatch = <F extends object>(
  transform: (prev: F) => F,
): Patch<F> => ({
  [PatchTypeId]: PatchTypeId,
  transform,
});

/** Empty lists + identity transform; title unset until provide/page fills it. */
export const emptyPartial = (): BaseFieldsPartial => ({
  titleTransform: (title) => title,
  meta: [],
  links: [],
  scripts: [],
  styles: [],
});

export const mergePartial = <F extends BaseFieldsPartial>(
  prev: F,
  next: Partial<F>,
): F => {
  const out: Record<string, unknown> = { ...prev };
  for (const key of Object.keys(next) as Array<keyof F>) {
    const value = next[key];
    if (value !== undefined) {
      out[key as string] = value;
    }
  }
  return out as F;
};

export type ProvideArg<F extends object> = Patch<F> | Partial<F>;

export const foldArgs = <F extends BaseFieldsPartial>(
  initial: F,
  args: ReadonlyArray<ProvideArg<F>>,
): F => {
  let acc = initial;
  for (const arg of args) {
    if (isPatch(arg)) {
      acc = arg.transform(acc as never) as F;
    } else {
      acc = mergePartial(acc, arg as Partial<F>);
    }
  }
  return acc;
};

export type CompleteFields<F extends BaseFieldsPartial> = F & {
  readonly title: string;
  readonly titleTransform: (title: string) => string;
  readonly meta: ReadonlyArray<DocumentMeta>;
  readonly links: ReadonlyArray<DocumentLink>;
  readonly scripts: ReadonlyArray<DocumentScript>;
  readonly styles: ReadonlyArray<string>;
};

export const finalizeFields = <F extends BaseFieldsPartial>(
  folded: F,
): CompleteFields<F> | undefined => {
  if (typeof folded.title !== "string") return undefined;
  const titleTransform =
    folded.titleTransform ?? ((title: string) => title);
  return {
    ...folded,
    title: folded.title,
    titleTransform,
    meta: folded.meta ?? [],
    links: folded.links ?? [],
    scripts: folded.scripts ?? [],
    styles: folded.styles ?? [],
  } as CompleteFields<F>;
};

/** Mutable cell for Page.document merges (Effect + React bridge). @internal */
export type FieldsCell<F extends object = BaseFields> = {
  readonly get: () => F;
  readonly update: (f: (prev: F) => F) => void;
  readonly subscribe: (listener: () => void) => () => void;
};

/** @internal — widen cell without importing React in this file */
export type FieldsCellApi<F extends object = BaseFields> = FieldsCell<F>;
