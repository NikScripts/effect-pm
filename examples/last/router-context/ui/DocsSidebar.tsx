/**
 * @module examples/last/router-context/ui/DocsSidebar
 *
 * Docs-only region — mounted when the docs group context is active.
 */
import * as React from "react";
import * as Last from "last-ts/Last";
import * as Router from "last-ts/Router";
import * as View from "last-ts/View";
import * as DocsCopy from "../lib/DocsCopy";

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/router-context/ui/DocsSidebar/Root",
  (props) => <aside data-docs="sidebar">{props.children}</aside>,
) {}

export class Title extends View.make<Title, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/router-context/ui/DocsSidebar/Title",
  (props) => <p data-docs="title">{props.children}</p>,
) {}

export class Item extends View.make<Item, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/router-context/ui/DocsSidebar/Item",
  (props) => <span data-docs="item">{props.children}</span>,
) {}

export class DocsSidebar extends View.make<DocsSidebar>()(
  "hyperlink-ts/examples/last/router-context/ui/DocsSidebar",
  () => {
    const {
      Root: SideRoot,
      Title: SideTitle,
      Item: ItemView,
      DocsCopy: copy,
    } = Last.use(DocsSidebarContext);
    return (
      <SideRoot>
        <SideTitle>{copy.sidebarTitle}</SideTitle>
        <Router.Link to="/docs/routing">
          <ItemView>Routing</ItemView>
        </Router.Link>
      </SideRoot>
    );
  },
) {}

export class DocsSidebarContext extends Last.context({
  Root,
  Title,
  Item,
  View: DocsSidebar,
  DocsCopy: DocsCopy.DocsCopy,
}) {}
