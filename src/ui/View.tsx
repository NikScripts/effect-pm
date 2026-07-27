/**
 * @module ui/View
 *
 * View **services** (Context) + registry binds + React matchers.
 * Design: `docs/handoffs/client-adapters-design.md`.
 *
 * - `View.make` → Context.Service whose Svc is the React/Ink component (+ key/kind/spec).
 * - Provide TSX with `Layer.succeed(PoolCard, Comp)`.
 * - `View.bind*` **requires** those services (Layer `R`) until provided.
 * - `View.react(layer)` runs the Layer and requires `R = never` (missing skin = type error).
 * - Pins: `Hyperlink.components([…])` on the resource tag (opt-in override).
 */
import * as React from "react";
import { Context, Effect, Layer, Option } from "effect";
import * as Group from "../Group";
import { componentsOf, kindOf, type ComponentPin } from "../Hyperlink";
import type { LeafTag } from "./widgetRegistry";

// =============================================================================
// Keys / kinds / props
// =============================================================================

/** Stable view id — prefer `hyperlink/view/<name>`. @public */
export type ViewKey = string;

/** Chrome role — independent View services per kind (W8). @public */
export type ViewKind = "card" | "detail" | "page";

/** Props every matched card/detail/page receives. Navigation stays with the parent. @public */
export interface ViewProps {
  readonly tag: LeafTag;
  readonly name?: string;
}

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

/** Bound chrome captured when the bind Layer built (View service was provided). @internal */
type Bound = {
  readonly key: ViewKey;
  readonly kind: ViewKind;
  readonly Component: ViewComponent;
};

/** @public */
export interface RegistryService {
  readonly bindTagKey: (tagKey: string, bound: Bound) => void;
  readonly bindKind: (kind: string, bound: Bound) => void;
  readonly match: (tag: LeafTag, viewKind: ViewKind) => ReadonlyArray<Resolved>;
  readonly keys: () => ReadonlyArray<ViewKey>;
}

/**
 * View registry — bind tables + match (tag key / stamped kind).
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
    bindTagKey(tagKey, bound) {
      pushBound(byTagKey, tagKey, bound);
    },
    bindKind(kind, bound) {
      pushBound(byKind, kind, bound);
    },
    match(tag, viewKind) {
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
      const stamped = kindOf(tag as never);
      if (typeof stamped === "string") {
        add(fromBounds(byKind.get(stamped), viewKind));
      }
      return out;
    },
    keys() {
      const keys = new Set<ViewKey>();
      for (const list of byTagKey.values()) for (const b of list) keys.add(b.key);
      for (const list of byKind.values()) for (const b of list) keys.add(b.key);
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

/**
 * Bind one resource tag key → View service. **Requires** that View in Layer `R`.
 *
 * @public
 */
type BindRequirements<Id> = Registry | Id;
/** Avoid `Foo<Id>>` in .tsx return positions (parsed as JSX). */
type BindLayer<Id> = Layer.Layer<never, never, BindRequirements<Id>>;

export const bindTag = <Id,>(
  tag: { readonly key: string },
  view: ViewService<Id>,
): BindLayer<Id> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      const Component = yield* view;
      reg.bindTagKey(tag.key, { key: view.key, kind: view.kind, Component });
    }),
  );

/**
 * Bind a stamped Hyperlink kind → View service. **Requires** that View in Layer `R`.
 *
 * @public
 */
export const bindKind = <Id,>(
  kind: string,
  view: ViewService<Id>,
): BindLayer<Id> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      const Component = yield* view;
      reg.bindKind(kind, { key: view.key, kind: view.kind, Component });
    }),
  );

/**
 * Require a View service in Layer `R` without binding it (e.g. pin-only chrome for
 * {@link group}). Compose with `Layer.mergeAll(View.requireView(A), View.requireView(B), …)`.
 *
 * @public
 */
export const requireView = <Id,>(view: ViewService<Id>): Layer.Layer<never, never, Id> =>
  Layer.effectDiscard(Effect.asVoid(view));

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
 * Pin View services found on Group leaves (`Hyperlink.components`). Use with
 * {@link requireView} / `Layer.succeed` so `View.react` sees `R = never`.
 *
 * @public
 */
