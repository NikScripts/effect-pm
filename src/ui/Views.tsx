/**
 * @module ui/Views
 *
 * Hyperlink dashboard views — size chrome (Card/Detail/Page), Registry, bind/only,
 * react matchers, and compose. Built on `last-ts/View` DI (Tag/Prototype/provide).
 *
 * Size lives on the Card/Detail/Page **ancestor** prototypes — not on View.
 */
import * as React from "react";
import { Context, Data, Effect, Layer, Match, Option } from "effect";
import * as Group from "../Group";
import { kindOf } from "../Hyperlink";
import * as GroupNav from "./GroupNav";
import * as Router from "./Router";
import type { LeafTag } from "./widgetRegistry";
import * as View from "last-ts/View";

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
 * Size requirement on a dashboard prototype ancestor — fulfill with
 * `size: ViewKind.Card()` (etc.) before minting a Tag.
 *
 * @public
 */
export type WithSize<S extends ViewKind = ViewKind> = {
  readonly size: S;
};

/** Structural equality for tagged sizes. @internal */
const sameViewKind = (a: ViewKind, b: ViewKind): boolean => a._tag === b._tag;

/**
 * Tag a View skin may receive — leaf HyperService **or** Group (Group family card).
 *
 * @public
 */
export type ViewTag = LeafTag | GroupNav.MemberTag;

/**
 * Base props for size-chrome skins (card/detail/page). Navigation stays with the parent.
 *
 * @public
 */
export interface ViewProps {
  readonly tag: ViewTag;
  readonly name?: string;
}

/** Dashboard skin component — defaults to {@link ViewProps}. @public */
export type Component<Props extends object = ViewProps> = View.View<Props>;

/**
 * A matched view ready to render (size chrome).
 *
 * @public
 */
export interface Resolved {
  readonly key: View.ViewKey;
  readonly kind: ViewKind;
  readonly Component: Component;
}

export const SizeChrome: View.OpenPrototype<ViewProps, WithSize> = View.Prototype<
  ViewProps,
  WithSize
>()();

/**
 * Size-chrome add-ons — {@link SizeChrome} with `statics.size` fulfilled.
 * Mint with `Views.Card.Tag<Self, Props?>()(key, statics?)` — bag merges into
 * `.statics` (not flattened onto the class).
 * Matcher components are **not** these — use `Views.react(…).Card` or {@link useMatch}.
 *
 * @public
 */
export const Card: View.FulfilledPrototype<
  ViewProps,
  WithSize<CardKind>
> = SizeChrome.Prototype()({ size: ViewKind.Card() });

/** @public */
export const Detail: View.FulfilledPrototype<
  ViewProps,
  WithSize<DetailKind>
> = SizeChrome.Prototype()({ size: ViewKind.Detail() });

/** @public */
export const Page: View.FulfilledPrototype<
  ViewProps,
  WithSize<PageKind>
> = SizeChrome.Prototype()({ size: ViewKind.Page() });

// =============================================================================
// Registry service
// =============================================================================

/** Bound chrome captured when a contribution Layer built (View service was provided). @internal */
type Bound = {
  readonly key: View.ViewKey;
  readonly kind: ViewKind;
  readonly Component: Component;
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
  readonly keys: () => ReadonlyArray<View.ViewKey>;
}

/**
 * View registry — contribution tables + match.
 *
 * @public
 */
