/**
 * @module ui/View
 *
 * View **DI** (Context) + optional size chrome (card/detail/page) + React matchers.
 * Notes: `docs/handoffs/view-tag-prototype.md`. Design: `docs/handoffs/client-adapters-design.md`.
 *
 * - `View.Tag` / `View.Prototype` → component DI. Self = DI identity; props from Prototype.
 * - Svc type is {@link View}`<Props>` (props in → element out). Defaults to {@link ViewProps}.
 * - Size chrome: {@link WithSize} type requirement; `View.Card` / `Detail` / `Page` narrow it.
 * - Matchers on {@link react} / {@link compose} kits (`ui.Card`) and {@link useMatch}.
 * - `View.bind` / `View.only` register sized handles; `View.react` needs Layer `R = never`.
 */
import * as React from "react";
import { Context, Effect, Layer, Option } from "effect";
import * as Group from "../Group";
import { kindOf } from "../Hyperlink";
import * as Navigator from "./Navigator";
import type { LeafTag } from "./widgetRegistry";

// =============================================================================
// Keys / kinds / props
// =============================================================================

/** Flatten `&` nests so Prototype / Tag hovers stay readable. @internal */
type Flat<T extends object> = { readonly [K in keyof T]: T[K] } & {};

/** Stable view id — prefer `hyperlink/view/<name>`. @public */
export type ViewKey = string;

/**
 * Building-block **sizes** (W8 / lock F1). Content (queue, schedule, logs, Group…)
 * fills these — not separate kinds named after content.
 *
 * @public
 */
export type ViewKind = "card" | "detail" | "page";

/**
 * Size requirement on chrome statics.
 * Default `S = ViewKind` — `"card" | "detail" | "page"`. Narrow with `WithSize<"card">`.
 *
 * @public
 */
export type WithSize<S extends ViewKind = ViewKind> = {
  readonly size: S;
};

/**
 * Tag a View skin may receive — leaf HyperService **or** Group (Group family card).
 *
 * @public
 */
export type ViewTag = LeafTag | Navigator.MemberTag;

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
 * Layout / shell hints for View skins. **Navigation is {@link Navigator}** — not here.
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
 * Component Svc for a View tag — **props in, element out** (reversed vs Hyperlink service APIs).
 * Defaults to {@link ViewProps} (card/detail/page chrome); pass a props bag for custom Prototypes.
 *
 * @example
 * ```ts
 * const skin: View.View<View.Type<typeof PoolCard>> = (props) => …
 * const chrome: View.View = (props) => … // ViewProps
 * ```
 *
 * @public
 */
export type View<Props extends object = ViewProps> = (
  props: Props,
) => React.ReactElement | null;

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
 * Accumulated props type for a {@link Prototype} / {@link SizedPrototype}.
 *
 * @public
 */
export type PropsOf<P> = P extends SizedPrototype<infer Props, WithSize>
  ? Props
  : P extends Prototype<infer Props, AnyStatics>
    ? Props
    : never;

/**
 * Constructable View handle from {@link Prototype.Tag}.
 *
 * - **Self** — Context identity (the class)
 * - **Props** — component input (reversed service shape) from the Prototype chain
 * - **Svc** — {@link View}`<Props>` (provide with `Layer.succeed`)
 *
 * `ServiceClass` instance typing cannot be the props bag (it carries key/Service brands),
 * so props live on the Prototype; read them with {@link Type} / {@link PropsOf}.
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
    /** Phantom — component props for this handle (`View.Type<typeof PoolCard>`). */
    readonly Type: Props
  };

/**
 * Component props for a View handle class.
 *
 * @public
 */
export type Type<T> = T extends { readonly Type: infer P } ? P : never;

/**
 * Props (type) + static accessors (runtime) before minting a {@link Tag}.
 *
 * @example
 * ```ts
 * const Card = View.Prototype<{ readonly tag: ViewTag }>()({ size: "card" as const })
 * class ScheduleCard extends Card.Tag<ScheduleCard>()("hyperlink/view/schedule-card") {}
 * ```
 *
 * @public
 */
export interface Prototype<
  in out Props extends object,
  out Statics extends AnyStatics = {},
