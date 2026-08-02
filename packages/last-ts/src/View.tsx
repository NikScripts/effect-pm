/**
 * @module View
 *
 * View **DI** kernel (Context) — Tag, Prototype, provide, Registry.
 * Sized chrome (card/detail/page) lives in Hyperlink `Ui`, not here.
 *
 * - Mint: `View.Tag<Self, Props?>()(key, statics?)` — Effect-shaped.
 * - Provide: {@link provide}`(Tag, impl)` (or `Tag.provide(impl)`) — props infer from the Tag.
 * - Open debt: {@link Prototype}`<Props, Requirement>` then fulfill statics.
 * - Svc type is {@link View}`<Props>` (props in → element out).
 */
import * as React from "react";
import { Context, Effect, Layer, Option } from "effect";
import type * as Types from "effect/Types";

// =============================================================================
// Keys / chrome
// =============================================================================

/** Flatten `&` nests so Prototype / Tag hovers stay readable. @internal */
type Flat<T extends object> = { readonly [K in keyof T]: T[K] } & {};

/** Stable view id — prefer `app/view/<name>`. @public */
export type ViewKey = string;

/**
 * Generic size discriminant for registry matching.
 * Hosts (e.g. Hyperlink `Ui`) supply concrete tagged enums.
 *
 * @public
 */
export type SizeTag = { readonly _tag: string };

/**
 * Tag a View skin may receive — structural key only (hosts may pass richer tags).
 *
 * @public
 */
export type ViewTag = { readonly key: string };

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
 *
 * Prefer {@link provide} at the Layer boundary (props infer). Reach for `Tag["Service"]` only when
 * you need a named binding before provide.
 *
 * @public
 */
export type View<Props extends object = {}> = (
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
 * A matched view ready to render.
 *
 * @public
 */
export interface Resolved {
  readonly key: ViewKey;
  readonly kind: SizeTag;
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
  Props extends object = {},
  Requirement extends AnyStatics = {},
> = Prototype<Props, Requirement, {}>;

/**
 * Prototype whose Requirement is discharged (`{}`).
 *
 * @public
 */
export type FulfilledPrototype<
  Props extends object = {},
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
 * A View service handle (sized or naked). Sized chrome handles may carry a `size` static.
 *
 * @public
 */
export type AnyView<Self extends object = object> = Context.Service<
  Self,
  View<Self>
> & {
  readonly key: ViewKey;
  readonly size?: SizeTag;
  readonly spec?: unknown;
};

// =============================================================================
// Registry service
// =============================================================================

/** Bound chrome captured when a contribution Layer built (View service was provided). @internal */
type Bound = {
  readonly key: ViewKey;
  readonly kind: SizeTag;
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
    size: SizeTag,
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

/** Structural equality for tagged sizes. @internal */
const sameSizeTag = (a: SizeTag, b: SizeTag): boolean => a._tag === b._tag;

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
  const onlyByTagKey = new Map<string, Bound[]>();

  const fromBounds = (bounds: ReadonlyArray<Bound> | undefined, size: SizeTag): Resolved[] => {
    if (bounds === undefined) return [];
    const out: Resolved[] = [];
    for (const bound of bounds) {
      if (!sameSizeTag(bound.kind, size)) continue;
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
    match(tag, size, kindHints) {
      const allowlist = onlyByTagKey.get(tag.key);
      if (allowlist !== undefined) {
        const kindsPresent = new Set(allowlist.map((b) => b.kind._tag));
        if (kindsPresent.has(size._tag)) {
          return fromBounds(allowlist, size);
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
      add(fromBounds(byTagKey.get(tag.key), size));
      for (const kind of hints) {
        add(fromBounds(byKind.get(kind), size));
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

// =============================================================================
// Thin generic react kit (no size matchers)
// =============================================================================

type KitContext = {
  readonly registry: RegistryService;
  readonly resolve: (tag: ViewTag, size: SizeTag) => ReadonlyArray<Resolved>;
};

const RegistryReactContext = React.createContext<KitContext | null>(null);

const useKit = (): KitContext => {
  const value = React.useContext(RegistryReactContext);
  if (value === null) {
    throw new Error("View: render inside View.react(…).Provider");
  }
  return value;
};

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
          resolve: (tag: ViewTag, size: SizeTag) => registry.match(tag, size),
        };
      }),
    ),
  );

/**
 * Minimal React kit from a fully provided view Layer (`R` must be `never`).
 * Size matchers (Card/Detail/Page) live in Hyperlink `Ui`.
 *
 * @public
 */
export const react = <ROut, E,>(viewLayer: Layer.Layer<ROut, E, never>) => {
  const kit = buildKit(viewLayer);

  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement =>
    React.createElement(RegistryReactContext.Provider, { value: kit }, props.children);

  const resolve = (tag: ViewTag, size: SizeTag): ReadonlyArray<Resolved> =>
    kit.resolve(tag, size);

  return {
    Provider,
    useView: () => useKit().registry,
    resolve,
    keys: () => kit.registry.keys(),
    registry: kit.registry,
  };
};
