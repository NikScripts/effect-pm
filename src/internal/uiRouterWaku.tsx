/**
 * Waku engine for {@link ../ui/Router/waku} — full RSC edition.
 * Same {@link ./uiRouter.Service} contract as {@link ./uiRouter.makeService}.
 */
"use client";

import * as React from "react";
import { Option } from "effect";
import {
  Link as WakuLink,
  useRouter as useWakuRouter,
} from "waku/router/client";
import * as Route from "../ui/Route";
import type { ApiConstraint } from "./uiRoutes";
import type { Service } from "./uiRouter";

// =============================================================================
// Catalog binding (make / waku)
// =============================================================================

export type WakuBinding<A extends ApiConstraint = ApiConstraint> = {
  readonly api: A;
  readonly mode: "waku";
  readonly urls: Route.UrlBuilder<A>;
};

/** Bind a catalog for the Waku engine — same role as lite `Router.make`. */
export const waku = <A extends ApiConstraint>(
  api: A,
  urls: Route.UrlBuilder<A> = Route.urlBuilder(api),
): WakuBinding<A> => ({
  api,
  mode: "waku",
  urls,
});

/**
 * Optional app-wide default binding so `Link` / `useRouter` work without a
 * Provider (docs site chrome). Prefer {@link Provider} when composing apps.
 */
let defaultBinding: WakuBinding | null = null;

export const setDefault = (binding: WakuBinding | null): void => {
  defaultBinding = binding;
};

// =============================================================================
// React — Provider / useRouter / Link / Outlet
// =============================================================================

const CatalogContext = React.createContext<WakuBinding | null>(null);

export const Provider = (props: {
  readonly value: WakuBinding;
  readonly children: React.ReactNode;
}): React.ReactElement =>
  React.createElement(
    CatalogContext.Provider,
    { value: props.value },
    props.children,
  );

const useBinding = (): WakuBinding => {
  const binding = React.useContext(CatalogContext) ?? defaultBinding;
  if (binding === null) {
    throw new Error(
      "Router.waku: provide via Provider or setDefault (hyperlink-ts/ui/Router/waku)",
    );
  }
  return binding;
};

export const useHasRouter = (): boolean =>
  React.useContext(CatalogContext) !== null;

/**
 * Live {@link Service} over Waku — same fields as lite `Router.make`.
 */
export const useRouter = <A extends ApiConstraint = ApiConstraint>(): Service<A> => {
  const binding = useBinding() as WakuBinding<A>;
  const wakuNav = useWakuRouter();
  const pathname = wakuNav.path || "/";
  const search =
    typeof window === "undefined" ? "" : window.location.search;
  const href = search.length === 0 ? pathname : `${pathname}${search}`;
  const match = Option.getOrUndefined(Route.match(binding.api, pathname));

  const go = React.useCallback(
    (next: string, options?: { readonly replace?: boolean }): void => {
      const target = pathOnly(next) as Parameters<typeof wakuNav.push>[0];
      if (options?.replace === true) void wakuNav.replace(target);
      else void wakuNav.push(target);
    },
    [wakuNav],
  );

  const to = React.useCallback(
    (
      build: (urls: Route.UrlBuilder<A>) => string,
      options?: { readonly replace?: boolean },
    ): void => go(build(binding.urls), options),
    [binding.urls, go],
  );

  return {
    api: binding.api,
    mode: "waku",
    pathname,
    search,
    href,
    match,
    urls: binding.urls,
    go,
    to,
    back: () => {
      wakuNav.back();
    },
    toRoot: () => {
      go("/", { replace: true });
    },
    prefetch: (next: string) => {
      wakuNav.prefetch(pathOnly(next) as Parameters<typeof wakuNav.prefetch>[0]);
    },
    subscribe: () => () => {
      /* Waku drives re-renders via useRouter */
    },
    syncFromLocation: () => {
      /* Waku owns location */
    },
  };
};

export const useMatch = (): Route.Match | undefined => useRouter().match;

/** Strip query/hash for Waku `push` / `Link` path union. */
const pathOnly = (href: string): string => {
  const q = href.indexOf("?");
  const h = href.indexOf("#");
  let end = href.length;
  if (q >= 0) end = Math.min(end, q);
  if (h >= 0) end = Math.min(end, h);
  const path = href.slice(0, end);
  return path === "" ? "/" : path;
};

/**
 * Soft-nav link via Waku — same call shape as lite {@link ../ui/Router.Link}.
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
  const binding = useBinding() as WakuBinding<A>;
  const wakuNav = useWakuRouter();
  const href =
    typeof props.to === "function"
      ? props.to(binding.urls)
      : props.to;
  const wakuTo = pathOnly(href) as Parameters<typeof wakuNav.push>[0];

  if (props.replace === true) {
    return (
      <a
        href={wakuTo}
        className={props.className}
        title={props.title}
        data-kind={props["data-kind"]}
        aria-current={props["aria-current"]}
        onClick={(event) => {
          props.onClick?.(event);
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
          void wakuNav.replace(wakuTo);
        }}
      >
        {props.children}
      </a>
    );
  }

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
};

/**
 * Render the matched route’s {@link Route.handle}.
 * Returns `null` when there is no match or no handler (file-route apps often
 * leave handles empty and use Waku page modules instead).
 */
const queryFromSearch = (search: string): Record<string, string> => {
  if (search.length === 0) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    out[key] = value;
  }
  return out;
};

export const Outlet = (): React.ReactElement | null => {
  const router = useRouter();
  const match = router.match;
  const handler = Route.handleOf(match);
  if (match === undefined || handler === undefined) return null;
  const node = handler({
    params: match.params,
    query: queryFromSearch(router.search),
    pathname: match.pathname,
    href: router.href,
  });
  if (node === null || node === undefined || typeof node === "boolean") {
    return null;
  }
  if (React.isValidElement(node)) return node;
  return React.createElement(React.Fragment, null, node);
};
