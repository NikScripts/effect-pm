/**
 * Last.link — wrap a component (or bare children) with {@link Router.UnboundLink}.
 * Prefer {@link Router.link}`(YourCatalog)` for app navigation.
 *
 * Props: component props + link-channel props are **intersected** on the result.
 * At runtime, link keys feed the anchor; the rest go to the wrapped component.
 *
 * @internal
 */
import * as React from "react";
import { Context, Layer } from "effect";
import * as Router from "../Router";
import * as linkRender from "./linkRender";
import {
  type ApiConstraint,
  type ToHref,
  type UrlBuilder,
  type UrlBuilderLoose,
  type UrlMethodLoose,
  type UrlQueryOptions,
} from "./routes";
import * as lastContext from "./lastContext";

const pathKeysSym = "~last-ts/pathKeys" as const;

type UrlQuery = NonNullable<UrlQueryOptions["query"]>;

/** Anchor props shared by every linked result. */
export type LinkAnchorProps = {
  readonly children?: React.ReactNode;
  readonly className?: string;
  readonly title?: string;
  readonly replace?: boolean;
  readonly "data-kind"?: string;
  readonly onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  readonly "aria-current"?: React.AriaAttributes["aria-current"];
};

export type LinkOpts<A extends ApiConstraint = ApiConstraint> = {
  readonly to?: true | ((urls: UrlBuilder<A>) => unknown);
  readonly out?: true | string;
};

type AnyComponent = React.ComponentType<any>;

type UrlMethod = UrlMethodLoose & {
  readonly [pathKeysSym]?: ReadonlyArray<string>;
};

const isUrlMethod = (u: unknown): u is UrlMethod => typeof u === "function";

const isGroupBuilder = (u: unknown): u is UrlBuilderLoose =>
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
  // SAFE: loose prop-record read pinned back to the UrlQueryOptions contract.
  const query = props.query as UrlQuery | undefined;
  if (query !== undefined) {
    return method(...pathArgs, { query });
  }
  return method(...pathArgs);
};

type AnchorProps = {
  readonly to?: string | ((urls: UrlBuilderLoose) => string);
  readonly out?: string;
  readonly className?: string;
  readonly title?: string;
  readonly replace?: boolean;
  readonly "data-kind"?: string;
  readonly onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  readonly "aria-current"?: React.AriaAttributes["aria-current"];
  readonly children?: React.ReactNode;
};

const LinkedAnchor = (props: {
  readonly linkProps: AnchorProps;
  readonly layer?: Layer.Layer<unknown, never, never>;
}): React.ReactElement => {
  const router = Router.useRouter();
  return linkRender.useRenderLink(
    props.linkProps,
    // SAFE: loose view of the installed router's typed builder — same runtime record.
    router.urls as UrlBuilderLoose,
    router,
    props.layer,
  );
};

const wrapWithLink = (
  inner: React.ReactNode,
  linkProps: AnchorProps,
  layer?: Layer.Layer<unknown, never, never>,
): React.ReactElement =>
  React.createElement(LinkedAnchor, {
    linkProps: { ...linkProps, children: inner },
    layer,
  });

type Mode =
  | { readonly _tag: "direct"; readonly to: string }
  | { readonly _tag: "directOut"; readonly out: string }
  | {
      readonly _tag: "attrFull";
      readonly allowTo: boolean;
      readonly allowOut: boolean;
    }
  | { readonly _tag: "attrGroup"; readonly group: UrlBuilderLoose }
  | { readonly _tag: "attrRoute"; readonly method: UrlMethod };

