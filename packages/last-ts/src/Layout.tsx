/**
 * @module Layout
 *
 * Router layouts — {@link Outlet} (component) + {@link Root} Reference mint.
 * Document chrome: `last-ts/Document` / `docs/handoffs/page-document-lock.md`.
 *
 * @public
 */
"use client";

import * as React from "react";
import { Context, Effect, Layer } from "effect";
import * as Document from "./Document";

/**
 * Props required of every router group layout (body chrome).
 *
 * @public
 */
export type LayoutProps = {
  readonly children: React.ReactNode;
};

/**
 * Layout component — `children` is mandatory.
 *
 * @public
 */
export type Layout = React.ComponentType<LayoutProps>;

const OutletReact = React.createContext<React.ReactNode>(null);

/**
 * Page body slot — `<Layout.Outlet />`, not a yielded value.
 *
 * @public
 */
export const Outlet: React.FC = () => {
  const body = React.useContext(OutletReact);
  return React.createElement(React.Fragment, null, body);
};
Outlet.displayName = "Layout.Outlet";

/** @internal */
export const OutletProvider = (props: {
  readonly children: React.ReactNode;
  readonly body: React.ReactNode;
}): React.ReactElement =>
  React.createElement(OutletReact.Provider, {
    value: props.body,
    children: props.children,
  });

export type RootRender = Effect.Effect<
  React.ReactNode,
  never,
  Context.Reference<React.FC> | Document.Cell
>;

export type AnyRoot = {
  readonly key: string;
  readonly render: RootRender;
  readonly Component: React.FC<{ readonly children: React.ReactNode }>;
  readonly layer: Layer.Layer<never>;
};

const RootTypeId = "~last-ts/Layout/Root" as const;

/**
 * Namespace for root layout mint + Reference (swap via Layers).
 *
 * @public
 */
export namespace Root {
  /**
   * Mint a root layout — owns `<html>`; uses {@link Document.Head} + {@link Outlet}.
   *
   * @example
   * ```ts
   * export class SiteRoot extends Layout.Root.make()(
   *   "app/layout/root",
   *   Effect.fn(function* () {
   *     const Head = yield* Document.Head
   *     return (
   *       <html>
   *         <head><Head /></head>
   *         <body><Layout.Outlet /></body>
   *       </html>
   *     )
   *   }),
   * ) {}
   * ```
   *
   * @public
   */
  export const make =
    () =>
    (
      key: string,
      render: RootRender,
    ): (abstract new (_: never) => {}) & AnyRoot => {
      const Component: React.FC<{ readonly children: React.ReactNode }> = (
        props,
      ) => {
        const Head = Effect.runSync(
          Effect.succeed(Document.ReferenceHead),
        );
        const tree = Effect.runSync(
          render.pipe(
            Effect.provideService(Document.Head, Head),
          ) as Effect.Effect<React.ReactNode, never, never>,
        );
        return React.createElement(OutletProvider, {
          body: props.children,
          children: tree,
        });
      };
      Component.displayName = `Layout.Root(${key})`;

      const Cls = class {
        static readonly [RootTypeId] = RootTypeId;
        static readonly key = key;
        static readonly render = render;
        static readonly Component = Component;
        static readonly layer = Layer.empty;
      };
      return Cls as unknown as (abstract new (_: never) => {}) & AnyRoot;
    };

  /**
   * Active root layout Reference (package default wraps Document.Head).
   *
   * @public
   */
  export const Tag: Context.Reference<
    React.FC<{ readonly children: React.ReactNode }>
  > = Context.Reference("last-ts/Layout/Root", {
    defaultValue: () => DefaultRoot.Component,
  });
}

/** Package default root — html + Document.Head + Outlet. @public */
export class DefaultRoot extends Root.make()(
  "last-ts/Layout/default-root",
  Effect.gen(function* () {
    const Head = yield* Document.Head;
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          />
          <Head />
        </head>
        <body>
          <Outlet />
        </body>
      </html>
    );
  }),
) {}