export class Registry extends Context.Service<Registry, RegistryService>()(
  "hyperlink-ts/ui/Views/Registry",
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
  /** tag.key → full allowlist from last `Views.only` for that tag */
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
    match(tag, viewKind) {
      const allowlist = onlyByTagKey.get(tag.key);
      if (allowlist !== undefined) {
        const kindsPresent = new Set(allowlist.map((b) => b.kind._tag));
        if (kindsPresent.has(viewKind._tag)) {
          return fromBounds(allowlist, viewKind);
        }
      }

      const out: Resolved[] = [];
      const seen = new Set<View.ViewKey>();
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
      const keys = new Set<View.ViewKey>();
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

/** Sized View handle — {@link WithSize} required on `.statics` for {@link bind} / {@link only}. @internal */
type ViewService<Id> = {
  readonly key: View.ViewKey;
  readonly statics: WithSize & { readonly spec?: unknown };
} & Context.Key<Id, Component>;

/** Avoid `Foo<Id>>` in .tsx return positions (parsed as JSX). */
type ContribLayer<R> = Layer.Layer<never, never, Registry | R>;

/**
 * Append one View for a stamped Hyperlink **kind** string or a concrete **tag**
 * (matched by `.key`). Multi-match / pager — merge with `Layer.mergeAll`.
 *
 * @example
 * ```ts
 * Views.bind(WorkPool.kind, PoolCard) // family kind
 * Views.bind(Special, PoolCard)       // one tag key
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
      const bound = { key: view.key, kind: view.statics.size, Component };
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
      bounds.push({ key: v1.key, kind: v1.statics.size, Component: c1 });
      if (v2 !== undefined) {
        const c2 = yield* v2;
        bounds.push({ key: v2.key, kind: v2.statics.size, Component: c2 });
      }
      if (v3 !== undefined) {
        const c3 = yield* v3;
        bounds.push({ key: v3.key, kind: v3.statics.size, Component: c3 });
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
>()("hyperlink-ts/ui/Views/GroupDash") {}

/**
 * BYO-chrome Group kit contribution (W20). Records the Group + leaves for the react kit.
 * Chrome `R` comes from `Views.bind` / `Views.only` layers you merge.
 *
 * @example
 * ```ts
 * const ready = Layer.mergeAll(
 *   Views.group(AppGroup),
 *   Views.bind(WorkPool.kind, PoolCard),
 *   Views.only(Special, CustomCard),
 * ).pipe(Layer.provideMerge(chrome), Layer.provideMerge(Views.base))
 * const { for: bound, Provider } = Views.react(ready)
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

const FallbackCard: Component = (props) =>
  React.createElement(
    "div",
    { "data-hyperlink-view": "fallback-card" },
    props.name ?? props.tag.key,
  );

const FallbackDetail: Component = (props) =>
  React.createElement(
    "div",
    { "data-hyperlink-view": "fallback-detail" },
    props.name ?? props.tag.key,
  );

const FallbackPage: Component = (props) =>
  React.createElement(
    "div",
    { "data-hyperlink-view": "fallback-page" },
    props.name ?? props.tag.key,
  );

const fallbackFor = (viewKind: ViewKind): Component =>
  Match.value(viewKind).pipe(
    Match.tag("Card", () => FallbackCard),
    Match.tag("Detail", () => FallbackDetail),
    Match.tag("Page", () => FallbackPage),
    Match.exhaustive,
  );

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
      "data-hyperlink-view": "pager",
      "data-view-kind": props.viewKind._tag,
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
    throw new Error("View: render inside Views.react(…).Provider");
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
 * Size matchers for descendants of {@link react}`(…).Provider` / {@link compose}`(…).Provider`.
 * Prefer `const ui = Views.react(…); <ui.Card …/>` at the shell; use this in deep widgets.
 *
 * @public
 */
export const useMatch = (): {
  readonly Card: Component;
  readonly Detail: Component;
  readonly Page: Component;
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
    /** Present when the layer included {@link group}. */
    groupDash: Option.getOrUndefined(kit.groupDash),
    useView: () => useKit().registry,
    resolve,
    keys: () => kit.registry.keys(),
    registry: kit.registry,
  };
};

// =============================================================================
// compose — thin sugar over react + Router (lock C)
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
 * Members of the current Group route. Returns an empty list without a Group root.
 *
 * @public
 */
export const useGridMembers = (
  root?: GroupNav.RouteGroup,
): ReadonlyArray<{
  readonly name: string;
  readonly tag: ViewTag;
}> => {
  const router = Router.useRouter();
  if (root === undefined) return [];
  const group = GroupNav.state(root, router).group;
  return Object.entries(Group.members(group)).map(([name, tag]) => ({
    name,
    tag: tag as ViewTag,
  }));
};

/** Live router vs Layer — `Layer.isLayer` predicate is too wide to exclude. @internal */
const isLiveRouter = (
  input: Layer.Layer<Router.Router> | Router.Service,
): input is Router.Service =>
  typeof input === "object" &&
  input !== null &&
  "go" in input &&
  "subscribe" in input &&
  "pathname" in input;

/** Build or accept a live router for {@link compose}. @internal */
const resolveComposeRouter = (
  input: Layer.Layer<Router.Router> | Router.Service,
): Router.Service => {
  if (isLiveRouter(input)) return input;
  return Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(input);
        return Context.get(ctx, Router.Router);
      }),
    ),
  );
};