> {
  readonly statics: Statics;
  /**
   * Extend props (type arg) then merge static accessors (value).
   * In `.tsx` use a trailing comma / type alias so `<…>` is not JSX:
   * `proto.Prototype<{ sel?: boolean }>()({ … })`.
   *
   * Merged Props/Statics are flattened so hovers stay readable (no `&` nests).
   * If the merge satisfies {@link WithSize}, the result is a {@link SizedPrototype}.
   */
  readonly Prototype: <NewProps extends object = {},>() => <
    const NewStatics extends AnyStatics = {},
  >(
    statics?: NewStatics,
  ) => Flat<Statics & NewStatics> extends WithSize
    ? SizedPrototype<Flat<Props & NewProps>, Flat<Statics & NewStatics>>
    : Prototype<Flat<Props & NewProps>, Flat<Statics & NewStatics>>;
  /**
   * Mint a Context.Service **class** handle.
   * `Layer.succeed(Tag, (props) => …)` types `props` as this prototype’s Props.
   */
  readonly Tag: <Self,>() => <const K extends string>(
    key: K,
  ) => Context.ServiceClass<Self, K, View<Props>> & Flat<Statics> & {
    readonly Type: Props
  };
}

/**
 * Prototype whose statics **must** satisfy {@link WithSize}.
 * Extending keeps the restriction; {@link Tag} always carries `size` for {@link bind}.
 *
 * @public
 */
export interface SizedPrototype<
  in out Props extends object,
  out Statics extends WithSize,
> {
  readonly statics: Statics;
  readonly Prototype: <NewProps extends object = {},>() => <
    const NewStatics extends AnyStatics = {},
  >(
    statics?: NewStatics,
  ) => Flat<Statics & NewStatics> extends infer S extends WithSize
    ? SizedPrototype<Flat<Props & NewProps>, S>
    : never;
  readonly Tag: <Self,>() => <const K extends string>(
    key: K,
  ) => Context.ServiceClass<Self, K, View<Props>> & Flat<Statics> & {
    readonly Type: Props
  };
}

const makePrototype = <
  Props extends object,
  Statics extends AnyStatics,
>(
  statics: Statics,
): Prototype<Props, Statics> => ({
  statics,
  Prototype:
    <NewProps extends object = {},>() =>
    <const NewStatics extends AnyStatics = {},>(next?: NewStatics) =>
      makePrototype({
        ...statics,
        ...(next ?? ({} as NewStatics)),
      }) as Flat<Statics & NewStatics> extends WithSize
        ? SizedPrototype<Flat<Props & NewProps>, Flat<Statics & NewStatics>>
        : Prototype<Flat<Props & NewProps>, Flat<Statics & NewStatics>>,
  Tag:
    <Self,>() =>
    <const K extends string>(key: K) => {
      // Infer Object.assign like Group.Tag so class-extends keeps static accessors.
      const base = Context.Service<Self, View<Props>>()(key);
      return Object.assign(base, statics, {
        Type: undefined as unknown as Props,
      });
    },
});

/**
 * Start a prototype chain — props via type arg, statics via value:
 * `View.Prototype<Props>()(statics?)`.
 *
 * If `statics` satisfies {@link WithSize}, the result is a {@link SizedPrototype}
 * (size required; safe for {@link bind}).
 *
 * @example
 * ```ts
 * const Base = View.Prototype<{ readonly tag: ViewTag }>()({ version: 1 as const })
 * const Card = Base.Prototype()({ size: "card" as const }) // SizedPrototype
 * ```
 *
 * @public
 */
export const Prototype =
  <Props extends object = {},>() =>
  <const Statics extends AnyStatics = {},>(
    statics?: Statics,
  ): Statics extends WithSize
    ? SizedPrototype<Props, Statics>
    : Prototype<Props, Statics> =>
    makePrototype<Props, Statics>((statics ?? {}) as Statics) as Statics extends WithSize
      ? SizedPrototype<Props, Statics>
      : Prototype<Props, Statics>;

/**
 * Naked View Tag — DI component handle with **no** size chrome.
 * Self = props shape. Prefer sized add-ons (`View.Card.Tag`, …) for dashboard skins.
 *
 * In `.tsx`: `View.Tag<PoolCard,>()(…)`.
 *
 * @example
 * ```ts
 * const GreeterProto = View.Prototype<{ readonly name: string }>()()
 * class Greeter extends GreeterProto.Tag<Greeter>()("app/view/greeter") {}
 * Layer.succeed(Greeter, (props) => React.createElement("span", null, props.name))
 * ```
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
 * Size-chrome add-ons — {@link SizedPrototype} narrowings (`Statics extends WithSize`).
 * Matcher components are **not** these — use `View.react(…).Card` or {@link useMatch}.
 *
 * @public
 */
export const Card = Prototype<ViewProps>()({ size: "card" as const });

/** @public */
export const Detail = Prototype<ViewProps>()({ size: "detail" as const });

