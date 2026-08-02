/**
 * @module ui/Ui
 *
 * Hyperlink dashboard chrome — size variants (Card/Detail/Page), bind/only,
 * react matchers, Group-aware compose, and kind-aware registry base.
 * Built on `last-ts/View` DI kernel.
 */
import * as React from "react";
import { Context, Data, Effect, Layer, Match, Option } from "effect";
import * as Group from "../Group";
import { kindOf } from "../Hyperlink";
import * as GroupNav from "./GroupNav";
import * as Router from "./Router";
import type { LeafTag } from "./widgetRegistry";
import * as View from "last-ts/View";

// =============================================================================
// Sizes / props
// =============================================================================

/**
 * Building-block **sizes** as Effect tagged variants.
 * Content fills these — not separate kinds named after content.
 *
 * @public
 */
export type ViewKind = Data.TaggedEnum<{
  Card: {};
  Detail: {};
  Page: {};
}>;

/** Constructors / `$is` / `$match` for {@link ViewKind}. @public */
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
 * Size {@link View.Prototype} requirement — declare on chrome, fulfill with
 * `size: ViewKind.Card()` (etc.).
 *
 * @public
 */
export type WithSize<S extends ViewKind = ViewKind> = {
  readonly size: S;
};

/** Hyperlink View tag — leaf service or Group member. @public */
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

/**
 * Shared size-chrome shell — {@link WithSize} Requirement open (not fulfilled).
 *
 * @public
 */
export const SizeChrome: View.OpenPrototype<ViewProps, WithSize> = View.Prototype<
  ViewProps,
  WithSize
>()();

/**
 * Size-chrome add-ons — {@link SizeChrome} with size fulfilled.
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
// Registry contributions (bind / only)
// =============================================================================

/** Bound chrome captured when a contribution Layer built. @internal */
type Bound = {
  readonly key: View.ViewKey;
  readonly kind: ViewKind;
  readonly Component: View.View;
};

/** Sized View handle — {@link WithSize} required for {@link bind} / {@link only}. @internal */
type ViewService<Id> = WithSize & {
  readonly key: View.ViewKey;
  readonly spec?: unknown;
} & Context.Key<Id, View.View>;

/** Avoid `Foo<Id>>` in .tsx return positions (parsed as JSX). */
type ContribLayer<R> = Layer.Layer<never, never, View.Registry | R>;

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
      const reg = yield* View.Registry;
      const Component = yield* view;
      const bound: Bound = { key: view.key, kind: view.size, Component };
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
      const reg = yield* View.Registry;
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

/**
 * Registry Layer with Hyperlink kind resolution for {@link bind} by kind.
 *
 * @public
 */
export const base: Layer.Layer<View.Registry> = Layer.sync(View.Registry, () =>
  View.makeRegistryService((tag) => {
    if (Group.isGroup(tag)) return [Group.kind];
    const k = kindOf(tag as never);
    return typeof k === "string" ? [k] : [];
  }),
);

// =============================================================================
// React kit — size matchers
// =============================================================================

const FallbackCard: View.View<ViewProps> = (props) =>
  React.createElement(
    "div",
    { "data-hyperlink-view": "fallback-card" },
    props.name ?? props.tag.key,
  );

const FallbackDetail: View.View<ViewProps> = (props) =>
  React.createElement(
    "div",
    { "data-hyperlink-view": "fallback-detail" },
    props.name ?? props.tag.key,
  );

const FallbackPage: View.View<ViewProps> = (props) =>
  React.createElement(
    "div",
    { "data-hyperlink-view": "fallback-page" },
    props.name ?? props.tag.key,
  );

const fallbackFor = (viewKind: ViewKind): View.View<ViewProps> =>
  Match.value(viewKind).pipe(
    Match.tag("Card", () => FallbackCard),
    Match.tag("Detail", () => FallbackDetail),
    Match.tag("Page", () => FallbackPage),
    Match.exhaustive,
  );

type KitContext = {
  readonly registry: View.RegistryService;
  readonly resolve: (tag: ViewTag, viewKind: ViewKind) => ReadonlyArray<View.Resolved>;
};

const RegistryReactContext = React.createContext<KitContext | null>(null);

/** Multi-match host — pager stub (first page); desktop tabs later. @internal */
const MatchHost = (props: {
  readonly viewKind: ViewKind;
  readonly resolved: ReadonlyArray<View.Resolved>;
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
    throw new Error("Ui: render inside Ui.react(…).Provider");
  }
  return value;
};

/**
 * Whether the mounted Ui Provider has a match for this tag + kind.
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
  readonly Card: View.View<ViewProps>;
  readonly Detail: View.View<ViewProps>;
  readonly Page: View.View<ViewProps>;
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
        const registry = Option.getOrThrow(Context.getOption(ctx, View.Registry));
        return {
          registry,
          resolve: (tag: ViewTag, viewKind: ViewKind) => registry.match(tag, viewKind),
        };
      }),
    ),
  );

/**
 * React kit from a fully provided view Layer (`R` must be `never`).
 * Matchers `Card` / `Detail` / `Page` are **on this kit**.
 *
 * @public
 */
export const react = <ROut, E,>(viewLayer: Layer.Layer<ROut, E, never>) => {
  const kit = buildKit(viewLayer);
  const groupDash = Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(viewLayer);
        return Context.getOption(ctx, GroupDash);
      }),
    ),
  );

  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement =>
    React.createElement(RegistryReactContext.Provider, { value: kit }, props.children);

  const resolve = (tag: ViewTag, viewKind: ViewKind): ReadonlyArray<View.Resolved> =>
    kit.resolve(tag, viewKind);

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
    for: forTag,
    useView: () => useKit().registry,
    resolve,
    keys: () => kit.registry.keys(),
    registry: kit.registry,
    groupDash: Option.getOrUndefined(groupDash),
  };
};

// =============================================================================
// Group dash + compose
// =============================================================================

/** Group-shaped root for {@link group}. @public */
export type GroupLike = {
  readonly key: string;
  readonly members: Record<string, unknown>;
};

/** Leaf tags collected from a Group tree. @public */
export type GroupLeaf = ViewTag;

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
>()("hyperlink-ts/ui/Ui/GroupDash") {}

/**
 * BYO-chrome Group kit contribution. Records the Group + leaves for the react kit.
 *
 * @public
 */
export const group = (appGroup: GroupLike): Layer.Layer<GroupDash> =>
  Layer.sync(GroupDash, () => ({
    group: appGroup,
    leaves: collectLeaves(appGroup),
  }));

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
          React.createElement(viewKit.Card, { tag, name }),
        ),
      ),
    );
  };

  /**
   * Shell outlet — prefer the matched route's {@link Route.handle}
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
        React.createElement(viewKit.Page, { tag, name: title }),
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
      React.createElement(viewKit.Detail, { tag, name: title }),
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
