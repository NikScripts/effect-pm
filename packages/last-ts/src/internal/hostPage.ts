/**
 * Map a {@link ../Page} mint to host `createPage` fields (`render` + component).
 *
 * @internal
 */
import * as React from "react";
import { Effect } from "effect";
import type { RequestOptions } from "./routeRequest";
import * as pageMint from "./pageMint";
import * as View from "../View";

/**
 * Waku `createPage` wants a FunctionComponent; keep FC (not ComponentClass)
 * so weak React props checking still accepts host path props.
 */
type HostComponent = React.FC;

export type HostPageStatic = {
  readonly render: "static";
  readonly component: HostComponent;
};

export type HostPageDynamic = {
  readonly render: "dynamic";
  readonly component: HostComponent;
};

export type HostPage = HostPageStatic | HostPageDynamic;

const toComponent = (body: pageMint.Default): HostComponent => {
  if (React.isValidElement(body)) {
    const Fixed: React.FC = () => body;
    Fixed.displayName = "Page.default(element)";
    return Fixed;
  }
  if (Effect.isEffect(body)) {
    return View.effect(body) as HostComponent;
  }
  const Comp = body;
  const Wrapped: React.FC<Record<string, unknown>> = (props) =>
    React.createElement(Comp, props);
  Wrapped.displayName = "Page.default(component)";
  return Wrapped as HostComponent;
};

/**
 * `createPage({ path, ...fromPage(Home) })` — mode from the mint, body unwrapped.
 *
 * @internal
 */
export const fromPage: {
  <O extends RequestOptions>(
    page: pageMint.AnyPage<O, "static">,
  ): HostPageStatic;
  <O extends RequestOptions>(
    page: pageMint.AnyPage<O, "dynamic">,
  ): HostPageDynamic;
  (page: React.ComponentType): HostPageDynamic;
} = ((
  page: pageMint.AnyPage | React.ComponentType,
): HostPage => {
  if (pageMint.isPage(page)) {
    if (page.mode === "static") {
      return {
        render: "static",
        component: toComponent(page.default),
      };
    }
    return {
      render: "dynamic",
      component: toComponent(page.default),
    };
  }
  const Comp = page;
  const Wrapped: React.FC<Record<string, unknown>> = (props) =>
    React.createElement(Comp, props);
  return {
    render: "dynamic",
    component: Wrapped as HostComponent,
  };
}) as typeof fromPage;
