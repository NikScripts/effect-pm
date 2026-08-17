/**
 * Map a {@link ../Page} mint to host `createPage` fields (`render` + component).
 *
 * Host (Waku) props are flat (`{ slug, path, query }`). Soft-nav / Page props are
 * nested (`{ params, query, pathname, href }`). `fromPage` adapts at the boundary.
 *
 * @internal
 */
import * as React from "react";
import { Effect } from "effect";
import type { RequestOptions } from "./routeRequest";
import * as pageMint from "./pageMint";
import type * as Route from "../Route";

/**
 * Waku `createPage` wants a FunctionComponent; keep FC (not ComponentClass)
 * so weak React props checking still accepts host path props.
 */
// Waku hands hosts flat route props (path, slug parts, query) — the wrapper adapts them.
type HostComponent = React.FC<Record<string, unknown>>;

export type HostPageStatic = {
  readonly render: "static";
  readonly component: HostComponent;
  readonly path?: string;
};

export type HostPageDynamic = {
  readonly render: "dynamic";
  readonly component: HostComponent;
  readonly path?: string;
};

export type HostPage = HostPageStatic | HostPageDynamic;

type ParamDecl = {
  readonly name: string;
  readonly splat: boolean;
};

/** `[slug]` / `[...path]` decls from a file path (`/guides/[slug]`). */
export const paramDeclsFromFilePath = (filePath: string): ReadonlyArray<ParamDecl> => {
  const out: Array<ParamDecl> = [];
  for (const part of filePath.split("/")) {
    const wild = /^\[\.\.\.(\w+)\]$/.exec(part);
    if (wild !== null) {
      out.push({ name: wild[1]!, splat: true });
      continue;
    }
    const slug = /^\[(\w+)\]$/.exec(part);
    if (slug !== null) {
      out.push({ name: slug[1]!, splat: false });
    }
  }
  return out;
};

const queryFromSearch = (search: string): Record<string, string> => {
  if (search.length === 0) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    out[key] = value;
  }
  return out;
};

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((x) => typeof x === "string");

const literalPrefix = (filePath: string): string => {
  const cut = filePath.replace(/\/\[(?:\.\.\.)?\w+\](?:\/\[(?:\.\.\.)?\w+\])*$/, "");
  return cut.length === 0 ? "" : cut;
};