export const pinnedViewsOf = (appGroup: GroupLike): ReadonlyArray<ComponentPin> => {
  const out: ComponentPin[] = [];
  const seen = new Set<string>();
  for (const leaf of collectLeaves(appGroup)) {
    for (const pin of componentsOf(leaf) ?? []) {
      if (seen.has(pin.key)) continue;
      seen.add(pin.key);
      out.push(pin);
    }
  }
  return out;
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
 * Default View `R` still comes from {@link bindKind} / {@link bindTag} layers you merge.
 * Pin-only views: merge {@link requireView} for each of {@link pinnedViewsOf}`(group)` (or
 * `Layer.succeed` them in chrome).
 *
 * @example
 * ```ts
 * const ready = Layer.mergeAll(
 *   View.group(AppGroup),
 *   View.bindKind(WorkPool.kind, PoolCard),
 *   View.requireView(CustomCard), // if a member pins CustomCard
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
  readonly resolvePins: (
    tag: LeafTag,
    viewKind: ViewKind,
  ) => ReadonlyArray<Resolved>;
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
  readonly tag: LeafTag;
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

/** Pin entry that is also a Context service (from {@link make}). @internal */
type PinService = ComponentPin & Context.Service<unknown, ViewComponent>;

/** Props for {@link react}`.for(tag)` bound matchers — tag is curated. @public */
export interface BoundViewProps {
  readonly name?: string;
}

/**
 * Build registry + pin resolver from a **fully provided** view Layer (`R = never`).
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
        const resolvePins = (tag: LeafTag, viewKind: ViewKind): ReadonlyArray<Resolved> => {
          const pins = componentsOf(tag)?.filter((p) => p.kind === viewKind);
          if (pins !== undefined && pins.length > 0) {
            const out: Resolved[] = [];
            for (const pin of pins) {
              const comp = Context.getOption(ctx, pin as PinService);
              if (Option.isNone(comp)) continue; // W14 last resort
              out.push({
                key: pin.key,
                kind: pin.kind as ViewKind,
                Component: comp.value,
              });
            }
            return out;
          }
          return registry.match(tag, viewKind);
        };
        return { registry, resolvePins, groupDash };
      }),
    ),
  );

/**
 * React kit from a fully provided view Layer (`R` must be `never`).
 *
 * @public
 */
export const react = <ROut, E,>(viewLayer: Layer.Layer<ROut, E, never>) => {
  const kit = buildKit(viewLayer);

  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement =>
    React.createElement(RegistryReactContext.Provider, { value: kit }, props.children);

  const useKit = (): KitContext => {
    const value = React.useContext(RegistryReactContext);
    if (value === null) {
      throw new Error("View.useView: render inside View.react(…).Provider");
    }
    return value;
  };

  const resolve = (tag: LeafTag, viewKind: ViewKind): ReadonlyArray<Resolved> =>
    kit.resolvePins(tag, viewKind);

  const Card = (props: ViewProps): React.ReactElement | null =>
    React.createElement(MatchHost, {
      viewKind: "card",
      resolved: useKit().resolvePins(props.tag, "card"),
      tag: props.tag,
      name: props.name,
    });

  const Detail = (props: ViewProps): React.ReactElement | null =>
    React.createElement(MatchHost, {
      viewKind: "detail",
      resolved: useKit().resolvePins(props.tag, "detail"),
      tag: props.tag,
      name: props.name,
    });

  const Page = (props: ViewProps): React.ReactElement | null =>
    React.createElement(MatchHost, {
      viewKind: "page",
      resolved: useKit().resolvePins(props.tag, "page"),
      tag: props.tag,
      name: props.name,
    });

  /**
   * Flip: bind Card/Detail/Page to one resource tag (no `tag` prop).
   * Still render inside {@link Provider}.
   */
  const forTag = (tag: LeafTag) => ({
    Card: (props: BoundViewProps): React.ReactElement | null =>
      React.createElement(MatchHost, {
        viewKind: "card",
        resolved: useKit().resolvePins(tag, "card"),
        tag,
        name: props.name,
      }),
    Detail: (props: BoundViewProps): React.ReactElement | null =>
      React.createElement(MatchHost, {
        viewKind: "detail",
        resolved: useKit().resolvePins(tag, "detail"),
        tag,
        name: props.name,
      }),
    Page: (props: BoundViewProps): React.ReactElement | null =>
      React.createElement(MatchHost, {
        viewKind: "page",
        resolved: useKit().resolvePins(tag, "page"),
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
