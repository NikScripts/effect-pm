/**
 * Rail kit — sticky nav column only (not the page grid).
 */
"use client";

import type * as React from "react";
import * as Waku from "last-ts/Waku";
import { urls } from "../lib/site";

export const Group = (props: {
  readonly title: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <div className="sidebar-group">
    <h2 className="sidebar-group-title">{props.title}</h2>
    <ul className="sidebar-group-items">{props.children}</ul>
  </div>
);

export const Item = (props: {
  readonly to: string;
  readonly children: React.ReactNode;
}): React.ReactElement => (
  <li>
    <Waku.Link to={props.to}>{props.children}</Waku.Link>
  </li>
);

/** Rail column — HTML for the aside lives here. */
export const Root = (): React.ReactElement => (
  <aside className="sidebar">
    <Group title="Docs">
      <Item to={urls.index()}>Home</Item>
      <Item to={urls.guides_slug("routing")}>Guide · routing</Item>
      <Item to={urls.guides_slug("view-service")}>Guide · view-service</Item>
      <Item to={urls.docs_path("intro/rest")}>Rest · intro/rest</Item>
    </Group>
    <Group title="Site">
      <Item to={urls.about()}>About</Item>
      <Item to={urls.view()}>View.make</Item>
    </Group>
  </aside>
);
