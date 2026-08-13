/**
 * Last.context / Last.use / Last.provider(context) — React bag over Effect services.
 *
 * @internal
 */
import * as React from "react";
import { Context } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import * as AtomReact from "../AtomReact";

export const LastContextTypeId = "~last-ts/Last/context" as const;

/** Spec entry: a Context tag or a nested Last.context class. */
export type SpecValue = Context.Tag<any, any> | LastContextClass<any>;

export type Spec = { readonly [key: string]: SpecValue };

export type LastContextClass<S extends Spec = Spec> = {
  readonly [LastContextTypeId]: typeof LastContextTypeId;
  readonly spec: S;
};

const isLastContext = (u: unknown): u is LastContextClass =>
  typeof u === "function" &&
  u !== null &&
  LastContextTypeId in u &&
  (u as LastContextClass)[LastContextTypeId] === LastContextTypeId;

const isTag = (u: unknown): u is Context.Tag<any, any> =>
  typeof u === "function" &&
  u !== null &&
  "key" in u &&
  typeof (u as { readonly key: unknown }).key === "string";

/** Resolved value shape for a context spec. */
export type TypeOfSpec<S extends Spec> = {
  readonly [K in keyof S]: S[K] extends LastContextClass<infer Nested>
    ? TypeOfSpec<Nested>
    : S[K] extends Context.Tag<any, infer A>
      ? A
      : never;
};

/** Flattened service union for Layer debt. */
export type ServicesOfSpec<S extends Spec> = {
  [K in keyof S]: S[K] extends LastContextClass<infer Nested>
    ? ServicesOfSpec<Nested>
    : S[K] extends Context.Tag<infer I, any>
      ? I
      : never;
}[keyof S];

export type ServicesOf<C> = C extends LastContextClass<infer S>
  ? ServicesOfSpec<S>
  : never;

type BagsStore = {
  readonly get: (ctx: LastContextClass) => object | undefined;
  readonly set: (ctx: LastContextClass, bag: object) => void;
};

const BagsReactContext = React.createContext<BagsStore | null>(null);

/** Effect Context from `Last.provider(layer)` for sync service lookup. */
const EffectReactContext = React.createContext<Context.Context<any> | null>(
  null,
);

export const EffectContextProvider = (props: {
  readonly context: Context.Context<any>;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(
    EffectReactContext.Provider,
    { value: props.context },
    props.children,
  );

const resolveBag = (
  effectCtx: Context.Context<any>,
  spec: Spec,
): object => {
  const bag: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(spec)) {
    if (isLastContext(value)) {
      bag[key] = resolveBag(effectCtx, value.spec);
    } else if (isTag(value)) {
      bag[key] = Context.get(effectCtx, value);
    }
  }
  return bag;
};

const registerBags = (
  store: BagsStore,
  effectCtx: Context.Context<any>,
  ctxClass: LastContextClass,
): object => {
  const bag = resolveBag(effectCtx, ctxClass.spec);
  store.set(ctxClass, bag);
  for (const value of Object.values(ctxClass.spec)) {
    if (isLastContext(value)) {
      registerBags(store, effectCtx, value);
    }
  }
  return bag;
};

/**
 * Mint a Last.context base class: `class Site extends Last.context({ … }) {}`.
 *
 * @internal
 */
export const context = <const S extends Spec>(
  spec: S,
): (abstract new () => {}) & LastContextClass<S> => {
  abstract class Ctx {
    static readonly [LastContextTypeId] = LastContextTypeId;
    static readonly spec = spec;
  }
  return Ctx as unknown as (abstract new () => {}) & LastContextClass<S>;
};

/**
 * Resolve a context bag under {@link makeContextProvider}.
 *
 * @internal
 */
export const use = <C extends LastContextClass<any>>(
  ctx: C,
): TypeOfSpec<C["spec"]> => {
  const store = React.useContext(BagsReactContext);
  if (store === null) {
    throw new Error(
      "Last.use: wrap the tree in Last.provider(YourContext) under an Atom runtime",
    );
  }
  const bag = store.get(ctx);
  if (bag === undefined) {
    throw new Error(
      "Last.use: context was not registered by Last.provider — nest it under the provided root or provide it directly",
    );
  }
  return bag as TypeOfSpec<C["spec"]>;
};

const useEffectContext = (): Context.Context<any> => {
  const fromLayer = React.useContext(EffectReactContext);
  if (fromLayer !== null) return fromLayer;
  const runtime = AtomReact.useRuntime();
  const result = AtomReact.useAtomValue(runtime);
  if (!AsyncResult.isSuccess(result)) {
    throw new Error("Last.provider(context): Atom runtime Context not ready");
  }
  return result.value;
};

/**
 * React bridge: project Effect Context services into bags for {@link use}.
 *
 * @internal
 */
export const makeContextProvider = (
  ctxClass: LastContextClass,
): ((props: {
  readonly children: React.ReactNode;
}) => React.ReactElement) => {
  const Provider = (props: {
    readonly children: React.ReactNode;
  }): React.ReactElement => {
    const effectCtx = useEffectContext();
    const parent = React.useContext(BagsReactContext);

    const store = React.useMemo((): BagsStore => {
      const map = new Map<object, object>();
      registerBags(
        {
          get: (c) => map.get(c),
          set: (c, bag) => {
            map.set(c, bag);
          },
        },
        effectCtx,
        ctxClass,
      );
      return {
        get: (c) => map.get(c) ?? parent?.get(c),
        set: (c, bag) => {
          map.set(c, bag);
        },
      };
    }, [effectCtx, parent, ctxClass]);

    return React.createElement(
      BagsReactContext.Provider,
      { value: store },
      props.children,
    );
  };
  Provider.displayName = "Last.provider(context)";
  return Provider;
};

/** True when `u` is a Last.context class. @internal */
export const isContextClass = isLastContext;
