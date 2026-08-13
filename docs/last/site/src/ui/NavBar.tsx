/**
 * Top bar — brand + primary links. HTML for this region lives here.
 */
"use client";

import type * as React from "react";
import { Link } from "../lib/Link";
import { urls } from "../lib/site";

export const Brand = (): React.ReactElement => (
  <Link className="navbar-brand" to={urls.index()}>
    last.ts
  </Link>
);

export const Links = (): React.ReactElement => (
  <nav className="navbar-links" aria-label="Primary">
    <Link to={urls.index()}>Home</Link>
    <Link to={urls.about()}>About</Link>
    <Link to={urls.guides_slug("routing")}>Docs</Link>
    <Link to={urls.view()}>View</Link>
  </nav>
);

/** Full top bar. */
export const NavBar = (): React.ReactElement => (
  <header className="navbar">
    <div className="navbar-inner">
      <Brand />
      <Links />
    </div>
  </header>
);
