/**
 * Router.Outlet — run page handlers under Page.Request / Document bridges.
 *
 * @internal
 */
import * as React from "react";
import { Cause, Effect } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import * as AtomReact from "../AtomReact";
import type * as Route from "../Route";
import { handleOf } from "../Route";
import * as pageContext from "./pageContext";
import * as pageServices from "./pageServices";
import * as routerBuilder from "./routerBuilder";
import type { Match } from "./routes";
import type { Service } from "./router";

const queryFromSearch = (search: string): Record<string, string> => {
  if (search.length === 0) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    out[key] = value;
  }
  return out;
};

const toNode = (
  value: React.ReactNode | React.ComponentType<Record<string, never>>,
  args: Route.HandleArgs,
): React.ReactNode => {
  if (value === null || value === undefined || typeof value === "boolean") {
    return null;
  }
  if (typeof value === "function") {
    return React.createElement(
      value as unknown as React.ComponentType<Route.HandleArgs>,
      args,
    );
  }
  return value;
};

/** Run a page Effect with Request + Document, via the Atom runtime. */
const PageEffectView = (props: {
  readonly effect: Effect.Effect<React.ReactNode, unknown, unknown>;
  readonly request: pageServices.RequestValue;
  readonly document: pageServices.DocumentApi;
  readonly args: Route.HandleArgs;
}): React.ReactElement | null => {
  const runtime = AtomReact.useRuntime();
  const atom = React.useMemo(
    () =>
      runtime.atom(
        props.effect.pipe(
          Effect.provideService(pageServices.Request, props.request),
          Effect.provideService(pageServices.Document, props.document),
        ) as Effect.Effect<
          React.ReactNode | React.ComponentType<Record<string, never>>,
          unknown
        >,
      ),
    // Rematch when the location identity changes.
    [runtime, props.effect, props.request.href],
  );
  const result = AtomReact.useAtomValue(atom);
  if (AsyncResult.isSuccess(result)) {
    const node = toNode(result.value, props.args);
    if (node === null || node === undefined || typeof node === "boolean") {
      return null;
    }
    if (React.isValidElement(node)) return node;
    return React.createElement(React.Fragment, null, node);
  }
  if (AsyncResult.isFailure(result)) {
    throw Cause.squash(result.cause);
  }
  return null;
};

const wrapLayout = (
  layout: React.ComponentType<{ children: React.ReactNode }> | null,
  body: React.ReactNode,
): React.ReactElement | null => {
  if (body === null || body === undefined || typeof body === "boolean") {
    return null;
  }
  const child = React.isValidElement(body)
    ? body
    : React.createElement(React.Fragment, null, body);
  if (layout === null) return child;
  return React.createElement(layout, { children: child });
};

const MatchedBody = (props: {
  readonly router: Service;
  readonly match: Match;
  readonly request: pageServices.RequestValue;
}): React.ReactElement | null => {
  const documentApi = pageContext.useDocumentApi();
  const args: Route.HandleArgs = props.request;
  const bag = props.router._handlers;
  let body: React.ReactNode = null;
  let layout: React.ComponentType<{ children: React.ReactNode }> | null = null;

  if (bag !== undefined) {
    const resolved = routerBuilder.resolveHandler(bag, props.match);
    if (resolved !== null) {
      layout = resolved.layout;
      const h = resolved.handler;
      if (h._tag === "Page") {
        body = React.createElement(h.page, args);
      } else if (h._tag === "PageElement") {
        body = h.element;
      } else {
        body = React.createElement(PageEffectView, {
          effect: h.effect,
          request: props.request,
          document: documentApi,
          args,
        });
      }
    }
  }

  if (body === null) {
    const handler = handleOf(props.match);
    if (handler === undefined) return null;
    body = handler(args);
  }

  return wrapLayout(layout, body);
};

/**
 * Matched-route renderer for {@link ../Router.Outlet}.
 *
 * Layout = component + `children` (no Outlet-as-service).
 *
 * @internal
 */
export const Outlet = (props: {
  readonly router: Service;
}): React.ReactElement | null => {
  const match = props.router.match as Match | undefined;
  if (match === undefined) return null;

  const request: pageServices.RequestValue = {
    params: match.params,
    query: queryFromSearch(props.router.search),
    pathname: match.pathname,
    href: props.router.href,
  };

  return React.createElement(pageContext.RequestProvider, {
    value: request,
    children: React.createElement(pageContext.DocumentRoot, {
      children: React.createElement(MatchedBody, {
        router: props.router,
        match,
        request,
      }),
    }),
  });
};
