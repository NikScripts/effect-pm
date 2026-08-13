/**
 * @module examples/last/router-context/ui/Frame
 *
 * Page frame leaves + composition. `Main` hosts {@link Layout.Outlet}.
 */
import * as React from "react";
import * as Last from "last-ts/Last";
import * as Layout from "last-ts/Layout";
import * as View from "last-ts/View";

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/router-context/ui/Frame/Root",
  (props) => <div data-frame="root">{props.children}</div>,
) {}

export class Main extends View.make<Main, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/router-context/ui/Frame/Main",
  (props) => <main data-frame="main">{props.children}</main>,
) {}

/** Composition — zero DOM tags; places leaf Views + Outlet. */
export class Frame extends View.make<Frame>()(
  "hyperlink-ts/examples/last/router-context/ui/Frame",
  () => {
    const { Root: FrameRoot, Main: FrameMain } = Last.use(FrameContext);
    return (
      <FrameRoot>
        <FrameMain>
          <Layout.Outlet />
        </FrameMain>
      </FrameRoot>
    );
  },
) {}

export class FrameContext extends Last.context({
  Root,
  Main,
  View: Frame,
}) {}