/**
 * Thin Dashboard sugar: {@link react} + {@link Router} Layer **or** live
 * {@link Router.Service}. No second registry; no `Atom.runtime` inside — wrap
 * with {@link ./runtime.RuntimeProvider} outside.
 *
 * Observe via `Observe.use(tag, *View.pack)` / `NodeView.use` under `RuntimeProvider`.
 *
 * @example
 * ```tsx
 * import * as Observe from "hyperlink-ts/Observe"
 * import * as WorkPoolView from "hyperlink-ts/ui/WorkPoolView"
 * import * as DaemonView from "hyperlink-ts/ui/DaemonView"
 * const ui = Views.compose({
 *   views: Layer.mergeAll(Views.bind(Group.kind, GroupCard), webDashboard.layer),
 *   group: ServicesHub,
 *   router: Router.history(
 *     Route.make("dash").add(
 *       Route.group("hub", { topLevel: true }).fromEffect(Group.asRoutes(ServicesHub)),
 *     ),
 *   ),
 * })
 * <RuntimeProvider runtime={runtime}>
 *   <ui.Provider>
 *     <ui.Grid />
 *     <ui.Outlet />
 *   </ui.Provider>
 * </RuntimeProvider>
 *
 * // in a skin / shell component:
 * const queue = Observe.use(Jobs, WorkPoolView.pack)
 * const daemon = Observe.use(Nightly, DaemonView.pack)
 * ```
 *
 * @public
 */
export const compose = <VR, VE,>(options: {
  readonly views: Layer.Layer<VR, VE, never>;
  readonly router: Layer.Layer<Router.Router> | Router.Service;
  readonly group?: GroupNav.RouteGroup;
}): ReturnType<typeof react<VR, VE>> & {
  readonly Provider: (props: {
    readonly children: React.ReactNode;
  }) => React.ReactElement;
  readonly Grid: () => React.ReactElement;
  readonly Outlet: () => React.ReactElement | null;
  readonly useGridMembers: typeof useGridMembers;
  readonly router: Router.Service;
} => {
  const viewKit = react(options.views);
  const router = resolveComposeRouter(options.router);
  const group = options.group;

  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement =>
    React.createElement(
      viewKit.Provider,
      null,
      React.createElement(
        Router.Provider,
        { value: router, children: props.children },
      ),
    );

  /** DOM grid — Card per member; click opens via GroupNav. TUI: use {@link useGridMembers}. */
  const Grid = (): React.ReactElement => {
    const members = useGridMembers(group);
    const navigation = Router.useRouter();
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
            onClick: () => {
              if (group !== undefined) GroupNav.open(group, navigation, tag);
            },
          },
          React.createElement(MatchCard, { tag, name }),
        ),
      ),
    );
  };

  /**
   * Shell outlet — prefer the matched route’s {@link Route.handle}
   * ({@link Router.Outlet}); else Group-dashboard Target → View Detail/Page.
   */
  const Outlet = (): React.ReactElement | null => {
    const navigation = Router.useRouter();
    const handled = Router.Outlet();
    if (handled !== null) return handled;
    if (group === undefined) return null;

    const state = GroupNav.state(group, navigation);
    const selected = state.selected;
    if (selected === null) return null;
    const tag = selected as ViewTag;
    const title = displayNameOf(tag, "detail");

    const back = React.createElement("button", {
      type: "button",
      onClick: () => GroupNav.up(group, navigation),
      disabled: !state.canUp,
    }, "← back");

    if (state.view === "logs" || state.view === "schedule") {
      return React.createElement(
        "div",
        { "data-hyperlink-outlet": state.view },
        React.createElement(
          "div",
          { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12 } },
          back,
          React.createElement("strong", null, `${title} · ${state.view}`),
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
        back,
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
    router,
  };
};
