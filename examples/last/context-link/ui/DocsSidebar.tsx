/**
 * @module examples/last/context-link/ui/DocsSidebar
 *
 * Docs-only leaf + composition — mounted under the docs group kit.
 */
import * as React from "react";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";
import * as DocsCopy from "../lib/DocsCopy";

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/context-link/ui/DocsSidebar/Root",
  (props) => <aside data-docs="sidebar">{props.children}</aside>,
) {}

export class DocsSidebar extends View.make<DocsSidebar>()(
  "hyperlink-ts/examples/last/context-link/ui/DocsSidebar",
  () => {
    const { Root: SideRoot, DocsCopy: copy } = Last.use(DocsSidebarContext);
    return <SideRoot>{copy.sidebarTitle}</SideRoot>;
  },
) {}

export class DocsSidebarContext extends Last.context({
  Root,
  View: DocsSidebar,
  DocsCopy: DocsCopy.DocsCopy,
}) {}
