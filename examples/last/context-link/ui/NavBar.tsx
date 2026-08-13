/**
 * @module examples/last/context-link/ui/NavBar
 *
 * Region kit — leaf Views (DOM) + composition View (zero DOM) + `NavBarContext`
 * + `Last.link` wrappers. Co-located per lock.
 */
import * as React from "react";
import * as Last from "last-ts/Last";
import * as View from "last-ts/View";
import * as Catalog from "../lib/Catalog";
import * as SiteCopy from "../lib/SiteCopy";

// ---cut---
// =============================================================================
// Leaf Views (DOM here)
// =============================================================================

export class Root extends View.make<Root, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/context-link/ui/NavBar/Root",
  (props) => (
    <header data-nav="root">{props.children}</header>
  ),
) {}

export class Brand extends View.make<Brand, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/context-link/ui/NavBar/Brand",
  (props) => <span data-nav="brand">{props.children}</span>,
) {}

export class Nav extends View.make<Nav, {
  readonly children?: React.ReactNode;
}>()(
  "hyperlink-ts/examples/last/context-link/ui/NavBar/Nav",
  (props) => (
    <nav data-nav="links" aria-label="Primary">{props.children}</nav>
  ),
) {}

// =============================================================================
// Last.link — named / narrowed links (not View tags)
// =============================================================================

/** Home — direct link (no `to` prop on the result). */
export const HomeBrand = Last.link(Catalog.Catalog, Brand, {
  to: (u) => u.main.home(),
});

/** Docs group — `to` picks only docs routes. */
export const DocsLink = Last.link(Catalog.Catalog, {
  to: (u) => u.docs,
});

/** Docs chapter — uncalled route ⇒ `slug` (+ optional `query`) are props. */
export const ChapterLink = Last.link(Catalog.Catalog, {
  to: (u) => u.docs.chapter,
});

/** External. */
export const EffectLink = Last.link(Catalog.Catalog, {
  out: "https://effect.website",
});

// =============================================================================
// Composition View (zero DOM tags) + context
// =============================================================================

export class NavBar extends View.make<NavBar>()(
  "hyperlink-ts/examples/last/context-link/ui/NavBar",
  () => {
    const { Root: NavRoot, Nav: NavEl, SiteCopy: copy } = Last.use(
      NavBarContext,
    );
    return (
      <NavRoot>
        <HomeBrand>{copy.brand}</HomeBrand>
        <NavEl>
          <DocsLink
            to={(docs: { readonly index: () => string }) => docs.index()}
          >
            Docs
          </DocsLink>
          {" · "}
          <ChapterLink slug="routing">Routing</ChapterLink>
          {" · "}
          <ChapterLink slug="routing" query={{ tab: "api" }}>
            Routing?tab=api
          </ChapterLink>
          {" · "}
          <EffectLink>Effect</EffectLink>
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
  SiteCopy: SiteCopy.SiteCopy,
}) {}
