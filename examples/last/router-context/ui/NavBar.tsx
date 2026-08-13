/**
 * @module examples/last/router-context/ui/NavBar
 *
 * Leaf Views (DOM) + composition View (zero DOM) + `NavBarContext`.
 * Kits avoid importing the catalog (breaks `.context(Site)` cycle); soft-nav
 * uses path `to` strings here — prefer `Last.link(App, …)` in non-cyclic modules.
 */
import * as React from "react";
import * as Last from "last-ts/Last";
import * as Router from "last-ts/Router";
import * as View from "last-ts/View";
import * as SiteCopy from "../lib/SiteCopy";

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/router-context/ui/NavBar/Root",
  (props) => (
    <header data-nav="root">{props.children}</header>
  ),
) {}

export class Brand extends View.make<Brand, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/router-context/ui/NavBar/Brand",
  (props) => <span data-nav="brand">{props.children}</span>,
) {}

export class Nav extends View.make<Nav, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/router-context/ui/NavBar/Nav",
  (props) => (
    <nav data-nav="links" aria-label="Primary">{props.children}</nav>
  ),
) {}

export class Item extends View.make<Item, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/router-context/ui/NavBar/Item",
  (props) => <span data-nav="item">{props.children}</span>,
) {}

export class NavBar extends View.make<NavBar>()(
  "hyperlink-ts/examples/last/router-context/ui/NavBar",
  () => {
    const {
      Root: NavRoot,
      Brand: BrandView,
      Nav: NavEl,
      Item: ItemView,
      SiteCopy: copy,
    } = Last.use(NavBarContext);
    return (
      <NavRoot>
        <Router.Link to="/">
          <BrandView>{copy.brand}</BrandView>
        </Router.Link>
        <NavEl>
          <Router.Link to="/about">
            <ItemView>About</ItemView>
          </Router.Link>
          {" · "}
          <Router.Link to="/docs">
            <ItemView>Docs</ItemView>
          </Router.Link>
        </NavEl>
      </NavRoot>
    );
  },
) {}

export class NavBarContext extends Last.context({
  Root,
  Brand,
  Nav,
  Item,
  View: NavBar,
  SiteCopy: SiteCopy.SiteCopy,
}) {}
