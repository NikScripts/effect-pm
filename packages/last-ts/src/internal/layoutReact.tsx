/**
 * React Outlet slot + layout / root component runners.
 *
 * @internal
 */
"use client";

import * as errors from "./errors";
import * as React from "react";
import { Effect } from "effect";
import * as Document from "../Document";
import { emptyPartial, finalizeFields } from "./documentCore";
import { makeCell, useCellOption } from "./documentReact";

const stubFields = (): Document.BaseFields => {
  const complete = finalizeFields({
    ...emptyPartial(),
    title: "",
    lang: "en",
  });
  if (complete === undefined) {
    throw new errors.InvariantViolated({ what: "layoutReact stub fields must finalize" });
  }
  return complete;
};

/** A renderer without a mounted provider still gets a fully working (stub) cell. */
const stubCell = (): Document.DocumentCell =>
  makeCell(stubFields(), Document.ReferenceHead);

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
    // The type system says the render needs Fields | Cell; both branches now really
    // provide them (a stub cell when no provider mounted), so no erasure is needed and
    // a body that reads the Cell cannot die at runtime.
    const active = cell ?? stubCell();
    const node = Effect.runSync(
      render.pipe(
        Effect.provideService(Document.Cell, active),
        Effect.provideService(Document.Fields, active.get()),
      ),
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
    const active = cell ?? stubCell();
    const tree = Effect.runSync(
      render.pipe(
        Effect.provideService(Document.Cell, active),
        Effect.provideService(Document.Fields, active.get()),
        Effect.provideService(Document.Head, Head),
      ),
    );
    return React.createElement(OutletProvider, {
      body: props.children,
      children: tree,
    });
  };
  Component.displayName = `RootLayout(${key})`;
  return Component;
};
