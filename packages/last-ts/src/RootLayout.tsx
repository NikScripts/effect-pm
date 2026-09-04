/**
 * @module RootLayout
 *
 * Document root — owns `<html>`, applies `Document.Fields` (e.g. `lang`),
 * renders `Document.Head` + `<Layout.Outlet />`.
 * SSOT: `docs/handoffs/page-layout-lock.md`.
 *
 * @public
 */
"use client";

import * as React from "react";
import { Context, Effect } from "effect";
import * as Document from "./Document";
import * as Layout from "./Layout";
import * as layoutReact from "./internal/layoutReact";

export type RootRender = layoutReact.RootRender;

const RootLayoutTypeId = "~last-ts/RootLayout" as const;

/** The minted root-layout class: abstract-constructable, branded, and a Reference. @public */
export type Handle = (abstract new (_: never) => Record<never, never>) &
  AnyRootLayout &
  Context.Reference<React.FC<{ readonly children: React.ReactNode }>>;

/**
 * Minted root layout — Component takes host `children` into the outlet slot.
 *
 * @public
 */
export type AnyRootLayout = {
  readonly [RootLayoutTypeId]: typeof RootLayoutTypeId;
  readonly key: string;
  readonly render: RootRender;
  readonly Component: React.FC<{ readonly children: React.ReactNode }>;
};

/**
 * Mint a root layout.
 *
 * @example
 * ```ts
 * export class SiteRoot extends RootLayout.make()(
 *   "app/layout/root",
 *   Effect.fn(function* () {
 *     const Head = yield* Document.Head
 *     const { lang } = yield* Document.Fields
 *     return (
 *       <html lang={lang ?? "en"}>
 *         <head>
 *           <meta charSet="utf-8" />
 *           <Head />
 *         </head>
 *         <body>
 *           <Layout.Outlet />
 *         </body>
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
  ): Handle => {
    const Component = layoutReact.makeRootComponent(key, render);
    const reference = Context.Reference(key, {
      defaultValue: () => Component,
    });
    const Cls = class {
      static readonly [RootLayoutTypeId] = RootLayoutTypeId;
      static readonly key = key;
      static readonly render = render;
      static readonly Component = Component;
    };
    return Object.assign(Cls, reference);
  };

/**
 * Active root layout Reference (package default).
 *
 * @public
 */
export const Tag: Context.Reference<
  React.FC<{ readonly children: React.ReactNode }>
> = Context.Reference("last-ts/RootLayout", {
  defaultValue: () => Default.Component,
});

/**
 * Package default root — html + `Document.Fields.lang` + Head + Outlet.
 *
 * @public
 */
export class Default extends make()(
  "last-ts/RootLayout/default",
  Effect.gen(function* () {
    const Head = yield* Document.Head;
    const { lang } = yield* Document.Fields;
    return (
      <html lang={lang ?? "en"}>
        <head>
          <meta charSet="utf-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          />
          <Head />
        </head>
        <body>
          <Layout.Outlet />
        </body>
      </html>
    );
  }),
) {}
