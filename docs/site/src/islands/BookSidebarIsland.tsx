"use client";

/**
 * Desktop book sidebar — View.Service default slot; standards book swaps chrome.
 */
import * as React from "react";
import type { NavGroup } from "../lib/docs-content.js";
import * as Router from "../ui/Router.js";
import { MainBook, StandardsBook } from "../ui/bookChrome.js";

export function BookSidebarIsland(props: {
  readonly main: ReadonlyArray<NavGroup>;
  readonly standards: ReadonlyArray<NavGroup>;
  readonly standardsHrefs: ReadonlyArray<string>;
}): React.ReactElement {
  const { pathname } = Router.useRouter();
  const inStandards = props.standardsHrefs.includes(pathname);
  const groups = inStandards ? props.standards : props.main;
  const App = inStandards ? StandardsBook : MainBook;
  return React.createElement(App, { groups, pathname });
}
