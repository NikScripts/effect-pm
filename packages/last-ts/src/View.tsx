/**
 * @module View
 *
 * View **DI** (Context) + optional size chrome (card/detail/page) + React matchers.
 *
 * - Mint: `View.Card.Tag<Self, Props?>()(key, statics?)` — Effect-shaped.
 * - Provide: {@link provide}`(Tag, impl)` (or `Tag.provide(impl)`) — props infer from the Tag.
 * - Open debt: {@link SizeChrome} / {@link Prototype}`<Props, Requirement>` then fulfill size.
 * - Svc type is {@link View}`<Props>` (props in → element out). Defaults to {@link ViewProps}.
 * - Matchers on {@link react} kits (`ui.Card`) and {@link useMatch}.
 * - `View.bind` / `View.only` register sized handles; `View.react` needs Layer `R = never`.
 */
import * as React from "react";
import { Context, Data, Effect, Layer, Match, Option } from "effect";
import type * as Types from "effect/Types";

// =============================================================================
// Keys / kinds / props
// =============================================================================

/** Flatten `&` nests so Prototype / Tag hovers stay readable. @internal */
type Flat<T extends object> = { readonly [K in keyof T]: T[K] } & {};

/** Stable view id — prefer `app/view/<name>`. @public */
export type ViewKey = string;

/**
 * Building-block **sizes** as Effect tagged variants.
 * Content fills these — not separate kinds named after content.
 *
 * Construct with {@link ViewKind}.Card() / `.Detail()` / `.Page()`; match with
 * `Match.tag`.
 *
 * @public
 */
export type ViewKind = Data.TaggedEnum<{
  Card: {};
  Detail: {};
  Page: {};
}>;

/**
 * Constructors / `$is` / `$match` for {@link ViewKind}.
 *
 * @public
 */
export const ViewKind = Data.taggedEnum<ViewKind>();

/** `_tag` string of a {@link ViewKind} — `"Card" | "Detail" | "Page"`. @public */
export type ViewKindTag = ViewKind["_tag"];

/** Card size variant — `{ readonly _tag: "Card" }`. @public */
export type CardKind = ReturnType<typeof ViewKind.Card>;

/** Detail size variant — `{ readonly _tag: "Detail" }`. @public */
export type DetailKind = ReturnType<typeof ViewKind.Detail>;

/** Page size variant — `{ readonly _tag: "Page" }`. @public */
export type PageKind = ReturnType<typeof ViewKind.Page>;

/**
 * Size {@link Prototype} requirement — declare on chrome, fulfill with
 * `size: ViewKind.Card()` (etc.).
 *
 * @public
 */
export type WithSize<S extends ViewKind = ViewKind> = {
  readonly size: S;
};

/** Structural equality for tagged sizes. @internal */
const sameViewKind = (a: ViewKind, b: ViewKind): boolean => a._tag === b._tag;

/**
 * Tag a View skin may receive — structural key only (hosts may pass richer tags).
 *
 * @public
 */
export type ViewTag = { readonly key: string };

/**
 * Base props for size-chrome skins (card/detail/page). Navigation stays with the parent.
 *
 * @public
 */
export interface ViewProps {
  readonly tag: ViewTag;
  readonly name?: string;
}

/**
 * Layout / shell hints for View skins. Navigation is not here.
 *
 * @public
 */
export interface Chrome {
  readonly width?: number;
  readonly selected?: boolean;
  /** TUI focused panes (Ink). */
  readonly cols?: number;
  readonly rows?: number;
  readonly editMode?: boolean;
}

const ChromeContext = React.createContext<Chrome>({});

/**
 * Provide layout chrome for descendant View skins (e.g. TUI Cell → card width/selection).
 *
 * @public
 */
