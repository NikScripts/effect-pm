/**
 * Last.link — wrap a component (or bare children) with Router.Link.
 *
 * @internal
 */
import * as React from "react";
import * as Router from "../Router";
import type * as Route from "../Route";

const pathKeysSym = "~last-ts/pathKeys" as const;

type UrlQuery = {
  readonly [key: string]: string | undefined;
};

type LinkCommon = {
  readonly children?: React.ReactNode;
  readonly className?: string;
  readonly title?: string;
  readonly replace?: boolean;
  readonly "data-kind"?: string;
  readonly onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  readonly "aria-current"?: React.AriaAttributes["aria-current"];
};

export type LinkOpts = {
  readonly to?: true | ((urls: Route.UrlBuilderLoose) => unknown);
  readonly out?: true | string;
};

type AnyComponent = React.ComponentType<any>;

type UrlMethod = ((...args: Array<any>) => string) & {
  readonly [pathKeysSym]?: ReadonlyArray<string>;
};

const isUrlMethod = (u: unknown): u is UrlMethod => typeof u === "function";

const isGroupBuilder = (u: unknown): u is Route.UrlBuilderLoose =>
  typeof u === "object" && u !== null && !Array.isArray(u);

const buildHrefFromParams = (
  method: UrlMethod,
  props: Record<string, unknown>,
): string => {
  const keys = method[pathKeysSym] ?? [];
  const pathArgs = keys.map((key) => {
    const value = props[key];
    if (typeof value !== "string") {
      throw new Error(`Last.link: missing path param "${key}"`);
    }
    return value;
  });
  const query = props.query as UrlQuery | undefined;
  if (query !== undefined) {
    return method(...pathArgs, { query });
  }
  return method(...pathArgs);
};

const BaseLink = Router.Link as React.FC<Record<string, unknown>>;

const wrapWithLink = (
  inner: React.ReactNode,
  linkProps: {
    readonly to?: string | ((urls: Route.UrlBuilderLoose) => string);
    readonly out?: string;
    readonly className?: string;
    readonly title?: string;
    readonly replace?: boolean;
    readonly "data-kind"?: string;
    readonly onClick?: React.MouseEventHandler<HTMLAnchorElement>;
    readonly "aria-current"?: React.AriaAttributes["aria-current"];
  },
): React.ReactElement =>
  React.createElement(BaseLink, { ...linkProps, children: inner });

type Mode =
  | { readonly _tag: "direct"; readonly to: string }
  | { readonly _tag: "directOut"; readonly out: string }
  | {
      readonly _tag: "attrFull";
      readonly allowTo: boolean;
      readonly allowOut: boolean;
    }
  | { readonly _tag: "attrGroup"; readonly group: Route.UrlBuilderLoose }
  | { readonly _tag: "attrRoute"; readonly method: UrlMethod };

const resolveMode = (
  urls: Route.UrlBuilderLoose,
  opts: LinkOpts,
): Mode => {
  if (typeof opts.out === "string") {
    return { _tag: "directOut", out: opts.out };
  }
  if (opts.to === true) {
    return {
      _tag: "attrFull",
      allowTo: true,
      allowOut: opts.out === true,
    };
  }
  if (opts.to === undefined && opts.out === true) {
    return { _tag: "attrFull", allowTo: false, allowOut: true };
  }
  if (typeof opts.to === "function") {
    const selected = opts.to(urls);
    if (typeof selected === "string") {
      return { _tag: "direct", to: selected };
    }
    if (isUrlMethod(selected)) {
      return { _tag: "attrRoute", method: selected };
    }
    if (isGroupBuilder(selected)) {
      return { _tag: "attrGroup", group: selected };
    }
  }
  return {
    _tag: "attrFull",
    allowTo: true,
    allowOut: opts.out === true,
  };
};

const renderLinked = (
  mode: Mode,
  props: Record<string, unknown>,
  body: React.ReactNode,
): React.ReactElement => {
  const common = {
    className: props.className as string | undefined,
    title: props.title as string | undefined,
    replace: props.replace as boolean | undefined,
    "data-kind": props["data-kind"] as string | undefined,
    onClick: props.onClick as
      | React.MouseEventHandler<HTMLAnchorElement>
      | undefined,
    "aria-current": props["aria-current"] as
      | React.AriaAttributes["aria-current"]
      | undefined,
  };

  switch (mode._tag) {
    case "direct":
      return wrapWithLink(body, { ...common, to: mode.to });
    case "directOut":
      return wrapWithLink(body, { ...common, out: mode.out });
    case "attrFull": {
      const out = props.out;
      const to = props.to;
      if (mode.allowOut && typeof out === "string") {
        return wrapWithLink(body, { ...common, out });
      }
      if (mode.allowTo && to !== undefined && to !== null) {
        return wrapWithLink(body, {
          ...common,
          to: to as string | ((urls: Route.UrlBuilderLoose) => string),
        });
      }
      throw new Error("Last.link: pass to or out");
    }
    case "attrGroup": {
      const to = props.to;
      if (typeof to !== "function") {
        throw new Error(
          "Last.link: group-narrowed link expects to={(group) => …}",
        );
      }
      const href = (to as (g: Route.UrlBuilderLoose) => string)(mode.group);
      return wrapWithLink(body, { ...common, to: href });
    }
    case "attrRoute": {
      const href = buildHrefFromParams(mode.method, props);
      return wrapWithLink(body, { ...common, to: href });
    }
  }
};

const isComponent = (u: unknown): u is AnyComponent =>
  typeof u === "function" ||
  (typeof u === "object" &&
    u !== null &&
    "$$typeof" in (u as object));

/**
 * @internal
 */
export const link = ((
  _api: unknown,
  second?: unknown,
  third?: unknown,
): AnyComponent => {
  const Component = isComponent(second) ? second : undefined;
  const opts = (
    Component !== undefined ? third : second
  ) as LinkOpts | undefined;
  const resolvedOpts: LinkOpts = opts ?? { to: true };

  const Linked = (props: Record<string, unknown>): React.ReactElement => {
    const router = Router.useRouter();
    const mode = resolveMode(
      router.urls as Route.UrlBuilderLoose,
      resolvedOpts,
    );
    const body =
      Component !== undefined
        ? React.createElement(Component, props)
        : (props.children as React.ReactNode);
    return renderLinked(mode, props, body);
  };
  Linked.displayName = "Last.link";
  return Linked;
}) as {
  <A>(
    api: A,
    opts: LinkOpts,
  ): React.FC<LinkCommon & Record<string, unknown>>;
  <A, P extends object>(
    api: A,
    component: React.ComponentType<P>,
    opts?: LinkOpts,
  ): React.FC<P & LinkCommon & Record<string, unknown>>;
};
