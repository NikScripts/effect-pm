/**
 * @module ui/View
 *
 * View **services** (Context) + chrome contribution Layers + React matchers.
 * Design: `docs/handoffs/client-adapters-design.md`.
 *
 * - `View.make` → Context.Service whose Svc is the React/Ink component (+ key/kind/spec).
 * - Provide TSX with `Layer.succeed(PoolCard, Comp)`.
 * - Chrome policy = Layers: `View.kind` / `View.tag` / `View.only` (merge with `Layer.mergeAll`; last wins).
 * - `View.react(layer)` runs the Layer and requires `R = never` (missing skin = type error).
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
 * Tag a View skin may receive — leaf HyperService **or** Group (Group family card).
 *
 * @public
 */
export type ViewTag = LeafTag | Navigator.MemberTag;

/** Props every matched card/detail/page receives. Navigation stays with the parent. @public */
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

/** A React/Ink view for one chrome role — the View service’s Svc. @public */
export type ViewComponent = (props: ViewProps) => React.ReactElement | null;

/** Phantom id so each {@link make} key is a distinct Context service. @public */
export interface ViewId<K extends string> {
  readonly _ViewKey: K;
}

/**
 * A View service: Context tag for {@link ViewComponent}, plus identity metadata.
 *
 * @public
 */
export type AnyView<Id> = Context.Service<Id, ViewComponent> & {
  readonly key: ViewKey;
  readonly kind: ViewKind;
  readonly spec: unknown;
};

/**
 * A matched view ready to render.
 *
 * @public
 */
export interface Resolved {
  readonly key: ViewKey;
  readonly kind: ViewKind;
  readonly Component: ViewComponent;
}

/**
 * Define a View service. Provide the component with `Layer.succeed(view, Comp)`.
 *
 * @public
 */
export const make = <const K extends string,>(options: {
  readonly key: K;
  readonly kind: ViewKind;
  readonly spec: unknown;
}): AnyView<ViewId<K>> => {
  const service = Context.Service<ViewId<K>, ViewComponent>()(options.key);
  return Object.assign(service, {
    key: options.key,
    kind: options.kind,
    spec: options.spec,
  });
};

// =============================================================================
// Registry service
// =============================================================================

/** Bound chrome captured when a contribution Layer built (View service was provided). @internal */
type Bound = {
  readonly key: ViewKey;
  readonly kind: ViewKind;
  readonly Component: ViewComponent;
};

/** @public */
export interface RegistryService {
  /** Append a view for one resource tag key (multi-match). */
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

type ViewService<Id> = Context.Service<Id, ViewComponent> & {
  readonly key: ViewKey;
  readonly kind: ViewKind;
  readonly spec: unknown;
};

/** Avoid `Foo<Id>>` in .tsx return positions (parsed as JSX). */
type ContribLayer<R> = Layer.Layer<never, never, Registry | R>;

/**
 * Append one View for a stamped Hyperlink kind (multi-match / pager).
 * Add more with `Layer.mergeAll(View.kind(…), View.kind(…))`.
 *
 * @public
 */
export const kind = <Id,>(
  stampedKind: string,
  view: ViewService<Id>,
): ContribLayer<Id> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      const Component = yield* view;
      reg.addKind(stampedKind, { key: view.key, kind: view.kind, Component });
    }),
  );

/**
 * Append one View for a resource tag key (multi-match / pager).
 * Add more with `Layer.mergeAll(View.tag(…), View.tag(…))`.
 *
 * @public
 */
export const tag = <Id,>(
  resource: { readonly key: string },
  view: ViewService<Id>,
): ContribLayer<Id> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      const Component = yield* view;
      reg.addTag(resource.key, { key: view.key, kind: view.kind, Component });
    }),
  );

/**
 * Allowlist for one resource tag. Kinds present are exclusive (defaults do not apply for
 * those kinds). Optional extra views share one allowlist (precise `R`). A later `only` for
 * the same tag **replaces** the whole allowlist (`Layer.mergeAll` → last wins).
 *
 * @public
 */
export const only = <Id1, Id2 = never, Id3 = never>(
  resource: { readonly key: string },
  v1: ViewService<Id1>,
  v2?: ViewService<Id2>,
  v3?: ViewService<Id3>,
): ContribLayer<Id1 | Id2 | Id3> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      const bounds: Bound[] = [];
      const c1 = yield* v1;
      bounds.push({ key: v1.key, kind: v1.kind, Component: c1 });
      if (v2 !== undefined) {
        const c2 = yield* v2;
        bounds.push({ key: v2.key, kind: v2.kind, Component: c2 });
      }
      if (v3 !== undefined) {
        const c3 = yield* v3;
        bounds.push({ key: v3.key, kind: v3.kind, Component: c3 });
      }
      reg.setOnly(resource.key, bounds);
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
 * Chrome `R` comes from `View.kind` / `View.tag` / `View.only` layers you merge.
 *
 * @example
 * ```ts
 * const ready = Layer.mergeAll(
 *   View.group(AppGroup),
 *   View.kind(WorkPool.kind, PoolCard),
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

const FallbackCard: ViewComponent = (props) =>
  React.createElement(
    "div",
    { "data-hyperlink-view": "fallback-card" },
    props.name ?? props.tag.key,
  );

const FallbackDetail: ViewComponent = (props) =>
  React.createElement(
    "div",
    { "data-hyperlink-view": "fallback-detail" },
    props.name ?? props.tag.key,
  );

const FallbackPage: ViewComponent = (props) =>
  React.createElement(
    "div",
    { "data-hyperlink-view": "fallback-page" },
    props.name ?? props.tag.key,
  );

const fallbackFor = (viewKind: ViewKind): ViewComponent => {
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

/** Matcher card — requires {@link react} Provider. @public */
export const Card = (props: ViewProps): React.ReactElement | null =>
  React.createElement(MatchHost, {
    viewKind: "card",
    resolved: useKit().resolve(props.tag, "card"),
    tag: props.tag,
    name: props.name,
  });

/** Matcher detail — requires {@link react} Provider. @public */
export const Detail = (props: ViewProps): React.ReactElement | null =>
  React.createElement(MatchHost, {
    viewKind: "detail",
    resolved: useKit().resolve(props.tag, "detail"),
    tag: props.tag,
    name: props.name,
  });

/** Matcher page — requires {@link react} Provider. @public */
export const Page = (props: ViewProps): React.ReactElement | null =>
  React.createElement(MatchHost, {
    viewKind: "page",
    resolved: useKit().resolve(props.tag, "page"),
    tag: props.tag,
    name: props.name,
  });

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
 * `Card` / `Detail` / `Page` are module-level and read the Provider context.
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
   * Flip: bind Card/Detail/Page to one resource tag (no `tag` prop).
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
    Card,
    Detail,
    Page,
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
 *   views: Layer.mergeAll(View.kind(Group.kind, GroupCard), WebDashboardViews.layer),
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
          React.createElement(Card, { tag, name }),
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
        React.createElement(Page, { tag, name: title }),
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
      React.createElement(Detail, { tag, name: title }),
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