export const ChromeProvider = (props: {
  readonly value: Chrome;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(ChromeContext.Provider, { value: props.value }, props.children);

/** Read parent {@link Chrome} (empty object when none). @public */
export const useChrome = (): Chrome => React.useContext(ChromeContext);

/**
 * Component Svc for a View tag — **props in, element out** (reversed vs service APIs).
 * Defaults to {@link ViewProps} (card/detail/page chrome); pass a props bag for custom Prototypes.
 *
 * Prefer {@link provide} at the Layer boundary (props infer). Reach for `Tag["Service"]` only when
 * you need a named binding before provide.
 *
 * @public
 */
export type View<Props extends object = ViewProps> = (
  props: Props,
) => React.ReactElement | null;

/**
 * Provide a View skin for a Tag. Props infer from the Tag — no `Tag["Service"]` annotation.
 *
 * Dual: `View.provide(PoolCard, impl)` or `View.provide(PoolCard)(impl)`.
 * Minted Tags also expose {@link ViewHandle.provide} as `PoolCard.provide(impl)`.
 *
 * @public
 */
export function provide<I, P extends object>(
  tag: Context.Key<I, View<P>>,
): (impl: Types.NoInfer<View<P>>) => Layer.Layer<I>;
export function provide<I, P extends object>(
  tag: Context.Key<I, View<P>>,
  impl: Types.NoInfer<View<P>>,
): Layer.Layer<I>;
export function provide<I, P extends object>(
  tag: Context.Key<I, View<P>>,
  impl?: Types.NoInfer<View<P>>,
): Layer.Layer<I> | ((impl: Types.NoInfer<View<P>>) => Layer.Layer<I>) {
  if (impl === undefined) {
    return (resource) => Layer.succeed(tag, resource);
  }
  return Layer.succeed(tag, impl);
}

/**
 * A matched view ready to render (size chrome).
 *
 * @public
 */
export interface Resolved {
  readonly key: ViewKey;
  readonly kind: ViewKind;
  readonly Component: View;
}

// =============================================================================
// Prototype + Tag (DI core)
// =============================================================================

type AnyStatics = Record<string, unknown>;

/**
 * Discharge Requirement when statics already satisfy it (`{}` = fulfilled, like `R = never`).
 * @internal
 */
type NextRequirement<
  Requirement extends AnyStatics,
  Statics extends AnyStatics,
> = Statics extends Requirement ? {} : Requirement;

/**
 * Props bag — from a {@link Prototype}, a handle's {@link Type} phantom, or
 * instance `Service` (`PoolCard["Service"]`) without `typeof`.
 *
 * @public
 */
export type PropsOf<T> = T extends Prototype<infer Props, infer _R, infer _S>
  ? Props
  : T extends { readonly Service: View<infer P> }
    ? P
    : T extends { readonly Type: infer P extends object }
      ? P
      : never;

/**
 * Accumulated statics type for a {@link Prototype}.
 *
 * @public
 */
export type StaticsOf<P> = P extends Prototype<infer _P, infer _R, infer Statics>
  ? Statics
  : never;

/**
 * Open {@link Prototype} Requirement (debt). `{}` means fulfilled.
 *
 * @public
 */
export type RequirementOf<P> = P extends Prototype<infer _P, infer Requirement, infer _S>
  ? Requirement
  : never;

/**
 * Whether a {@link Prototype}'s Requirement is discharged (`{}`).
 *
 * @public
 */
export type IsFulfilled<P> = [keyof RequirementOf<P>] extends [never] ? true : false;

/**
 * Prototype with an open Requirement (statics may still be empty).
 *
 * @public
 */
export type OpenPrototype<
  Props extends object = ViewProps,
  Requirement extends AnyStatics = WithSize,
> = Prototype<Props, Requirement, {}>;

/**
 * Prototype whose Requirement is discharged (`{}`).
 *
 * @public
 */
export type FulfilledPrototype<
  Props extends object = ViewProps,
  Statics extends AnyStatics = {},
> = Prototype<Props, {}, Statics>;

/**
 * Constructable View handle from {@link Prototype.Tag}.
 *
 * @public
 */
export type ViewHandle<
  Self,
  K extends string,
  Props extends object,
  Statics extends AnyStatics = {},
> = Context.ServiceClass<Self, K, View<Props>> &
  Flat<Statics> & {
    /** Phantom — component props (`View.Type<typeof PoolCard>` / {@link PropsOf}). */
    readonly Type: Props;
    /**
     * Provide this Tag's skin — same as {@link provide}`(this, impl)`.
     * Props infer from the handle.
     */
    readonly provide: (impl: View<Props>) => Layer.Layer<Self>;
  };

/**
 * Component props via the Tag phantom (`typeof` path). Prefer {@link PropsOf}`<PoolCard>`
 * or peel from `PoolCard["Service"]`.
 *
 * @public
 */
export type Type<T> = T extends { readonly Type: infer P } ? P : never;

/**
 * Props + statics + an R-style **Requirement** type param (debt until discharged).
 *
 * @public
 */
export interface Prototype<
  in out Props extends object,
  in out Requirement extends AnyStatics = {},
  out Statics extends AnyStatics = {},
> {
  readonly statics: Statics;
  readonly Prototype: <NewProps extends object = {},>() => <
    const NewStatics extends AnyStatics = {},
  >(
    statics?: NewStatics,
  ) => Prototype<
    Flat<Props & NewProps>,
    NextRequirement<Requirement, Flat<Statics & NewStatics>>,
    Flat<Statics & NewStatics>
  >;
  readonly Tag: <Self, NewProps extends object = {}>() => <
    const K extends string,
    const NewStatics extends AnyStatics = {},
  >(
    key: K,
    statics?: NewStatics,
  ) => ViewHandle<Self, K, Flat<Props & NewProps>, Flat<Statics & NewStatics>>;
}

const makePrototype = <
  Props extends object,
  Requirement extends AnyStatics,
  Statics extends AnyStatics,
>(
  statics: Statics,
): Prototype<Props, Requirement, Statics> => ({
  statics,
  Prototype:
    <NewProps extends object = {},>() =>
    <const NewStatics extends AnyStatics = {},>(next?: NewStatics) => {
      type NextProps = Flat<Props & NewProps>;
      type NextStatics = Flat<Statics & NewStatics>;
      type NextReq = NextRequirement<Requirement, NextStatics>;
      return makePrototype<NextProps, NextReq, NextStatics>({
        ...statics,
        ...(next ?? ({} as NewStatics)),
      });
    },
  Tag:
    <Self, NewProps extends object = {}>() =>
    <const K extends string, const NewStatics extends AnyStatics = {}>(
      key: K,
      next?: NewStatics,
    ) => {
      type NextProps = Flat<Props & NewProps>;
      type NextStatics = Flat<Statics & NewStatics>;
      const merged = {
        ...statics,
        ...(next ?? ({} as NewStatics)),
      } as NextStatics;
      const base = Context.Service<Self, View<NextProps>>()(key);
      return Object.assign(base, merged, {
        Type: undefined as unknown as NextProps,
        provide: (impl: View<NextProps>): Layer.Layer<Self> =>
          Layer.succeed(base, impl),
      });
    },
});

/**
 * Start a prototype chain: `View.Prototype<Props, Requirement>()(statics?)`.
 *
 * @public
 */
export const Prototype =
  <Props extends object = {}, Requirement extends AnyStatics = {}>() =>
  <const Statics extends AnyStatics = {}>(
    statics?: Statics,
  ): Prototype<
    Props,
    NextRequirement<Requirement, Statics>,
    Statics
  > =>
    makePrototype<Props, NextRequirement<Requirement, Statics>, Statics>(
      (statics ?? {}) as Statics,
    );

/**
 * Naked View Tag — DI component handle with **no** size chrome.
 *
 * @public
 */
export const Tag = Prototype()().Tag;

/**
 * A View service handle (sized or naked). Sized chrome handles carry {@link ViewKind} `size`.
 *
 * @public
 */
export type AnyView<Self extends object = object> = Context.Service<
  Self,
  View<Self>
> & {
  readonly key: ViewKey;
  readonly size?: ViewKind;
  readonly spec?: unknown;
};

/**
 * Shared size-chrome shell — {@link WithSize} Requirement open (not fulfilled).
 *
 * @public
 */
export const SizeChrome: OpenPrototype<ViewProps, WithSize> = Prototype<
  ViewProps,
  WithSize
>()();

/**
 * Size-chrome add-ons — {@link SizeChrome} with size fulfilled.
 *
 * @public
 */
export const Card: FulfilledPrototype<
  ViewProps,
  WithSize<CardKind>
> = SizeChrome.Prototype()({ size: ViewKind.Card() });

/** @public */
export const Detail: FulfilledPrototype<
  ViewProps,
  WithSize<DetailKind>
> = SizeChrome.Prototype()({ size: ViewKind.Detail() });

/** @public */
export const Page: FulfilledPrototype<
  ViewProps,
  WithSize<PageKind>
> = SizeChrome.Prototype()({ size: ViewKind.Page() });

// =============================================================================
// Registry service
// =============================================================================

/** Bound chrome captured when a contribution Layer built (View service was provided). @internal */
type Bound = {
  readonly key: ViewKey;
  readonly kind: ViewKind;
  readonly Component: View;
};

/** @public */
export interface RegistryService {
  /** Append a view for one tag `.key` (multi-match). */
  readonly addTag: (tagKey: string, bound: Bound) => void;
  /** Append a view for a stamped kind string (multi-match). */
  readonly addKind: (kind: string, bound: Bound) => void;
  /**
   * Allowlist for one tag — **replaces** any prior `only` for that tag (last wins).
   * At match time, kinds present in the list are exclusive; other kinds still use add tables.
   */
  readonly setOnly: (tagKey: string, bounds: ReadonlyArray<Bound>) => void;
  readonly match: (
    tag: ViewTag,
    viewKind: ViewKind,
    kindHints?: ReadonlyArray<string>,
  ) => ReadonlyArray<Resolved>;
  readonly keys: () => ReadonlyArray<ViewKey>;
}

/**
 * View registry — contribution tables + match.
 *
 * @public
 */
export class Registry extends Context.Service<Registry, RegistryService>()(
  "last-ts/View/Registry",
) {}

const pushBound = (map: Map<string, Bound[]>, key: string, bound: Bound): void => {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [bound]);
    return;
  }
  if (!list.some((b) => b.key === bound.key)) list.push(bound);
};

