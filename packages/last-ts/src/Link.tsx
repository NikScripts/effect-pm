/**
 * @module Link
 *
 * Link handlers + clickable View. Destinations stay on {@link ./Router.link} /
 * {@link ./Last.link} (`to` / `out`). These References decide **how** activation
 * runs and **what** renders.
 *
 * ```ts
 * export const Provider = Last.provider(
 *   pipe(
 *     History.layer,
 *     Layer.provide(routes),
 *     Layer.provide(Layer.succeed(Link.To, confirmThenGo)),
 *     Layer.provide(Layer.succeed(Link.Out, openInVirtualWindow)),
 *     Layer.provide(Layer.succeed(Link.View, MyLinkView)),
 *   ),
 * )
 * ```
 *
 * @public
 */
"use client";

import * as React from "react";
import { Context, Effect } from "effect";
import { Router as RouterTag } from "./internal/routerTag";
import * as V from "./View";

// =============================================================================
// Handlers
// =============================================================================

/**
 * Activation request — destination already resolved to a string href.
 *
 * @public
 */
export type Request = {
  readonly href: string;
  readonly replace?: boolean;
  readonly event: React.MouseEvent<HTMLAnchorElement>;
};

/**
 * Navigate / open / confirm / virtual-window / …
 *
 * @public
 */
export type Handler = (
  request: Request,
) => Effect.Effect<void, never, any>;

const defaultTo: Handler = (request) =>
  Effect.gen(function* () {
    const router = yield* RouterTag;
    router.go(request.href, { replace: request.replace });
  });

/** Default `out` — leave the browser on the `<a href>` (no soft-nav). @internal */
const defaultOut: Handler = (_request) => Effect.void;

/**
 * In-app soft-nav handler (default: live {@link ./Router.Router}`go`).
 *
 * @public
 */
export const To: Context.Reference<Handler> = Context.Reference(
  "last-ts/Link/To",
  { defaultValue: () => defaultTo },
);

/**
 * External / free-form handler (default: follow the anchor).
 *
 * @public
 */
export const Out: Context.Reference<Handler> = Context.Reference(
  "last-ts/Link/Out",
  { defaultValue: () => defaultOut },
);

// =============================================================================
// View (clickable control)
// =============================================================================

/**
 * Props for {@link View} — href + anchor chrome. Navigation policy is {@link To} /
 * {@link Out}, not this component.
 *
 * @public
 */
export type ViewProps = {
  readonly href: string;
  readonly children?: React.ReactNode;
  readonly className?: string;
  readonly title?: string;
  readonly "data-kind"?: string;
  readonly onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  readonly "aria-current"?: React.AriaAttributes["aria-current"];
  readonly rel?: string;
  readonly target?: string;
};

/**
 * Link chrome — default `<a href>`. Swap via Layer / `Last.link(…, layer)`.
 *
 * @public
 */
export class View extends V.make<View, ViewProps>()(
  "last-ts/Link/View",
  (props) =>
    React.createElement(
      "a",
      {
        href: props.href,
        className: props.className,
        title: props.title,
        "data-kind": props["data-kind"],
        "aria-current": props["aria-current"],
        rel: props.rel,
        target: props.target,
        onClick: props.onClick,
      },
      props.children,
    ),
) {}
