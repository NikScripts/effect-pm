/**
 * Shared Link fulfill — {@link ../Link.View} + {@link ../Link.To} / {@link ../Link.Out}.
 *
 * @internal
 */
"use client";

import * as React from "react";
import { Context, Effect, Layer } from "effect";
import * as Link from "../Link";
import type { ApiConstraint } from "./routes";
import type * as Route from "../Route";
import type { Service } from "./router";
import { Router as RouterTag } from "./routerTag";
import * as lastContext from "./lastContext";

export type RenderLinkProps<A extends ApiConstraint> = {
  readonly to?: string | ((urls: Route.UrlBuilder<A>) => string);
  readonly out?: string;
  readonly replace?: boolean;
  readonly children?: React.ReactNode;
  readonly className?: string;
  readonly title?: string;
  readonly "data-kind"?: string;
  readonly onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  readonly "aria-current"?: React.AriaAttributes["aria-current"];
};

const modifierClick = (event: React.MouseEvent): boolean =>
  event.defaultPrevented ||
  event.button !== 0 ||
  event.metaKey ||
  event.altKey ||
  event.ctrlKey ||
  event.shiftKey;

/**
 * Merge optional override Layer onto the ambient Effect context.
 *
 * @internal
 */
export const mergeLinkLayer = (
  parent: Context.Context<unknown>,
  layer: Layer.Layer<unknown, never, never> | undefined,
): Context.Context<unknown> => {
  if (layer === undefined) return parent;
  const built = Effect.runSync(Effect.scoped(Layer.build(layer)));
  return Context.merge(parent, built);
};

/**
 * Render a link through {@link ../Link.View} + To/Out handlers.
 *
 * @internal
 */
export const renderLink = <A extends ApiConstraint>(
  props: RenderLinkProps<A>,
  urls: Route.UrlBuilder<A>,
  router: Service,
  effectCtx: Context.Context<unknown>,
): React.ReactElement => {
  const ctx = Context.add(effectCtx, RouterTag, router);
  const Anchor = Context.get(ctx, Link.View);

  if (props.out !== undefined) {
    const href = props.out;
    const out = Context.get(ctx, Link.Out);
    return React.createElement(Anchor, {
      href,
      className: props.className,
      title: props.title,
      "data-kind": props["data-kind"],
      "aria-current": props["aria-current"],
      rel: "noopener noreferrer",
      children: props.children,
      onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
        props.onClick?.(event);
        Effect.runSync(
          out({ href, replace: props.replace, event }).pipe(
            Effect.provideContext(ctx),
          ),
        );
      },
    });
  }

  if (props.to === undefined) {
    throw new Error("Router.link: pass to or out");
  }
  const href =
    typeof props.to === "function" ? props.to(urls) : props.to;
  const to = Context.get(ctx, Link.To);
  return React.createElement(Anchor, {
    href,
    className: props.className,
    title: props.title,
    "data-kind": props["data-kind"],
    "aria-current": props["aria-current"],
    children: props.children,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      props.onClick?.(event);
      if (modifierClick(event)) return;
      event.preventDefault();
      Effect.runSync(
        to({ href, replace: props.replace, event }).pipe(
          Effect.provideContext(ctx),
        ),
      );
    },
  });
};

/**
 * Hook-friendly fulfill for {@link ../Router.link} / UnboundLink / Last.link.
 *
 * @internal
 */
export const useRenderLink = <A extends ApiConstraint>(
  props: RenderLinkProps<A>,
  urls: Route.UrlBuilder<A>,
  router: Service,
  layer?: Layer.Layer<unknown, never, never>,
): React.ReactElement => {
  const fromProvider = React.useContext(lastContext.EffectReactContext);
  const parent: Context.Context<unknown> =
    fromProvider !== null
      ? (fromProvider as Context.Context<unknown>)
      : (Context.empty() as Context.Context<unknown>);
  const effectCtx =
    layer === undefined ? parent : mergeLinkLayer(parent, layer);
  return renderLink(props, urls, router, effectCtx);
};