/**
 * Build a registry service. Hosts pass {@link resolveKinds} to map tags to kind strings
 * for `byKind` lookup (default: none).
 *
 * @public
 */
export const makeRegistryService = (
  resolveKinds: (tag: ViewTag) => ReadonlyArray<string> = () => [],
): RegistryService => {
  const byTagKey = new Map<string, Bound[]>();
  const byKind = new Map<string, Bound[]>();
  /** tag.key → full allowlist from last `View.only` for that tag */
  const onlyByTagKey = new Map<string, Bound[]>();

  const fromBounds = (bounds: ReadonlyArray<Bound> | undefined, viewKind: ViewKind): Resolved[] => {
    if (bounds === undefined) return [];
    const out: Resolved[] = [];
    for (const bound of bounds) {
      if (!sameViewKind(bound.kind, viewKind)) continue;
      if (out.some((r) => r.key === bound.key)) continue;
      out.push({ key: bound.key, kind: bound.kind, Component: bound.Component });
    }
    return out;
  };

  return {
    addTag(tagKey, bound) {
      pushBound(byTagKey, tagKey, bound);
    },
    addKind(kind, bound) {
      pushBound(byKind, kind, bound);
    },
    setOnly(tagKey, bounds) {
      onlyByTagKey.set(tagKey, [...bounds]);
    },
    match(tag, viewKind, kindHints) {
      const allowlist = onlyByTagKey.get(tag.key);
      if (allowlist !== undefined) {
        const kindsPresent = new Set(allowlist.map((b) => b.kind._tag));
        if (kindsPresent.has(viewKind._tag)) {
          return fromBounds(allowlist, viewKind);
        }
      }

      const hints = kindHints ?? resolveKinds(tag);
      const out: Resolved[] = [];
      const seen = new Set<ViewKey>();
      const add = (list: ReadonlyArray<Resolved>) => {
        for (const r of list) {
          if (seen.has(r.key)) continue;
          seen.add(r.key);
          out.push(r);
        }
      };
      add(fromBounds(byTagKey.get(tag.key), viewKind));
      for (const kind of hints) {
        add(fromBounds(byKind.get(kind), viewKind));
      }
      return out;
    },
    keys() {
      const keys = new Set<ViewKey>();
      for (const list of byTagKey.values()) for (const b of list) keys.add(b.key);
      for (const list of byKind.values()) for (const b of list) keys.add(b.key);
      for (const list of onlyByTagKey.values()) for (const b of list) keys.add(b.key);
      return [...keys];
    },
  };
};