/** @public */
export const Page = Prototype<ViewProps>()({ size: "page" as const });

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
  /** Append a view for one Hyperlink tag `.key` (multi-match). */
  readonly addTag: (tagKey: string, bound: Bound) => void;
  /** Append a view for a stamped Hyperlink kind (multi-match). */
  readonly addKind: (kind: string, bound: Bound) => void;
  /**
   * Allowlist for one tag — **replaces** any prior `only` for that tag (last wins).
   * At match time, kinds present in the list are exclusive; other kinds still use add tables.
   */
  readonly setOnly: (tagKey: string, bounds: ReadonlyArray<Bound>) => void;
  readonly match: (tag: ViewTag, viewKind: ViewKind) => ReadonlyArray<Resolved>;
  readonly keys: () => ReadonlyArray<ViewKey>;
}

/**
 * View registry — contribution tables + match.
 *
 * @public
 */
export class Registry extends Context.Service<Registry, RegistryService>()(
  "hyperlink-ts/ui/View/Registry",
) {}

const pushBound = (map: Map<string, Bound[]>, key: string, bound: Bound): void => {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [bound]);
    return;
  }
  if (!list.some((b) => b.key === bound.key)) list.push(bound);
};

const makeRegistryService = (): RegistryService => {
  const byTagKey = new Map<string, Bound[]>();
  const byKind = new Map<string, Bound[]>();
  /** tag.key → full allowlist from last `View.only` for that tag */
  const onlyByTagKey = new Map<string, Bound[]>();

  const fromBounds = (bounds: ReadonlyArray<Bound> | undefined, viewKind: ViewKind): Resolved[] => {
    if (bounds === undefined) return [];
    const out: Resolved[] = [];
    for (const bound of bounds) {
      if (bound.kind !== viewKind) continue;
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
    match(tag, viewKind) {
      const allowlist = onlyByTagKey.get(tag.key);
      if (allowlist !== undefined) {
        const kindsPresent = new Set(allowlist.map((b) => b.kind));
        if (kindsPresent.has(viewKind)) {
          return fromBounds(allowlist, viewKind);
        }
      }

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
      // Group tags stamp `Group.kind` as a data prop (not Hyperlink kindSym).
      if (Group.isGroup(tag)) {
        add(fromBounds(byKind.get(Group.kind), viewKind));
      } else {
        const stamped = kindOf(tag as never);
        if (typeof stamped === "string") {
          add(fromBounds(byKind.get(stamped), viewKind));
        }
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
export const layer: Layer.Layer<Registry> = Layer.sync(Registry, makeRegistryService);

/**
 * Shipped registry shell.
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
 * Append one View for a stamped Hyperlink **kind** string or a concrete **tag**
 * (matched by `.key`). Multi-match / pager — merge with `Layer.mergeAll`.
 *
 * @example
 * ```ts
 * View.bind(WorkPool.kind, PoolCard) // family kind
 * View.bind(Special, PoolCard)       // one tag key
 * ```
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
 * Allowlist for one Hyperlink tag. Kinds present are exclusive (defaults do not apply for
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
// Lightweight Group dash (W20)
// =============================================================================

/** Group-shaped root for {@link group}. @public */
export type GroupLike = {
  readonly key: string;
  readonly members: Record<string, unknown>;
};

/** Leaf tags collected from a Group tree. @public */
export type GroupLeaf = LeafTag;

const collectLeaves = (node: unknown): ReadonlyArray<GroupLeaf> => {
  if (!Group.isGroup(node)) {
    if (
      (typeof node === "object" || typeof node === "function") &&
      node !== null &&
      "key" in node &&
      typeof (node as { readonly key: unknown }).key === "string"
    ) {
      return [node as GroupLeaf];
    }
    return [];
  }
  return Object.values(Group.members(node)).flatMap(collectLeaves);
};

/**
 * Lightweight Group dash handle — stashed by {@link group} for {@link react}.
 *
 * @public
 */
export class GroupDash extends Context.Service<
  GroupDash,
  {
    readonly group: GroupLike;
    readonly leaves: ReadonlyArray<GroupLeaf>;
  }
>()("hyperlink-ts/ui/View/GroupDash") {}

/**
 * BYO-chrome Group kit contribution (W20). Records the Group + leaves for the react kit.
 * Chrome `R` comes from `View.bind` / `View.only` layers you merge.
 *
 * @example
 * ```ts
 * const ready = Layer.mergeAll(
 *   View.group(AppGroup),
 *   View.bind(WorkPool.kind, PoolCard),
 *   View.only(Special, CustomCard),
 * ).pipe(Layer.provideMerge(chrome), Layer.provideMerge(View.base))
 * const { for: bound, Provider } = View.react(ready)
 * ```
 *
 * @public
 */
export const group = (appGroup: GroupLike): Layer.Layer<GroupDash> =>
  Layer.sync(GroupDash, () => ({
    group: appGroup,
    leaves: collectLeaves(appGroup),
  }));

// =============================================================================
// Fallbacks + react kit
// =============================================================================

const FallbackCard: View = (props) =>
  React.createElement(
    "div",
    { "data-hyperlink-view": "fallback-card" },
    props.name ?? props.tag.key,
  );

const FallbackDetail: View = (props) =>
  React.createElement(
    "div",
    { "data-hyperlink-view": "fallback-detail" },
    props.name ?? props.tag.key,
  );

const FallbackPage: View = (props) =>
  React.createElement(
    "div",
    { "data-hyperlink-view": "fallback-page" },
    props.name ?? props.tag.key,
  );

const fallbackFor = (viewKind: ViewKind): View => {
  if (viewKind === "card") return FallbackCard;
  if (viewKind === "detail") return FallbackDetail;
  return FallbackPage;
};

type KitContext = {
  readonly registry: RegistryService;
  readonly resolve: (tag: ViewTag, viewKind: ViewKind) => ReadonlyArray<Resolved>;
  readonly groupDash: Option.Option<{
    readonly group: GroupLike;
    readonly leaves: ReadonlyArray<GroupLeaf>;
  }>;
};

const RegistryReactContext = React.createContext<KitContext | null>(null);

/** Multi-match host — pager stub (first page); desktop tabs later (W8). @internal */
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
            key: `fallback/${props.viewKind}`,
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
      "data-hyperlink-view": "pager",
      "data-view-kind": props.viewKind,
      "data-page-count": list.length,
    },
    ...list.map((item, index) =>
      React.createElement(
        "div",
        { key: item.key, "data-hyperlink-view-page": index, hidden: index !== 0 },
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
  return kit.resolve(tag as LeafTag, viewKind).length > 0;
};

/** Kit matcher — card size. @internal */
const MatchCard = (props: ViewProps): React.ReactElement | null =>
  React.createElement(MatchHost, {
    viewKind: "card",
    resolved: useKit().resolve(props.tag, "card"),
    tag: props.tag,
    name: props.name,
  });

/** Kit matcher — detail size. @internal */
const MatchDetail = (props: ViewProps): React.ReactElement | null =>
  React.createElement(MatchHost, {
    viewKind: "detail",
    resolved: useKit().resolve(props.tag, "detail"),
    tag: props.tag,
    name: props.name,
  });

/** Kit matcher — page size. @internal */
const MatchPage = (props: ViewProps): React.ReactElement | null =>
  React.createElement(MatchHost, {
    viewKind: "page",
    resolved: useKit().resolve(props.tag, "page"),
    tag: props.tag,
    name: props.name,
  });

/**
 * Size matchers for descendants of {@link react}`(…).Provider` / {@link compose}`(…).Provider`.
 * Prefer `const ui = View.react(…); <ui.Card …/>` at the shell; use this in deep widgets.
 *
 * @public
 */
export const useMatch = (): {
  readonly Card: View;
  readonly Detail: View;
  readonly Page: View;
} =>
  // Stable matcher components — they require Provider when *rendered* (via useKit).
  ({ Card: MatchCard, Detail: MatchDetail, Page: MatchPage });

/**
 * Build registry resolver from a **fully provided** view Layer (`R = never`).
 * Runs the Layer (`Effect.runSync` + `Layer.build`) so usable components can be returned.
 *
 * @internal
 */
const buildKit = <ROut, E,>(viewLayer: Layer.Layer<ROut, E, never>): KitContext =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(viewLayer);
        const registry = Option.getOrThrow(Context.getOption(ctx, Registry));
        const groupDash = Context.getOption(ctx, GroupDash);
        return {
          registry,
          resolve: (tag: ViewTag, viewKind: ViewKind) => registry.match(tag, viewKind),
          groupDash,
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
   * Flip: bind Card/Detail/Page to one Hyperlink tag (no `tag` prop).
   * Still render inside {@link Provider}.
   */
  const forTag = (tag: ViewTag) => ({
    Card: (props: BoundViewProps): React.ReactElement | null =>
      React.createElement(MatchHost, {
        viewKind: "card",
        resolved: useKit().resolve(tag, "card"),
        tag,
        name: props.name,
      }),
    Detail: (props: BoundViewProps): React.ReactElement | null =>
      React.createElement(MatchHost, {
        viewKind: "detail",
        resolved: useKit().resolve(tag, "detail"),
        tag,
        name: props.name,
      }),
    Page: (props: BoundViewProps): React.ReactElement | null =>
      React.createElement(MatchHost, {
        viewKind: "page",
        resolved: useKit().resolve(tag, "page"),
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
    /** Present when the layer included {@link group}. */
    groupDash: Option.getOrUndefined(kit.groupDash),
    useView: () => useKit().registry,
    resolve,
    keys: () => kit.registry.keys(),
    registry: kit.registry,
  };
};

// =============================================================================
// compose — thin sugar over react + Navigator (lock C)
// =============================================================================

const displayNameOf = (tag: ViewTag, fallback: string): string => {
  if (typeof tag === "object" || typeof tag === "function") {
    if (tag !== null && "key" in tag && typeof (tag as { key: unknown }).key === "string") {
      const key = (tag as { key: string }).key;
      const slash = key.lastIndexOf("/");
      return slash >= 0 ? key.slice(slash + 1) : key;
    }
  }
  return fallback;
};

/**
 * Members of the current {@link Navigator} group — shells (esp. TUI) render their own grid.
 *
 * @public
 */
export const useGridMembers = (): ReadonlyArray<{
  readonly name: string;
  readonly tag: ViewTag;
}> => {
  const nav = Navigator.useNavigator();
  return Object.entries(Group.members(nav.group)).map(([name, tag]) => ({
    name,
    tag: tag as ViewTag,
  }));
};

/**
 * Thin Dashboard sugar: {@link react} + {@link Navigator} Layer. No second registry;
 * no `Atom.runtime` inside (provide {@link RuntimeProvider} outside).
 *
 * @example
 * ```ts
 * const ui = View.compose({
 *   views: Layer.mergeAll(View.bind(Group.kind, GroupCard), WebDashboardViews.layer),
 *   navigator: Navigator.history(ServicesHub),
 * })
 * <ui.Provider><ui.Grid /><ui.Outlet /></ui.Provider>
 * ```
 *
 * @public
 */
export const compose = <VR, VE,>(options: {
  readonly views: Layer.Layer<VR, VE, never>;
  readonly navigator: Layer.Layer<Navigator.Navigator>;
}) => {
  const viewKit = react(options.views);
  const nav = Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(options.navigator);
        return Context.get(ctx, Navigator.Navigator);
      }),
    ),
  );

  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement =>
    React.createElement(
      viewKit.Provider,
      null,
      React.createElement(
        Navigator.Provider,
        { value: nav, children: props.children },
      ),
    );

  /** DOM grid — Card per member; click opens via Navigator. TUI: use {@link useGridMembers}. */
  const Grid = (): React.ReactElement => {
    const members = useGridMembers();
    const navigation = Navigator.useNavigator();
    return React.createElement(
      React.Fragment,
      null,
      ...members.map(({ name, tag }) =>
        React.createElement(
          "button",
          {
            key: name,
            type: "button",
            className: "contents",
            onClick: () => navigation.open(tag as Navigator.MemberTag),
          },
          React.createElement(MatchCard, { tag, name }),
        ),
      ),
    );
  };

  /** Shell outlet — back/title + Detail, or page-sized logs/schedule content. */
  const Outlet = (): React.ReactElement | null => {
    const navigation = Navigator.useNavigator();
    const selected = navigation.selected;
    if (selected === null) return null;
    const tag = selected as ViewTag;
    const title = displayNameOf(tag, "detail");

    if (navigation.view === "logs" || navigation.view === "schedule") {
      return React.createElement(
        "div",
        { "data-hyperlink-outlet": navigation.view },
        React.createElement(
          "div",
          { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12 } },
          React.createElement("button", { type: "button", onClick: () => navigation.back() }, "← back"),
          React.createElement("strong", null, `${title} · ${navigation.view}`),
        ),
        React.createElement(MatchPage, { tag, name: title }),
      );
    }

    return React.createElement(
      "div",
      { "data-hyperlink-outlet": "detail" },
      React.createElement(
        "div",
        { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12 } },
        React.createElement("button", { type: "button", onClick: () => navigation.back() }, "← back"),
        React.createElement("strong", null, title),
      ),
      React.createElement(MatchDetail, { tag, name: title }),
    );
  };

  return {
    ...viewKit,
    Provider,
    Grid,
    Outlet,
    useGridMembers,
    navigator: nav,
  };
};