const resolveMode = (
  urls: UrlBuilderLoose,
  opts: LinkOpts<any>,
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

/** Keys consumed by the link channel for this mode (not forwarded to the component). */
const linkOwnedKeys = (mode: Mode): ReadonlySet<string> => {
  const keys = new Set<string>([
    "to",
    "out",
    "replace",
    "query",
    "className",
    "title",
    "onClick",
    "data-kind",
    "aria-current",
  ]);
  if (mode._tag === "attrRoute") {
    for (const key of mode.method[pathKeysSym] ?? []) {
      keys.add(key);
    }
  }
  return keys;
};

const splitProps = (
  mode: Mode,
  props: Record<string, unknown>,
  hasComponent: boolean,
): {
  readonly componentProps: Record<string, unknown>;
  readonly linkRest: Record<string, unknown>;
} => {
  const owned = linkOwnedKeys(mode);
  const componentProps: Record<string, unknown> = {};
  const linkRest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "children") {
      if (hasComponent) {
        componentProps.children = value;
      }
      continue;
    }
    if (owned.has(key)) {
      linkRest[key] = value;
    } else {
      componentProps[key] = value;
    }
  }
  return { componentProps, linkRest };
};

const renderLinked = (
  mode: Mode,
  props: Record<string, unknown>,
  body: React.ReactNode,
  layer?: Layer.Layer<unknown, never, never>,
): React.ReactElement => {
  const common = {
    // SAFE (this block): loose prop-record reads pinned back to the LinkOpts contract.
    className: props.className as string | undefined,
    title: props.title as string | undefined,
    replace: props.replace as boolean | undefined,
    // SAFE (these four): loose prop-record reads pinned back to the LinkOpts contract.
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
      return wrapWithLink(body, { ...common, to: mode.to }, layer);
    case "directOut":
      return wrapWithLink(body, { ...common, out: mode.out }, layer);
    case "attrFull": {
      const out = props.out;
      const to = props.to;
      if (mode.allowOut && typeof out === "string") {
        return wrapWithLink(body, { ...common, out }, layer);
      }
      if (mode.allowTo && to !== undefined && to !== null) {
        return wrapWithLink(
          body,
          {
            ...common,
            // SAFE: loose view of the typed `to` — literal hrefs widen to string.
            to: to as string | ((urls: UrlBuilderLoose) => string),
          },
          layer,
        );
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
      // SAFE: mode 'group' is only built from a function `to` (see Mode construction above).
      const href = (to as (g: UrlBuilderLoose) => string)(mode.group);
      return wrapWithLink(body, { ...common, to: href }, layer);
    }
    case "attrRoute": {
      const href = buildHrefFromParams(mode.method, props);
      return wrapWithLink(body, { ...common, to: href }, layer);
    }
  }
};

const isComponent = (u: unknown): u is AnyComponent =>
  typeof u === "function" ||
  (typeof u === "object" &&
    u !== null &&
    // SAFE: inside the guard — `in` probe on a non-null object.
    "$$typeof" in (u as object));

const isContextKey = (u: unknown): u is Context.Key<any, any> =>
  Context.isKey(u) ||
  (typeof u === "function" &&
    u !== null &&
    "key" in u &&
    // SAFE: inside the guard that proves the shape — the typeof check IS the validation.
    typeof (u as { readonly key: unknown }).key === "string");

/** Props for a wrapped component or View/Service render fn. */
export type PropsOfLinked<C> = C extends React.ComponentType<infer P extends object>
  ? P
  : Context.Service.Shape<C> extends (props: infer P extends object) => any ? P
  : Record<never, never>;

type PathKeysOf<M> = M extends {
  readonly "~last-ts/pathKeys": infer K extends readonly string[];
} ? K
  : readonly never[];

type PathParamProps<M> = {
  readonly [K in PathKeysOf<M>[number]]: string;
} & {
  readonly query?: UrlQuery;
};

type GroupToProp<G> = {
  readonly to: (group: G) => string;
};

type AttrFullProps<A extends ApiConstraint> = {
  readonly to?: ToHref<A> | ((urls: UrlBuilder<A>) => ToHref<A>);
  readonly out?: string;
};

/**
 * Extra props from {@link LinkOpts} mode (destination channel only).
 *
 * @internal
 */
export type DestPropsFromOpts<
  A extends ApiConstraint,
  O extends LinkOpts<A>,
> = [O] extends [{ readonly out: string }] ? Record<never, never>
  : [O] extends [{ readonly to: (urls: UrlBuilder<A>) => infer R }] ? (
      [R] extends [string] ? Record<never, never>
        : [R] extends [{ readonly "~last-ts/pathKeys": readonly string[] }]
          ? PathParamProps<R>
        : [R] extends [object] ? GroupToProp<R>
        : AttrFullProps<A>
    )
  : [O] extends [{ readonly to: true }] ? AttrFullProps<A>
  : [O] extends [{ readonly out: true }] ? { readonly out: string }
  : AttrFullProps<A>;

type LinkedProps<
  A extends ApiConstraint,
  O extends LinkOpts<A>,
  C = Record<never, never>,
> = PropsOfLinked<C> & LinkAnchorProps & DestPropsFromOpts<A, O>;

/**
 * @internal
 */
export const link: {
  <A extends ApiConstraint, const O extends LinkOpts<A>>(
    api: A,
    opts: O,
    layer?: Layer.Layer<unknown, never, never>,
  ): (props: LinkedProps<A, O>) => React.ReactElement;
  <A extends ApiConstraint, C, const O extends LinkOpts<A> = LinkOpts<A>>(
    api: A,
    component: C,
    opts?: O,
    layer?: Layer.Layer<unknown, never, never>,
  ): (props: LinkedProps<A, O, C>) => React.ReactElement;
} = ((
  _api: unknown,
  second?: unknown,
  third?: unknown,
  fourth?: unknown,
): AnyComponent => {
  const Component = isComponent(second) ? second : undefined;
  let opts: LinkOpts<any> | undefined;
  let layer: Layer.Layer<unknown, never, never> | undefined;
  // Boolean guards (not inline narrows): keep `third` / `fourth` as `unknown` at the cast
  // sites, so the unknown-channel Layer type from `isLayer`'s predicate never lands in a
  // typed position. SAFE: an overload-checked kit Layer is stored erased; it is only
  // Layer.built into the ambient link context.
  const thirdIsLayer: boolean = Layer.isLayer(third);
  const fourthIsLayer: boolean = Layer.isLayer(fourth);
  if (Component !== undefined) {
    if (thirdIsLayer) {
      opts = undefined;
      // SAFE: guarded by thirdIsLayer above; stored erased (see note).
      layer = third as Layer.Layer<unknown, never, never>;
    } else {
      // SAFE: overload contract — non-layer third is the options bag.
      opts = third as LinkOpts<any> | undefined;
      layer = fourthIsLayer
        // SAFE: guarded by fourthIsLayer above; stored erased (see note).
        ? (fourth as Layer.Layer<unknown, never, never>)
        : undefined;
    }
  } else if (thirdIsLayer) {
    // SAFE: overload contract — with a layer third, second is the options bag.
    opts = second as LinkOpts<any>;
    // SAFE: guarded by thirdIsLayer above; stored erased (see note).
    layer = third as Layer.Layer<unknown, never, never>;
  } else {
    // SAFE: overload contract — remaining arg shape is the options bag.
    opts = second as LinkOpts<any> | undefined;
  }
  const resolvedOpts: LinkOpts<any> = opts ?? { to: true };

  const Linked = (props: Record<string, unknown>): React.ReactElement => {
    const router = Router.useRouter();
    const mode = resolveMode(
      // SAFE: loose view of the installed router's typed builder — same runtime record.
      router.urls as UrlBuilderLoose,
      resolvedOpts,
    );
    const hasComponent = Component !== undefined;
    const { componentProps, linkRest } = splitProps(mode, props, hasComponent);

    let body: React.ReactNode = hasComponent
      ? undefined
      // SAFE: non-component branch — children flow through as plain ReactNode.
      : (props.children as React.ReactNode);

    if (Component !== undefined) {
      const resolved = isContextKey(Component)
        ? Context.get(lastContext.useEffectContext(), Component)
        : Component;
      body = React.createElement(
        // SAFE: isComponent guarded this value; the loose prop record is the render contract.
        resolved as React.ComponentType<Record<string, unknown>>,
        componentProps,
      );
    }

    return renderLinked(
      mode,
      { ...linkRest, ...(hasComponent ? {} : { children: props.children }) },
      body,
      layer,
    );
  };
  Linked.displayName = "Last.link";
  return Linked;
// SAFE: never-erased impl behind the typed link overloads above — they are the contract.
}) as typeof link;
