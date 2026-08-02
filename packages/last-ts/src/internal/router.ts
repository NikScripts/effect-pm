/**
 * Internal impl for {@link ../ui/Router}.
 *
 * Core navigation only — catalog match, `go` / `to` / `back`, history/memory.
 * Group drill-down helpers live in {@link ../ui/GroupNav}.
 */
import { Option } from "effect";
import * as Route from "../Route";
import type { ApiConstraint } from "./routes";

// =============================================================================
// Types
// =============================================================================

export type HistoryAction = "push" | "replace";

/** Live navigation API — lite (`Memory` / `History`) or Waku layer. */
export interface Service<A extends ApiConstraint = ApiConstraint> {
  readonly api: A;
  /** Engine discriminant. */
  readonly _tag: "Memory" | "History" | "Waku";
  /** Pathname only (`/docs/x`) — no query. */
  readonly pathname: string;
  /** Search including `?` (`?tab=1`), or `""`. */
  readonly search: string;
  /** `pathname` + `search`. */
  readonly href: string;
  readonly match: Route.Match | undefined;
  readonly urls: Route.UrlBuilder<A>;
  readonly go: (
    href: string,
    options?: { readonly replace?: boolean },
  ) => void;
  readonly to: (
    build: (urls: Route.UrlBuilder<A>) => string,
    options?: { readonly replace?: boolean },
  ) => void;
  /** Pop one history / memory entry (or Waku back). */
  readonly back: () => void;
  /** Navigate to `/` (replace). */
  readonly toRoot: () => void;
  /** Prefetch a path when the engine supports it (no-op on lite). */
  readonly prefetch: (href: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** @internal */
  readonly syncFromLocation: () => void;
}

// =============================================================================
// Path helpers
// =============================================================================

const normalize = (pathname: string): string => {
  if (pathname === "" || pathname === "/") return "/";
  const trimmed =
    pathname.endsWith("/") && pathname.length > 1
      ? pathname.slice(0, -1)
      : pathname;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const parseHref = (
  href: string,
): { readonly pathname: string; readonly search: string } => {
  const q = href.indexOf("?");
  if (q === -1) {
    return { pathname: normalize(href), search: "" };
  }
  return {
    pathname: normalize(href.slice(0, q)),
    search: href.slice(q),
  };
};

const joinHref = (pathname: string, search: string): string =>
  search.length === 0 ? pathname : `${pathname}${search}`;

const locationHref = (): { readonly pathname: string; readonly search: string } =>
  typeof window === "undefined"
    ? { pathname: "/", search: "" }
    : {
        pathname: normalize(window.location.pathname),
        search: window.location.search,
      };

const collapseStack = (stack: Array<string>): void => {
  while (
    stack.length > 1 &&
    stack[stack.length - 1] === stack[stack.length - 2]
  ) {
    stack.pop();
  }
};

// =============================================================================
// Construction
// =============================================================================

export const makeService = <A extends ApiConstraint>(
  api: A,
  engine: "Memory" | "History",
): Service<A> => {
  const urls = Route.urlBuilder(api);
  const initial =
    engine === "History" ? locationHref() : { pathname: "/", search: "" };
  let pathname = initial.pathname;
  let search = initial.search;
  const stack: Array<string> =
    engine === "Memory" ? [joinHref(pathname, search)] : [];
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const l of listeners) l();
  };

  const setHref = (next: string, action: HistoryAction): void => {
    const parsed = parseHref(next);
    if (
      parsed.pathname === pathname &&
      parsed.search === search &&
      action === "push"
    ) {
      return;
    }

    pathname = parsed.pathname;
    search = parsed.search;
    const href = joinHref(pathname, search);

    if (engine === "Memory") {
      if (action === "push") {
        stack.push(href);
      } else {
        if (stack.length === 0) stack.push(href);
        else stack[stack.length - 1] = href;
        collapseStack(stack);
      }
    } else if (typeof window !== "undefined") {
      if (action === "push") window.history.pushState(null, "", href);
      else window.history.replaceState(null, "", href);
    }
    notify();
  };

  return {
    api,
    _tag: engine,
    urls,
    get pathname() {
      return pathname;
    },
    get search() {
      return search;
    },
    get href() {
      return joinHref(pathname, search);
    },
    get match() {
      return Option.getOrUndefined(Route.match(api, pathname));
    },
    go: (next, options) =>
      setHref(next, options?.replace === true ? "replace" : "push"),
    to: (build, options) =>
      setHref(build(urls), options?.replace === true ? "replace" : "push"),
    back: () => {
      if (engine === "History") {
        if (typeof window !== "undefined") window.history.back();
        return;
      }
      if (stack.length <= 1) return;
      stack.pop();
      const prev = parseHref(stack[stack.length - 1] ?? "/");
      pathname = prev.pathname;
      search = prev.search;
      notify();
    },
    toRoot: () => setHref("/", "replace"),
    prefetch: () => {
      /* lite engines have no prefetch */
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    syncFromLocation: () => {
      if (engine !== "History") return;
      const next = locationHref();
      if (next.pathname === pathname && next.search === search) return;
      pathname = next.pathname;
      search = next.search;
      notify();
    },
  };
};
