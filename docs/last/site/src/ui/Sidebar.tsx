/**
 * Rail kit — sticky nav column (not the page grid).
 */
"use client";

import type * as React from "react";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";
import type * as Route from "last-ts/Route";
import { Link } from "../lib/Link";
import { Catalog, urls } from "../lib/Catalog";

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
  readonly to: Route.ToHref<typeof Catalog>;
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/Sidebar/Item",
  (props) => (
    <li>
      <Link to={props.to}>{props.children}</Link>
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
          <ItemView to={urls.index()}>Home</ItemView>
          <ItemView to={urls.guides_slug("routing")}>Guide · routing</ItemView>
          <ItemView to={urls.guides_slug("view-service")}>
            Guide · view-service
          </ItemView>
          <ItemView to={urls.docs_path("intro/rest")}>Rest · intro/rest</ItemView>
        </GroupView>
        <GroupView title="Site">
          <ItemView to={urls.about()}>About</ItemView>
          <ItemView to={urls.view()}>View.make</ItemView>
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