/**
 * Empty registry Layer — provide under contribution layers.
 *
 * @public
 */
export const layer: Layer.Layer<Registry> = Layer.sync(Registry, () =>
  makeRegistryService(),
);

/**
 * Shipped registry shell (no kind resolver).
 *
 * @public
 */
export const base: Layer.Layer<Registry> = layer;

/** Sized View handle — {@link WithSize} required for {@link bind} / {@link only}. @internal */
type ViewService<Id> = WithSize & {
  readonly key: ViewKey;
  readonly spec?: unknown;
} & Context.Key<Id, View>;

/** Avoid `Foo<Id>>` in .tsx return positions (parsed as JSX). */
type ContribLayer<R> = Layer.Layer<never, never, Registry | R>;

/**
 * Append one View for a stamped **kind** string or a concrete **tag**
 * (matched by `.key`). Multi-match / pager — merge with `Layer.mergeAll`.
 *
 * @public
 */
export const bind: {
  <Id>(stampedKind: string, view: ViewService<Id>): ContribLayer<Id>;
  <Id>(
    target: { readonly key: string },
    view: ViewService<Id>,
  ): ContribLayer<Id>;
} = <Id,>(
  targetOrKind: string | { readonly key: string },
  view: ViewService<Id>,
): ContribLayer<Id> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      const Component = yield* view;
      const bound = { key: view.key, kind: view.size, Component };
      if (typeof targetOrKind === "string") {
        reg.addKind(targetOrKind, bound);
      } else {
        reg.addTag(targetOrKind.key, bound);
      }
    }),
  );

