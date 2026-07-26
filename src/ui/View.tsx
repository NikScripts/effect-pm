/**
 * @module ui/View
 *
 * Keyed, Spec-based view registry — Effect Layer composition + React matcher components.
 * Design: `docs/handoffs/client-adapters-design.md` (View redesign). Prefer
 * `import { View } from "hyperlink-ts/ui"` then `View.make` / `View.react`.
 *
 * Handle = `{ key, kind, spec }` (no TSX). Skin = `View.register(handle, Component)`.
 * Match: `tag.key` → stamped `kindOf(tag)` → fallback. No RPC `groupId`. No short
 * costume kinds (`"queue"` / `"pool"`). Missing skin → skip at match (W14).
 */
import * as React from "react";
import { Context, Data, Effect, Layer } from "effect";
import { kindOf } from "../Hyperlink";
import type { LeafTag } from "./widgetRegistry";

// =============================================================================
// Errors / keys / kinds
// =============================================================================

/**
 * Two skins registered under the same view key in one Layer build.
 *
 * @public
 */
export class DuplicateViewKey extends Data.TaggedError("DuplicateViewKey")<{
  readonly key: string;
}> {}

/** Stable view id — prefer `hyperlink/view/<name>`. @public */
export type ViewKey = string;

/** Chrome role — independent registry entries per kind (W8). @public */
export type ViewKind = "card" | "detail" | "page";

// =============================================================================
// Handle + props + resolved
// =============================================================================

/** Props every matched card/detail receives. Navigation stays with the parent. @public */
export interface ViewProps {
  readonly tag: LeafTag;
  readonly name?: string;
}

/** A React/Ink view for one chrome role. @public */
export type ViewComponent = (props: ViewProps) => React.ReactElement | null;

/**
 * View identity — key + kind + family Spec. No Component (W13).
 *
 * @public
 */
export interface Handle {
  readonly key: ViewKey;
  readonly kind: ViewKind;
  /** Family Spec this view is built for (Needs SSOT). Untyped at runtime in v1. */
  readonly spec: unknown;
}

/**
 * A matched skin ready to render.
 *
 * @public
 */
export interface Resolved {
  readonly handle: Handle;
  readonly Component: ViewComponent;
}

/**
 * Define a view handle. Does not register a skin — pass to {@link register}.
 *
 * @public
 */
export const make = (options: {
  readonly key: ViewKey;
  readonly kind: ViewKind;
  readonly spec: unknown;
}): Handle => options;

// =============================================================================
// Registry service (EventLog-style)
// =============================================================================

/** @public */
export interface RegistryService {
  readonly register: (handle: Handle, component: ViewComponent) => void;
  readonly bindTagKey: (tagKey: string, viewKey: ViewKey) => void;
  readonly bindKind: (kind: string, viewKey: ViewKey) => void;
  readonly get: (viewKey: ViewKey) => Resolved | undefined;
  readonly match: (tag: LeafTag, viewKind: ViewKind) => ReadonlyArray<Resolved>;
  readonly keys: () => ReadonlyArray<ViewKey>;
}

/**
 * View registry — look up chrome by view key / tag binds / stamped kind.
 *
 * @public
 */
export class Registry extends Context.Service<Registry, RegistryService>()(
  "hyperlink-ts/ui/View/Registry",
) {}

const pushUnique = (map: Map<string, ViewKey[]>, key: string, viewKey: ViewKey): void => {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [viewKey]);
    return;
  }
  if (!list.includes(viewKey)) list.push(viewKey);
};

const makeRegistryService = (): RegistryService => {
  const skins = new Map<ViewKey, Resolved>();
  const byTagKey = new Map<string, ViewKey[]>();
  const byKind = new Map<string, ViewKey[]>();

  const resolveSkin = (viewKey: ViewKey): Resolved | undefined => skins.get(viewKey);

  const collect = (viewKeys: ReadonlyArray<ViewKey> | undefined, viewKind: ViewKind, out: Resolved[]): void => {
    if (viewKeys === undefined) return;
    for (const viewKey of viewKeys) {
      const resolved = resolveSkin(viewKey);
      if (resolved === undefined) continue; // W14 — missing skin skipped
      if (resolved.handle.kind !== viewKind) continue;
      if (out.some((r) => r.handle.key === viewKey)) continue;
      out.push(resolved);
    }
  };

  return {
    register(handle, component) {
      if (skins.has(handle.key)) {
        throw new DuplicateViewKey({ key: handle.key });
      }
      skins.set(handle.key, { handle, Component: component });
    },
    bindTagKey(tagKey, viewKey) {
      pushUnique(byTagKey, tagKey, viewKey);
    },
    bindKind(kind, viewKey) {
      pushUnique(byKind, kind, viewKey);
    },
    get(viewKey) {
      return skins.get(viewKey);
    },
    match(tag, viewKind) {
      const out: Resolved[] = [];
      // 1. exact tag.key
      collect(byTagKey.get(tag.key), viewKind, out);
      // 2. stamped contract kind (never RPC groupId)
      const stamped = kindOf(tag as never);
      if (typeof stamped === "string") {
        collect(byKind.get(stamped), viewKind, out);
      }
      return out;
    },
    keys() {
      return [...skins.keys()];
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
 * Shipped registry shell (empty skins in skeleton — migrate `base` widgets next).
 *
 * @public
 */
export const base: Layer.Layer<Registry> = layer;

/**
 * Register a skin for a {@link make} handle. Requires {@link layer} / {@link base}.
 *
 * @public
 */
export const register = (
  handle: Handle,
  component: ViewComponent,
): Layer.Layer<never, never, Registry> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      reg.register(handle, component);
    }),
  );

