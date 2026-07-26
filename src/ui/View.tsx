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

const RegistryReactContext = React.createContext<{
  readonly registry: RegistryService;
  readonly resolvePins: (
    tag: LeafTag,
    viewKind: ViewKind,
  ) => ReadonlyArray<Resolved>;
} | null>(null);

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

type KitContext = {
  readonly registry: RegistryService;
  readonly resolvePins: (
    tag: LeafTag,
    viewKind: ViewKind,
  ) => ReadonlyArray<Resolved>;
};

/** Pin entry that is also a Context service (from {@link make}). @internal */
type PinService = ComponentPin & Context.Service<unknown, ViewComponent>;

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
        return { registry, resolvePins };
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

  return {
    Card,
    Detail,
    Page,
    Provider,
    useView: () => useKit().registry,
    resolve,
    keys: () => kit.registry.keys(),
    registry: kit.registry,
  };
};
