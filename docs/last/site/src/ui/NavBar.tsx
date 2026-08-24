/**
 * Top bar kit — leaf Views (DOM) + composition (zero DOM) + `NavBarContext`.
 */
"use client";

import type * as React from "react";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";
import { Link } from "../lib/Link";
import { urls } from "../lib/Catalog";

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/NavBar/Root",
  (props) => (
    <header className="navbar">
      <div className="navbar-inner">{props.children}</div>
    </header>
  ),
) {}

export class Brand extends View.make<Brand, {
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/NavBar/Brand",
  (props) => (
    <Link className="navbar-brand" to={urls.index()}>
      {props.children}
    </Link>
  ),
) {}

export class Nav extends View.make<Nav, {
  readonly children?: React.ReactNode;
}>()(
  "last-ts/site/NavBar/Nav",
  (props) => (
    <nav className="navbar-links" aria-label="Primary">
      {props.children}
    </nav>
  ),
) {}

export class NavBar extends View.make<NavBar>()(
  "last-ts/site/NavBar",
  () => {
    const { Root: NavRoot, Brand: BrandView, Nav: NavEl } = Last.use(
      NavBarContext,
    );
    return (
      <NavRoot>
        <BrandView>last.ts</BrandView>
        <NavEl>
          <Link to={urls.index()}>Home</Link>
          <Link to={urls.about()}>About</Link>
          <Link to={urls.guides_slug("routing")}>Docs</Link>
          <Link to={urls.view()}>View</Link>
        </NavEl>
      </NavRoot>
    );
  },
) {}

export class NavBarContext extends Last.context({
  Root,
  Brand,
  Nav,
  View: NavBar,
}) {}
