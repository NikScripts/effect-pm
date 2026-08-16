/**
 * Rail kit — sticky nav column (not the page grid).
 */
"use client";

import type * as React from "react";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";
import type * as Route from "last-ts/Route";
import * as Catalog from "../lib/Catalog";
import * as SoftLink from "../lib/Link";

export class Group extends View.make<Group, {
  readonly title: string;
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/Sidebar/Group",
  (props) => (
    <div className="sidebar-group">
      <h2 className="sidebar-group-title">{props.title}</h2>
      <ul className="sidebar-group-items">{props.children}</ul>
    </div>
  ),
) {}

export class Item extends View.make<Item, {
  readonly to: Route.ToHref<typeof Catalog.Catalog>;
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/Sidebar/Item",
  (props) => (
    <li>
      <SoftLink.Link to={props.to}>{props.children}</SoftLink.Link>
    </li>
  ),
) {}

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/Sidebar/Root",
  (props) => <aside className="sidebar">{props.children}</aside>,
) {}

export class Sidebar extends View.make<Sidebar>()(
  "last-ts/site/Sidebar",
  () => {
    const {
      Root: SideRoot,
      Group: GroupView,
      Item: ItemView,
    } = Last.use(SidebarContext);
    return (
      <SideRoot>
        <GroupView title="Docs">
          <ItemView to={Catalog.urls.index()}>Home</ItemView>
          <ItemView to={Catalog.urls.guides_slug("routing")}>
            Guide · routing
          </ItemView>
          <ItemView to={Catalog.urls.guides_slug("view-service")}>
            Guide · view-service
          </ItemView>
          <ItemView to={Catalog.urls.docs_path("intro/rest")}>
            Rest · intro/rest
          </ItemView>
        </GroupView>
        <GroupView title="Site">
          <ItemView to={Catalog.urls.about()}>About</ItemView>
          <ItemView to={Catalog.urls.view()}>View.make</ItemView>
        </GroupView>
      </SideRoot>
    );
  },
) {}

export class SidebarContext extends Last.context({
  Root,
  Group,
  Item,
  View: Sidebar,
}) {}