/**
 * Allowlist for one tag. Kinds present are exclusive (defaults do not apply for
 * those kinds). Optional extra views share one allowlist (precise `R`). A later `only` for
 * the same tag **replaces** the whole allowlist (`Layer.mergeAll` → last wins).
 *
 * @public
 */
export const only = <Id1, Id2 = never, Id3 = never>(
  target: { readonly key: string },
  v1: ViewService<Id1>,
  v2?: ViewService<Id2>,
  v3?: ViewService<Id3>,
): ContribLayer<Id1 | Id2 | Id3> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      const bounds: Bound[] = [];
      const c1 = yield* v1;
      bounds.push({ key: v1.key, kind: v1.size, Component: c1 });
      if (v2 !== undefined) {
        const c2 = yield* v2;
        bounds.push({ key: v2.key, kind: v2.size, Component: c2 });
      }
      if (v3 !== undefined) {
        const c3 = yield* v3;
        bounds.push({ key: v3.key, kind: v3.size, Component: c3 });
      }
      reg.setOnly(target.key, bounds);
    }),
  );

// =============================================================================
// Fallbacks + react kit
// =============================================================================

const FallbackCard: View = (props) =>
  React.createElement(
    "div",
    { "data-last-view": "fallback-card" },
    props.name ?? props.tag.key,
  );

const FallbackDetail: View = (props) =>
  React.createElement(
    "div",
    { "data-last-view": "fallback-detail" },
    props.name ?? props.tag.key,
  );

const FallbackPage: View = (props) =>
  React.createElement(
    "div",
    { "data-last-view": "fallback-page" },
    props.name ?? props.tag.key,
  );

const fallbackFor = (viewKind: ViewKind): View =>
  Match.value(viewKind).pipe(
    Match.tag("Card", () => FallbackCard),
    Match.tag("Detail", () => FallbackDetail),
    Match.tag("Page", () => FallbackPage),
    Match.exhaustive,
  );

type KitContext = {
  readonly registry: RegistryService;
  readonly resolve: (tag: ViewTag, viewKind: ViewKind) => ReadonlyArray<Resolved>;
};

const RegistryReactContext = React.createContext<KitContext | null>(null);

/** Multi-match host — pager stub (first page); desktop tabs later. @internal */
const MatchHost = (props: {
  readonly viewKind: ViewKind;
  readonly resolved: ReadonlyArray<Resolved>;
  readonly tag: ViewTag;
  readonly name?: string;
}): React.ReactElement | null => {
  const list =
    props.resolved.length === 0
      ? [
          {
            key: `fallback/${props.viewKind._tag}`,
            kind: props.viewKind,
            Component: fallbackFor(props.viewKind),
          },
        ]
      : props.resolved;
  if (list.length === 1) {
    return React.createElement(list[0]!.Component, { tag: props.tag, name: props.name });
  }
  return React.createElement(
    "div",
    {
      "data-last-view": "pager",
      "data-view-kind": props.viewKind._tag,
      "data-page-count": list.length,
    },
    ...list.map((item, index) =>
      React.createElement(
        "div",
        { key: item.key, "data-last-view-page": index, hidden: index !== 0 },
        React.createElement(item.Component, { tag: props.tag, name: props.name }),
      ),
    ),
  );
};

/** Props for {@link react}`.for(tag)` bound matchers — tag is curated. @public */
export interface BoundViewProps {
  readonly name?: string;
}

