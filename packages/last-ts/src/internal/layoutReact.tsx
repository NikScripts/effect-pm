/**
 * React Outlet slot + layout / root component runners.
 *
 * @internal
 */
"use client";

import * as React from "react";
import { Effect } from "effect";
import * as Document from "../Document";
import { emptyPartial, finalizeFields } from "./documentCore";
import { useCellOption } from "./documentReact";

const stubFields = (): Document.BaseFields => {
  const complete = finalizeFields({
    ...emptyPartial(),
    title: "",
    lang: "en",
  });
  if (complete === undefined) {
    throw new Error("layoutReact: stubFields finalize failed");
  }
  return complete;
};

const OutletReact = React.createContext<React.ReactNode>(null);

/**
 * Page body slot — `<Layout.Outlet />`.
 *
 * @internal
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

export type BodyRender = Effect.Effect<
  React.ReactNode,
  never,
  Document.Fields | Document.Cell
>;

export type RootRender = Effect.Effect<
  React.ReactNode,
  never,
  Document.Fields | Document.Cell
>;

/** Zero-prop body layout component from an Effect render. @internal */
export const makeBodyComponent = (key: string, render: BodyRender): React.FC => {
  const Component: React.FC = () => {
    const cell = useCellOption();
    const node =
      cell === null
        ? Effect.runSync(
            // SAFE: a no-requirement body effect per the Layout.make contract.
            render as Effect.Effect<React.ReactNode, never, never>,
          )
        : Effect.runSync(
            render.pipe(
              Effect.provideService(Document.Cell, cell),
              Effect.provideService(Document.Fields, cell.get()),
            // SAFE: Override provided just above discharges the body effect's only requirement.
            ) as Effect.Effect<React.ReactNode, never, never>,
          );
    return React.createElement(React.Fragment, null, node);
  };
  Component.displayName = `Layout(${key})`;
  return Component;
};

/**
 * Root layout component — takes host `children` into {@link OutletProvider}.
 *
 * @internal
 */
export const makeRootComponent = (
  key: string,
  render: RootRender,
): React.FC<{ readonly children: React.ReactNode }> => {
  const Component: React.FC<{ readonly children: React.ReactNode }> = (
    props,
  ) => {
    const cell = useCellOption();
    const Head = Document.ReferenceHead;
    const tree =
      cell === null
        ? Effect.runSync(
            render.pipe(
              Effect.provideService(Document.Fields, stubFields()),
              Effect.provideService(Document.Head, Head),
            // SAFE: Fields provided just above discharges the render effect's only requirement.
            ) as Effect.Effect<React.ReactNode, never, never>,
          )
        : Effect.runSync(
            render.pipe(
              Effect.provideService(Document.Cell, cell),
              Effect.provideService(Document.Fields, cell.get()),
              Effect.provideService(Document.Head, Head),
            // SAFE: Fields provided just above discharges the render effect's only requirement.
            ) as Effect.Effect<React.ReactNode, never, never>,
          );
    return React.createElement(OutletProvider, {
      body: props.children,
      children: tree,
    });
  };
  Component.displayName = `RootLayout(${key})`;
  return Component;
};
