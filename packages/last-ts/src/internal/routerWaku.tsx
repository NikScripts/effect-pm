/**
 * Waku **layer** for {@link ../ui/Router} — adapts Waku into the same
 * {@link ./uiRouter.Service}. Not a second router.
 */
"use client";

import * as errors from "./errors";
import * as React from "react";
import { Option } from "effect";
import { useRouter as useWakuRouter } from "waku/router/client";
import * as Route from "../Route";
import * as Router from "../Router";
import type { ApiConstraint } from "./routes";
import type { Service } from "./router";
import { getProp } from "./predicates";

// =============================================================================
// Layer input — catalog binding (provided into the one Router.Service)
// =============================================================================

/**
 * Catalog + url skin for the Waku layer.
 * `U` defaults to {@link Route.UrlBuilder} — docs may pass a branded skin.
 */
export type WakuBinding<
  A extends ApiConstraint = ApiConstraint,
  U = Route.UrlBuilder<A>,
> = {
  readonly _tag: "WakuBinding";
  readonly api: A;
  readonly urls: U;
};

export function isWakuBinding(
  u: Service | WakuBinding<ApiConstraint, unknown>,
): u is WakuBinding<ApiConstraint, unknown>;
export function isWakuBinding(u: unknown): u is WakuBinding;
export function isWakuBinding(u: unknown): u is WakuBinding {
  return (
    typeof u === "object" &&
    u !== null &&
    "_tag" in u &&
    getProp(u, "_tag") === "WakuBinding"
  );
}

/** Bind a catalog to the Waku layer — same role as `History.service(api)`. */
export function waku<A extends ApiConstraint>(
  api: A,
): WakuBinding<A, Route.UrlBuilder<A>>;
export function waku<A extends ApiConstraint, U>(
  api: A,
  urls: U,
): WakuBinding<A, U>;
export function waku<A extends ApiConstraint, U>(
  api: A,
  urls?: U,
): WakuBinding<A, U | Route.UrlBuilder<A>> {
  return {
    _tag: "WakuBinding",
    api,
    urls: urls ?? Route.urlBuilder(api),
  };
}

let defaultBinding: WakuBinding<ApiConstraint, unknown> | null = null;

/** Structural re-check of an erased mounted service before trusting the mount's `A`. */
const isServiceOf = <A extends ApiConstraint>(u: Service): u is Service<A> =>
  typeof u.go === "function" && typeof u.to === "function";

/** Structural re-check of the module default binding before trusting the mount's `A`. */
const isBindingOf = <A extends ApiConstraint>(
  u: WakuBinding<ApiConstraint, unknown>,
): u is WakuBinding<A, unknown> => isWakuBinding(u);

/** Runtime-checked absolute path → Waku's route-template string. */
const toWakuTarget = (next: string): `/${string}` => {
  if (!next.startsWith("/")) {
    throw new errors.InvariantViolated({
      what: `Waku navigation target must be absolute: ${next}`,
    });
  }
  return `/${next.slice(1)}`;
};

/** Optional default Waku binding when no Provider is mounted (docs UI). */
export const setDefault = <A extends ApiConstraint, U>(
  binding: WakuBinding<A, U> | null,
): void => {
  defaultBinding = binding;
};

export const getDefault = (): WakuBinding<ApiConstraint, unknown> | null =>
  defaultBinding;

// =============================================================================
// Adapt Waku → Service
// =============================================================================

const pathOnly = (href: string): string => {
  const q = href.indexOf("?");
  const h = href.indexOf("#");
  let end = href.length;
  if (q >= 0) end = Math.min(end, q);
  if (h >= 0) end = Math.min(end, h);
  const path = href.slice(0, end);
  return path === "" ? "/" : path;
};

type WakuNav = ReturnType<typeof useWakuRouter>;

/** Build the one {@link Service} over a live Waku router handle. */
export const liveService = <A extends ApiConstraint>(
  binding: WakuBinding<A, unknown>,
  wakuNav: WakuNav,
): Service<A> => {
  const pathname = wakuNav.path || "/";
  const search =
    typeof window === "undefined" ? "" : window.location.search;
  const href = search.length === 0 ? pathname : `${pathname}${search}`;
  const match = Option.getOrUndefined(Route.match(binding.api, pathname));
  // Derived from the catalog itself (single source of truth) — a custom skin on the
  // binding still renders, but the live typed surface always matches the catalog.
  const urls = Route.urlBuilder(binding.api);

  const go = (
    next: string,
    options?: { readonly replace?: boolean },
  ): void => {
    const target = toWakuTarget(pathOnly(next));
    if (options?.replace === true) void wakuNav.replace(target);
    else void wakuNav.push(target);
  };

  return {
    api: binding.api,
    _tag: "Waku",
    pathname,
    search,
    href,
    match,
    urls,
    go,
    to: (build, options) => go(build(urls), options),
    back: () => {
      wakuNav.back();
    },
    toRoot: () => {
      go("/", { replace: true });
    },
    prefetch: (next: string) => {
      wakuNav.prefetch(toWakuTarget(pathOnly(next)));
    },
    subscribe: () => () => {
      /* re-render via useWakuRouter in the Provider / useRouter hook */
    },
    syncFromLocation: () => {
      /* Waku owns location */
    },
  };
};

const useLiveFromBinding = (
  binding: WakuBinding<ApiConstraint, unknown>,
): Service => {
  const wakuNav = useWakuRouter();
  return liveService(binding, wakuNav);
};

// =============================================================================
// Provider — installs the one Service into Router's React context
// =============================================================================

const WakuServiceProvider = (props: {
  readonly binding: WakuBinding<ApiConstraint, unknown>;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const service = useLiveFromBinding(props.binding);
  return (
    <Router.Provider value={service}>{props.children}</Router.Provider>
  );
};

/**
 * One Provider for both layers: pass a lite {@link Service} or a {@link WakuBinding}.
 */
export const Provider = (props: {
  readonly value: Service | WakuBinding<ApiConstraint, unknown>;
  readonly children: React.ReactNode;
}): React.ReactElement => {
  const value = props.value;
  if (isWakuBinding(value)) {
    return (
      <WakuServiceProvider binding={value}>
        {props.children}
      </WakuServiceProvider>
    );
  }
  return (
    <Router.Provider value={value}>{props.children}</Router.Provider>
  );
};

/**
 * The one {@link Service} — from Provider context, or default Waku binding.
 *
 * This entry always runs under Waku's router (companion pulls `waku`). Prefer
 * context from {@link Provider}; `setDefault` is for UI without a local Provider.
 */
export const useRouter = <A extends ApiConstraint = ApiConstraint>(): Service<A> => {
  const fromCtx = Router.useRouterOption();
  const wakuNav = useWakuRouter();
  // The mount contract carries `A` (the provider was created from this catalog); the
  // erased context value is re-checked structurally before it is trusted.
  if (fromCtx !== null && isServiceOf<A>(fromCtx)) return fromCtx;
  if (defaultBinding !== null && isBindingOf<A>(defaultBinding)) {
    return liveService(defaultBinding, wakuNav);
  }
  throw new errors.WakuRouterMissing();
};

export const useHasRouter = (): boolean =>
  Router.useHasRouter() || defaultBinding !== null;

export const useMatch = (): Route.Match | undefined => useRouter().match;