const useKit = (): KitContext => {
  const value = React.useContext(RegistryReactContext);
  if (value === null) {
    throw new Error("View: render inside View.react(…).Provider");
  }
  return value;
};

/**
 * Whether the mounted View Provider has a match for this tag + kind.
 * `false` when no Provider or `tag` is null (safe before leaf narrowing).
 *
 * @public
 */
export const useHasMatch = (
  tag: ViewTag | null,
  viewKind: ViewKind,
): boolean => {
  const kit = React.useContext(RegistryReactContext);
  if (kit === null || tag === null) return false;
  return kit.resolve(tag, viewKind).length > 0;
};

/** Kit matcher — card size. @internal */
const MatchCard = (props: ViewProps): React.ReactElement | null =>
  React.createElement(MatchHost, {
    viewKind: ViewKind.Card(),
    resolved: useKit().resolve(props.tag, ViewKind.Card()),
    tag: props.tag,
    name: props.name,
  });

/** Kit matcher — detail size. @internal */
const MatchDetail = (props: ViewProps): React.ReactElement | null =>
  React.createElement(MatchHost, {
    viewKind: ViewKind.Detail(),
    resolved: useKit().resolve(props.tag, ViewKind.Detail()),
    tag: props.tag,
    name: props.name,
  });

/** Kit matcher — page size. @internal */
const MatchPage = (props: ViewProps): React.ReactElement | null =>
  React.createElement(MatchHost, {
    viewKind: ViewKind.Page(),
    resolved: useKit().resolve(props.tag, ViewKind.Page()),
    tag: props.tag,
    name: props.name,
  });

/**
 * Size matchers for descendants of {@link react}`(…).Provider`.
 *
 * @public
 */
export const useMatch = (): {
  readonly Card: View;
  readonly Detail: View;
  readonly Page: View;
} =>
  ({ Card: MatchCard, Detail: MatchDetail, Page: MatchPage });

/**
 * Build registry resolver from a **fully provided** view Layer (`R = never`).
 *
 * @internal
 */
const buildKit = <ROut, E,>(viewLayer: Layer.Layer<ROut, E, never>): KitContext =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(viewLayer);
        const registry = Option.getOrThrow(Context.getOption(ctx, Registry));
        return {
          registry,
          resolve: (tag: ViewTag, viewKind: ViewKind) => registry.match(tag, viewKind),
        };
      }),
    ),
  );

/**
 * React kit from a fully provided view Layer (`R` must be `never`).
 * Matchers `Card` / `Detail` / `Page` are **on this kit** (not on the `View` namespace).
 *
 * @public
 */
export const react = <ROut, E,>(viewLayer: Layer.Layer<ROut, E, never>) => {
  const kit = buildKit(viewLayer);

  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement =>
    React.createElement(RegistryReactContext.Provider, { value: kit }, props.children);

  const resolve = (tag: ViewTag, viewKind: ViewKind): ReadonlyArray<Resolved> =>
    kit.resolve(tag, viewKind);

  /**
   * Flip: bind Card/Detail/Page to one tag (no `tag` prop).
   * Still render inside {@link Provider}.
   */
  const forTag = (tag: ViewTag) => ({
    Card: (props: BoundViewProps): React.ReactElement | null =>
      React.createElement(MatchHost, {
        viewKind: ViewKind.Card(),
        resolved: useKit().resolve(tag, ViewKind.Card()),
        tag,
        name: props.name,
      }),
    Detail: (props: BoundViewProps): React.ReactElement | null =>
      React.createElement(MatchHost, {
        viewKind: ViewKind.Detail(),
        resolved: useKit().resolve(tag, ViewKind.Detail()),
        tag,
        name: props.name,
      }),
    Page: (props: BoundViewProps): React.ReactElement | null =>
      React.createElement(MatchHost, {
        viewKind: ViewKind.Page(),
        resolved: useKit().resolve(tag, ViewKind.Page()),
        tag,
        name: props.name,
      }),
  });

  return {
    Card: MatchCard,
    Detail: MatchDetail,
    Page: MatchPage,
    Provider,
    /** Bound matchers for one service — `{ Card, Detail, Page }` without `tag` props. */
    for: forTag,
    useView: () => useKit().registry,
    resolve,
    keys: () => kit.registry.keys(),
    registry: kit.registry,
  };
};
