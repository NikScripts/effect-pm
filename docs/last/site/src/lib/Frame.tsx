/**
 * Site frame — `Layout.make` composition + structural HTML wrappers.
 *
 * **HTML ownership:** region markup lives in `ui/*` (`NavBar`, `Sidebar`,
 * `Main`, `Footer`) and {@link Root} / {@link Tree} here — not inline in
 * page handlers. Prefer Layer-shaped composition (`Layout.make`, Document,
 * RootLayout) so DOM work stays on named surfaces that already own HTML.
 */
import { Effect } from "effect";
import type * as React from "react";
import * as Document from "last-ts/Document";
import * as Layout from "last-ts/Layout";
import * as Page from "last-ts/Page";
import * as Footer from "../ui/Footer";
import * as Main from "../ui/Main";
import * as NavBar from "../ui/NavBar";
import * as Sidebar from "../ui/Sidebar";

/**
 * Grid wrapper (sidebar + main). Isolated even if it is a single `div` —
 * markup for `.layout` lives here, not inline in {@link App}.
 */
export const Root = (props: {
  readonly children?: React.ReactNode;
}): React.ReactElement => (
  <div className="layout">{props.children}</div>
);

/**
 * Full site tree around a body (`Layout.Outlet` or host `children`).
 * Single composition SSOT for {@link App} and the temporary host `_layout`.
 */
export const Tree = (props: {
  readonly children?: React.ReactNode;
}): React.ReactElement => (
  <>
    <NavBar.NavBar />
    <Root>
      <Sidebar.Root />
      <Main.Root>{props.children}</Main.Root>
    </Root>
    <Footer.Footer />
  </>
);

/**
 * Product body layout — Hyperlink structure, last.ts modules.
 * Fulfill page groups with `Layout.provide(Frame.App)`.
 */
export class App extends Layout.make()(
  "last-ts/site/Frame",
  Effect.gen(function* () {
    yield* Page.document(
      Document.titleTransform((t: string) =>
        t === "last.ts" ? t : `${t} · last.ts`,
      ),
    );
    return (
      <Tree>
        <Layout.Outlet />
      </Tree>
    );
  }),
) {}
