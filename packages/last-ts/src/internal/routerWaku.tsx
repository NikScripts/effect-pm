/**
 * Waku **layer** for {@link ../ui/Router} — adapts Waku into the same
 * {@link ./uiRouter.Service}. Not a second router.
 */
"use client";

import * as React from "react";
import { Option } from "effect";
import {
  Link as WakuLink,
  useRouter as useWakuRouter,
} from "waku/router/client";
import * as Route from "../Route";
import * as Router from "../Router";
import type { ApiConstraint } from "./routes";
import type { Service } from "./router";

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
    (u as { _tag: unknown })._tag === "WakuBinding"
  );
}

/** Bind a catalog to the Waku layer — same role as `Router.unsafeService(api, "History")`. */
export const waku = <A extends ApiConstraint, U = Route.UrlBuilder<A>>(
  api: A,
  urls?: U,
): WakuBinding<A, U> => ({
  _tag: "WakuBinding",
  api,
  urls: (urls ?? Route.urlBuilder(api)) as U,
});

let defaultBinding: WakuBinding<ApiConstraint, unknown> | null = null;

/** Optional default Waku binding when no Provider is mounted (docs chrome). */
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
  const urls = binding.urls as Route.UrlBuilder<A>;

  const go = (
    next: string,
    options?: { readonly replace?: boolean },
  ): void => {
    const target = pathOnly(next) as Parameters<typeof wakuNav.push>[0];
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
      wakuNav.prefetch(
        pathOnly(next) as Parameters<typeof wakuNav.prefetch>[0],
      );
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
 * context from {@link Provider}; `setDefault` is for chrome without a local Provider.
 */
export const useRouter = <A extends ApiConstraint = ApiConstraint>(): Service<A> => {
  const fromCtx = Router.useRouterOption();
  const wakuNav = useWakuRouter();
  if (fromCtx !== null) return fromCtx as Service<A>;
  const binding = defaultBinding as WakuBinding<A> | null;
  if (binding === null) {
    throw new Error(
      "Router: provide via Provider (Service or waku binding) or setDefault",
    );
  }
  return liveService(binding, wakuNav);
};

export const useHasRouter = (): boolean =>
  Router.useHasRouter() || defaultBinding !== null;

export const useMatch = (): Route.Match | undefined => useRouter().match;

const softNavClick = (
  event: React.MouseEvent<HTMLAnchorElement>,
  go: () => void,
  onClick?: React.MouseEventHandler<HTMLAnchorElement>,
): void => {
  onClick?.(event);
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey
  ) {
    return;
  }
  event.preventDefault();
  go();
};

/**
 * Soft-nav link — Waku `Link` when `_tag === "Waku"` (push); else `<a>` + {@link Service.go}.
 */
export const Link = <A extends ApiConstraint = ApiConstraint>(props: {
  readonly to: string | ((urls: Route.UrlBuilder<A>) => string);
  readonly replace?: boolean;
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly title?: string;
  readonly "data-kind"?: string;
  readonly onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  readonly "aria-current"?: React.AriaAttributes["aria-current"];
}): React.ReactElement => {
  const router = useRouter<A>();
  const href =
    typeof props.to === "function"
      ? props.to(router.urls as Route.UrlBuilder<A>)
      : props.to;
  const wakuTo = pathOnly(href) as Parameters<
    ReturnType<typeof useWakuRouter>["push"]
  >[0];

  if (router._tag === "Waku" && props.replace !== true) {
    return (
      <WakuLink
        to={wakuTo}
        className={props.className}
        title={props.title}
        data-kind={props["data-kind"]}
        aria-current={props["aria-current"]}
        onClick={props.onClick}
      >
        {props.children}
      </WakuLink>
    );
  }

  return (
    <a
      href={router._tag === "Waku" ? wakuTo : href}
      className={props.className}
      title={props.title}
      data-kind={props["data-kind"]}
      aria-current={props["aria-current"]}
      onClick={(event) =>
        softNavClick(
          event,
          () => {
            router.go(href, { replace: props.replace });
          },
          props.onClick,
        )
      }
    >
      {props.children}
    </a>
  );
};