/**
 * Bind one resource tag key → view key (exact override). Appends; multi-match keeps order.
 *
 * @public
 */
export const bindTag = (
  tag: { readonly key: string },
  entry: Handle | ViewKey,
): Layer.Layer<never, never, Registry> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      reg.bindTagKey(tag.key, typeof entry === "string" ? entry : entry.key);
    }),
  );

/**
 * Bind a stamped Hyperlink kind (`WorkPool.kind`, …) → view key. Appends; multi-match keeps order.
 *
 * @public
 */
export const bindKind = (
  kind: string,
  entry: Handle | ViewKey,
): Layer.Layer<never, never, Registry> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      reg.bindKind(kind, typeof entry === "string" ? entry : entry.key);
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

const RegistryReactContext = React.createContext<RegistryService | null>(null);

/** Build a {@link Registry} once from a Layer that provides it. @internal */
const buildRegistry = (viewLayer: Layer.Layer<Registry>): RegistryService =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const ctx = yield* Layer.build(viewLayer);
        return Context.get(ctx, Registry);
      }),
    ),
  );

/** Multi-match host — pager stub (first page); desktop tabs later (W8). @internal */
const MatchHost = (props: {
  readonly viewKind: ViewKind;
  readonly resolved: ReadonlyArray<Resolved>;
  readonly tag: LeafTag;
  readonly name?: string;
}): React.ReactElement | null => {
  const list =
    props.resolved.length === 0
      ? [{ handle: { key: `fallback/${props.viewKind}`, kind: props.viewKind, spec: {} }, Component: fallbackFor(props.viewKind) }]
      : props.resolved;
  if (list.length === 1) {
    return React.createElement(list[0]!.Component, { tag: props.tag, name: props.name });
  }
  // Thin pager: expose pages; host chrome (swipe/tabs) is a follow-up.
  return React.createElement(
    "div",
    { "data-hyperlink-view": "pager", "data-view-kind": props.viewKind, "data-page-count": list.length },
    ...list.map((item, index) =>
      React.createElement(
        "div",
        { key: item.handle.key, "data-hyperlink-view-page": index, hidden: index !== 0 },
        React.createElement(item.Component, { tag: props.tag, name: props.name }),
      ),
    ),
  );
};

/**
 * React kit from a view Layer. Pass `Layer.provideMerge(contributions, View.base)` (or equivalent).
 *
 * @public
 */
export const react = (viewLayer: Layer.Layer<Registry>) => {
  const registry = buildRegistry(viewLayer);

  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement =>
    React.createElement(RegistryReactContext.Provider, { value: registry }, props.children);

  const useView = (): RegistryService => {
    const reg = React.useContext(RegistryReactContext);
    if (reg === null) {
      throw new Error("View.useView: render inside View.react(…).Provider");
    }
    return reg;
  };

  const resolve = (tag: LeafTag, viewKind: ViewKind): ReadonlyArray<Resolved> =>
    registry.match(tag, viewKind);

  const Card = (props: ViewProps): React.ReactElement | null =>
    React.createElement(MatchHost, {
      viewKind: "card",
      resolved: useView().match(props.tag, "card"),
      tag: props.tag,
      name: props.name,
    });

  const Detail = (props: ViewProps): React.ReactElement | null =>
    React.createElement(MatchHost, {
      viewKind: "detail",
      resolved: useView().match(props.tag, "detail"),
      tag: props.tag,
      name: props.name,
    });

  const Page = (props: ViewProps): React.ReactElement | null =>
    React.createElement(MatchHost, {
      viewKind: "page",
      resolved: useView().match(props.tag, "page"),
      tag: props.tag,
      name: props.name,
    });

  return {
    Card,
    Detail,
    Page,
    Provider,
    useView,
    resolve,
    keys: () => registry.keys(),
    registry,
  };
};
