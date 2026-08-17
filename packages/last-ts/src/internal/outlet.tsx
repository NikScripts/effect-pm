/**
 * Router.Outlet — run page handlers under Page.Request / Document bridges.
 *
 * @internal
 */
import * as React from "react";
import { Cause, Effect } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import * as AtomReact from "../AtomReact";
import * as Layout from "../Layout";
import type * as Route from "../Route";
import { handleOf } from "../Route";
import * as lastContext from "./lastContext";
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

/** Run a page Effect with Request + layout Override, via Atom. */
const PageEffectView = (props: {
  readonly effect: Effect.Effect<React.ReactNode>;
  readonly request: pageServices.RequestValue;
  readonly args: Route.HandleArgs;
  readonly override: Layout.OverrideCell;
  readonly onOverride: () => void;
}): React.ReactElement | null => {
  const runtime = AtomReact.useRuntime();
  const atom = React.useMemo(
    () =>
      runtime.atom(
        props.effect.pipe(
          Effect.provideService(pageServices.Request, props.request),
          Effect.provideService(Layout.Override, {
            get: props.override.get,
            set: (layout) => {
              props.override.set(layout);
              props.onOverride();
            },
          }),
        ) as Effect.Effect<
          React.ReactNode | React.ComponentType<Record<string, never>>
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
  layout: React.FC,
  body: React.ReactNode,
): React.ReactElement | null => {
  if (body === null || body === undefined || typeof body === "boolean") {
    return null;
  }
  const child = React.isValidElement(body)
    ? body
    : React.createElement(React.Fragment, null, body);
  return React.createElement(Layout.OutletProvider, {
    body: child,
    children: React.createElement(layout),
  });
};

const MatchedBody = (props: {
  readonly router: Service;
  readonly match: Match;
  readonly request: pageServices.RequestValue;
}): React.ReactElement | null => {
  const args: Route.HandleArgs = props.request;
  const bag = props.router._handlers;
  let body: React.ReactNode = null;
  let groupLayout: React.FC = Layout.Passthrough.Component;

  if (bag !== undefined) {
    const resolved = routerBuilder.resolveHandler(bag, props.match);
    if (resolved !== null) {
      groupLayout = resolved.layout;
      const h = resolved.handler;
      if (h._tag === "Page") {
        body = React.createElement(h.page, args);
      } else if (h._tag === "PageElement") {
        body = h.element;
      } else {
        body = React.createElement(PageEffectWithLayout, {
          effect: h.effect,
          request: props.request,
          args,
          groupLayout,
        });
        return body as React.ReactElement;
      }
    }
  }

  if (body === null) {
    const handler = handleOf(props.match);
    if (handler === undefined) return null;
    body = handler(args);
  }

  return wrapLayout(groupLayout, body);
};

/** PageEffect + live layout override via {@link Layout.provide}. */
const PageEffectWithLayout = (props: {
  readonly effect: Effect.Effect<React.ReactNode>;
  readonly request: pageServices.RequestValue;
  readonly args: Route.HandleArgs;
  readonly groupLayout: React.FC;
}): React.ReactElement | null => {
  const override = React.useMemo((): Layout.OverrideCell => {
    let current = props.groupLayout;
    return {
      get: () => current,
      set: (layout) => {
        current = layout;
      },
    };
  }, [props.groupLayout]);
  const [layout, setLayout] = React.useState(() => props.groupLayout);
  React.useEffect(() => {
    setLayout(props.groupLayout);
  }, [props.groupLayout]);

  const body = React.createElement(PageEffectView, {
    effect: props.effect,
    request: props.request,
    args: props.args,
    override,
    onOverride: () => setLayout(override.get()),
  });
  return wrapLayout(layout, body);
};

/**
 * Matched-route renderer for {@link ../Router.Outlet}.
 *
 * Layout = zero-prop component + {@link Layout.Outlet}.
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

  const scopes = lastContext.activeContextScopes(props.router.api, match);
  const body = React.createElement(MatchedBody, {
    router: props.router,
    match,
    request,
  });

  return React.createElement(pageContext.RequestProvider, {
    value: request,
    children: React.createElement(pageContext.DocumentRoot, {
      children: lastContext.wrapActiveContextScopes(scopes, body),
    }),
  });
};