const fillPathname = (
  filePath: string,
  params: Record<string, string>,
): string => {
  const filled = filePath
    .replace(/\[\.\.\.(\w+)\]/g, (_, key: string) => params[key] ?? "")
    .replace(/\[(\w+)\]/g, (_, key: string) => params[key] ?? "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
  return filled.length === 0 ? "/" : filled;
};

/**
 * Waku createPage props → soft-nav {@link ../Route.HandleArgs}.
 *
 * @internal
 */
export const hostPropsToHandleArgs = (
  host: Record<string, unknown>,
  filePath?: string,
): Route.HandleArgs => {
  const queryRaw = typeof host.query === "string" ? host.query : "";
  const queryStr = queryRaw.startsWith("?") ? queryRaw.slice(1) : queryRaw;
  const query = queryFromSearch(queryStr);
  const params: Record<string, string> = {};
  const decls = filePath !== undefined ? paramDeclsFromFilePath(filePath) : null;

  let pathname =
    typeof host.path === "string" && host.path.startsWith("/")
      ? host.path
      : undefined;

  if (decls !== null && decls.length > 0) {
    const prefix = literalPrefix(filePath!);
    for (const { name, splat } of decls) {
      const value = host[name];
      if (isStringArray(value)) {
        params[name] = value.join("/");
        continue;
      }
      if (typeof value !== "string") continue;
      // Dynamic Waku sets `path` last to the route pathname, shadowing a
      // splat param also named `path`. Strip the literal prefix.
      if (
        splat &&
        name === "path" &&
        value.startsWith("/") &&
        typeof host.path === "string"
      ) {
        if (prefix.length > 0 && value.startsWith(`${prefix}/`)) {
          params[name] = value.slice(prefix.length + 1);
        } else if (prefix.length > 0 && value === prefix) {
          params[name] = "";
        } else {
          params[name] = value.replace(/^\//, "");
        }
        pathname = value;
        continue;
      }
      if (name === "path" && value.startsWith("/")) {
        pathname = value;
        continue;
      }
      params[name] = value;
    }
    if (pathname === undefined) {
      pathname = fillPathname(filePath!, params);
    }
  } else {
    for (const [key, value] of Object.entries(host)) {
      if (key === "query" || key === "hash") continue;
      if (key === "path") {
        if (isStringArray(value)) {
          params.path = value.join("/");
        } else if (typeof value === "string" && !value.startsWith("/")) {
          params.path = value;
        }
        continue;
      }
      if (typeof value === "string") {
        params[key] = value;
      } else if (isStringArray(value)) {
        params[key] = value.join("/");
      }
    }
    if (pathname === undefined) {
      pathname = "/";
    }
  }

  const href = queryStr.length > 0 ? `${pathname}?${queryStr}` : pathname;
  return { pathname, href, params, query };
};

const toComponent = (
  body: pageMint.Default,
  filePath?: string,
): HostComponent => {
  if (React.isValidElement(body)) {
    const Fixed: React.FC = () => body;
    Fixed.displayName = "Page.default(element)";
    return Fixed;
  }
  // Boolean guard (not an inline narrow) keeps `body` un-narrowed, so the any-channel
  // Effect type from `isEffect`'s predicate never lands in a typed position.
  const bodyIsEffect: boolean = Effect.isEffect(body);
  if (bodyIsEffect) {
    // RSC host: run the Effect once per request. Do **not** import View /
    // AtomReact here — those are client-only (`createContext`) and break RSC.
    // Soft-nav Outlet still uses View.effect / Atom for live Effect pages.
    // SAFE: a Page mint's Effect body is contracted upstream to ReactNode success with no
    // requirements (host pages are self-contained); channels are unobservable at runtime.
    const program = body as Effect.Effect<React.ReactNode>;
    // Plain Promise-returning fn (not `async`) — this is the React Server Component
    // boundary; React awaits the returned Promise itself.
    const EffectPage = (): Promise<React.ReactNode> =>
      Effect.runPromise(program).then((node) =>
        node === null || node === undefined || typeof node === "boolean"
          ? null
          : node,
      );
    EffectPage.displayName = "Page.default(effect)";
    // SAFE: an RSC page is a zero-prop Promise component — HostComponent widens props.
    return EffectPage as HostComponent;
  }
  // SAFE: non-element, non-effect body is a component per pageMint.Default.
  const Comp = body as React.ComponentType<Route.HandleArgs>;
  const Wrapped: React.FC<Record<string, unknown>> = (props) =>
    React.createElement(Comp, hostPropsToHandleArgs(props, filePath));
  Wrapped.displayName = "Page.default(component)";
  // SAFE: the wrapper takes the flat host prop record HostComponent declares.
  return Wrapped as HostComponent;
};

/**
 * `createPage({ ...fromPage("/guides/[slug]", Home) })` — path + mode + adapted body.
 *
 * Overload without path keeps prior spread style:
 * `createPage({ path: "/", ...fromPage(Home) })`.
 *
 * @internal
 */
export const fromPage: {
  <const P extends string, O extends RequestOptions>(
    path: P,
    page: pageMint.AnyPage<O, "static">,
  ): { readonly path: P; readonly render: "static"; readonly component: HostComponent };
  <const P extends string, O extends RequestOptions>(
    path: P,
    page: pageMint.AnyPage<O, "dynamic">,
  ): { readonly path: P; readonly render: "dynamic"; readonly component: HostComponent };
  <const P extends string>(
    path: P,
    page: React.ComponentType,
  ): { readonly path: P; readonly render: "dynamic"; readonly component: HostComponent };
  <O extends RequestOptions>(
    page: pageMint.AnyPage<O, "static">,
  ): HostPageStatic;
  <O extends RequestOptions>(
    page: pageMint.AnyPage<O, "dynamic">,
  ): HostPageDynamic;
  (page: React.ComponentType): HostPageDynamic;
} = ((
  pathOrPage: string | pageMint.AnyPage | React.ComponentType,
  maybePage?: pageMint.AnyPage | React.ComponentType,
): HostPage => {
  const filePath = typeof pathOrPage === "string" ? pathOrPage : undefined;
  const page = (
    typeof pathOrPage === "string" ? maybePage! : pathOrPage
  // SAFE: two-arg overload — args[1] is the page/component per the contract above.
  ) as pageMint.AnyPage | React.ComponentType;

  if (pageMint.isPage(page)) {
    if (page.mode === "static") {
      return {
        ...(filePath !== undefined ? { path: filePath } : {}),
        render: "static" as const,
        component: toComponent(page.default, filePath),
      };
    }
    return {
      ...(filePath !== undefined ? { path: filePath } : {}),
      render: "dynamic" as const,
      component: toComponent(page.default, filePath),
    };
  }
  // SAFE: non-mint, non-element, non-effect default is a component per pageMint.Default.
  const Comp = page as React.ComponentType<Route.HandleArgs>;
  const Wrapped: React.FC<Record<string, unknown>> = (props) =>
    React.createElement(Comp, hostPropsToHandleArgs(props, filePath));
  return {
    ...(filePath !== undefined ? { path: filePath } : {}),
    render: "dynamic" as const,
    // SAFE: the wrapper takes the flat host prop record HostComponent declares.
    component: Wrapped as HostComponent,
  };
// SAFE: never-erased impl behind the typed fromPage overloads above.
}) as typeof fromPage;
