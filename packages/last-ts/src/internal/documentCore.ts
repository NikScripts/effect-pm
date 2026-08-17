/**
 * Document fields, patches, and fold — no React.
 *
 * @internal
 */
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
  /** The DOM attribute's closed vocabulary — typed here so render needs no cast. */
  readonly crossOrigin?: "anonymous" | "use-credentials" | "";
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

export type FieldsOf<Extras extends object = Record<never, never>> = BaseFields & Extras;
export type FieldsPartialOf<Extras extends object = Record<never, never>> = BaseFieldsPartial &
  Partial<Extras>;

/** Phantom contrib bag on sugars for {@link ProvideResult}. @internal */
export const ContributesTypeId = "~last-ts/Document/contributes" as const;

/**
 * Branded field patch for `Page.document` / `Document.provide` only.
 * `C` is a phantom of keys this patch contributes (for provide completeness).
 *
 * @public
 */
export type Patch<F extends object = BaseFields, C extends object = Record<never, never>> = {
  readonly [PatchTypeId]: typeof PatchTypeId;
  readonly transform: (prev: F) => F;
  readonly [ContributesTypeId]?: C;
};

export const isPatch = (u: unknown): u is Patch<any, any> =>
  typeof u === "object" &&
  u !== null &&
  PatchTypeId in u &&
  (u as Patch)[PatchTypeId] === PatchTypeId;

export const makePatch = <F extends object, C extends object = Record<never, never>>(
  transform: (prev: F) => F,
): Patch<F, C> => ({
  [PatchTypeId]: PatchTypeId,
  transform,
});

/** Flatten `&` nests for readable hovers. @internal */
type Flat<T extends object> = { readonly [K in keyof T]: T[K] } & {};

/** Last-wins merge. @internal */
export type MergeLast<A extends object, B extends object> = Flat<
  Omit<A, keyof B> & B
>;

export type RequiredKeys<S extends object> = {
  [K in keyof S]-?: undefined extends S[K] ? never : K;
}[keyof S];

export type MissingKeys<S extends object, P extends object> = Exclude<
  RequiredKeys<S>,
  keyof P
>;

export type IsComplete<S extends object, P extends object> =
  [MissingKeys<S, P>] extends [never]
    ? [RequiredKeys<S>] extends [never]
      ? true
      : {
          [K in RequiredKeys<S>]: K extends keyof P
            ? [P[K]] extends [S[K]]
              ? true
              : false
            : false;
        }[RequiredKeys<S>] extends true
        ? true
        : false
    : false;

/** Keys required after {@link ../Document.provide} fold. @internal */
export type ProvideRequired = {
  readonly title: string;
  readonly titleTransform: (title: string) => string;
};

/** Contrib bag of one provide arg (patch phantom or object literal). @internal */
export type ContribOf<A> = A extends Patch<any, infer C> ? C
  : A extends object ? A
  : Record<never, never>;

/** Left→right fold of provide arg contribs. @internal */
export type FoldContribs<Args extends ReadonlyArray<unknown>> =
  Args extends readonly [] ? Record<never, never>
  : Args extends readonly [infer Head, ...infer Tail]
    ? MergeLast<ContribOf<Head>, FoldContribs<Tail>>
    : Record<never, never>;

/**
 * {@link Layer} when contribs cover provide-required keys; else a diagnostic.
 *
 * @internal
 */
export type ProvideResult<
  CellTag,
  Args extends ReadonlyArray<unknown>,
> = IsComplete<ProvideRequired, FoldContribs<Args>> extends true
  ? import("effect/Layer").Layer<CellTag>
  : {
      readonly _error: "Document.provide: incomplete";
      readonly missing: MissingKeys<ProvideRequired, FoldContribs<Args>>;
    };

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
