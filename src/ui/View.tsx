/**
 * @module ui/View
 *
 * Keyed, Spec-based view registry — Effect Layer composition + React matcher components.
 * Design: `docs/handoffs/client-adapters-design.md` (View redesign). Prefer
 * `import { View } from "hyperlink-ts/ui"` then `View.make` / `View.react`.
 *
 * v1 skeleton: `make` / `register` / `bind*` / `react` → `{ Card, Detail, Provider, useView, resolve }`.
 * Tag `view?: string` stamp match is supported when present on the tag object; Hyperlink Tag
 * options Eng is a follow-up.
 */
import * as React from "react";
import { Context, Data, Effect, Layer } from "effect";
import { kindOf } from "../Hyperlink";
import type { LeafTag } from "./widgetRegistry";

// =============================================================================
// Errors / keys
// =============================================================================

/**
 * Two {@link make} entries registered under the same view key.
 *
 * @public
 */
export class DuplicateViewKey extends Data.TaggedError("DuplicateViewKey")<{
  readonly key: string;
}> {}

/** Stable view id — prefer `hyperlink/view/<name>`. @public */
export type ViewKey = string;

// =============================================================================
// Entry + props
// =============================================================================

/** Props every matched card/detail/cell receives. Navigation stays with the parent. @public */
export interface ViewProps {
  readonly tag: LeafTag;
  readonly name?: string;
}

/** A React view for one chrome size. @public */
export type ViewComponent = (props: ViewProps) => React.ReactElement | null;

/**
 * One registry entry — keyed, Spec-based, with optional chrome components.
 *
 * @public
 */
export interface Entry {
  readonly key: ViewKey;
  /** Family Spec this entry is built for (Needs SSOT). Untyped at runtime in v1. */
  readonly spec: unknown;
  readonly card?: ViewComponent;
  readonly detail?: ViewComponent;
  readonly cell?: ViewComponent;
}

/**
 * Define a view entry. Does not register it — pass to {@link register}.
 *
 * @public
 */
export const make = (options: {
  readonly key: ViewKey;
  readonly spec: unknown;
  readonly card?: ViewComponent;
  readonly detail?: ViewComponent;
  readonly cell?: ViewComponent;
}): Entry => options;

// =============================================================================
// Registry service (EventLog-style)
// =============================================================================

/** @public */
export interface RegistryService {
  readonly register: (entry: Entry) => void;
  readonly bindTagKey: (tagKey: string, viewKey: ViewKey) => void;
  readonly bindFactoryGroupId: (groupId: string, viewKey: ViewKey) => void;
  readonly bindKind: (kind: string, viewKey: ViewKey) => void;
  readonly get: (viewKey: ViewKey) => Entry | undefined;
  readonly match: (tag: LeafTag) => Entry | undefined;
  readonly keys: () => ReadonlyArray<ViewKey>;
}

/**
 * View registry — look up chrome by view key / tag binds / kind.
 *
 * @public
 */
export class Registry extends Context.Service<Registry, RegistryService>()(
  "hyperlink-ts/ui/View/Registry",
) {}

/** Read optional `view` stamp on a tag (Tag options Eng will populate this). @public */
export const viewKeyOf = (tag: unknown): ViewKey | undefined => {
  if (
    (typeof tag === "object" || typeof tag === "function") &&
    tag !== null &&
    "view" in tag &&
    typeof (tag as { readonly view: unknown }).view === "string"
  ) {
    return (tag as { readonly view: string }).view;
  }
  return undefined;
};

/** Factory-ish: `tagFor` result carries `groupId`. @public */
export type FactoryLike = {
  readonly groupId: string;
};

const makeRegistryService = (): RegistryService => {
  const byViewKey = new Map<ViewKey, Entry>();
  const byTagKey = new Map<string, ViewKey>();
  const byFactoryGroupId = new Map<string, ViewKey>();
  const byKind = new Map<string, ViewKey>();

  const resolveEntry = (viewKey: ViewKey | undefined): Entry | undefined =>
    viewKey === undefined ? undefined : byViewKey.get(viewKey);

  return {
    register(entry) {
      if (byViewKey.has(entry.key)) {
        throw new DuplicateViewKey({ key: entry.key });
      }
      byViewKey.set(entry.key, entry);
    },
    bindTagKey(tagKey, viewKey) {
      byTagKey.set(tagKey, viewKey);
    },
    bindFactoryGroupId(groupId, viewKey) {
      byFactoryGroupId.set(groupId, viewKey);
    },
    bindKind(kind, viewKey) {
      byKind.set(kind, viewKey);
    },
    get(viewKey) {
      return byViewKey.get(viewKey);
    },
    match(tag) {
      // 1. tag.view annotation
      const fromAnno = resolveEntry(viewKeyOf(tag));
      if (fromAnno !== undefined) return fromAnno;
      // 2. exact tag.key bind
      const fromTag = resolveEntry(byTagKey.get(tag.key));
      if (fromTag !== undefined) return fromTag;
      // 3. factory groupId bind (tag.groupId when present)
      const groupId =
        "groupId" in tag && typeof (tag as { readonly groupId: unknown }).groupId === "string"
          ? (tag as { readonly groupId: string }).groupId
          : undefined;
      const fromFactory = resolveEntry(
        groupId === undefined ? undefined : byFactoryGroupId.get(groupId),
      );
      if (fromFactory !== undefined) return fromFactory;
      // 4. kind (intentional specialized UX)
      const kind = kindOf(tag as never);
      if (typeof kind === "string") {
        const fromKind = resolveEntry(byKind.get(kind));
        if (fromKind !== undefined) return fromKind;
      }
      return undefined;
    },
    keys() {
      return [...byViewKey.keys()];
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
 * Shipped registry shell (empty entries in skeleton — migrate `base` widgets next).
 *
 * @public
 */
export const base: Layer.Layer<Registry> = layer;

/**
 * Register a {@link make} entry. Requires {@link layer} / {@link base}.
 *
 * @public
 */
export const register = (entry: Entry): Layer.Layer<never, never, Registry> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      reg.register(entry);
    }),
  );

/**
 * Bind one resource tag key → view key (exact override).
 *
 * @public
 */
export const bindTag = (
  tag: { readonly key: string },
  entry: Entry | ViewKey,
): Layer.Layer<never, never, Registry> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      reg.bindTagKey(tag.key, typeof entry === "string" ? entry : entry.key);
    }),
  );

/**
 * Bind a `tagFor` factory (by `groupId`) → view key.
 *
 * @public
 */
export const bindFactory = (
  factory: FactoryLike,
  entry: Entry | ViewKey,
): Layer.Layer<never, never, Registry> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const reg = yield* Registry;
      reg.bindFactoryGroupId(factory.groupId, typeof entry === "string" ? entry : entry.key);
    }),
  );

/**
 * Bind a Hyperlink kind string → view key (match step 4).
 *
 * @public
 */
export const bindKind = (
  kind: string,
  entry: Entry | ViewKey,
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

  const resolve = (tag: LeafTag): Entry | undefined => registry.match(tag);

  const Card = (props: ViewProps): React.ReactElement | null => {
    const entry = useView().match(props.tag);
    const Comp = entry?.card ?? FallbackCard;
    return React.createElement(Comp, props);
  };

  const Detail = (props: ViewProps): React.ReactElement | null => {
    const entry = useView().match(props.tag);
    const Comp = entry?.detail ?? FallbackDetail;
    return React.createElement(Comp, props);
  };

  return {
    Card,
    Detail,
    Provider,
    useView,
    resolve,
    keys: () => registry.keys(),
    registry,
  };
};
