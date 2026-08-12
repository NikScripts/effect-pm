/**
 * Top bar — brand + primary links. HTML for this region lives here.
 */
"use client";

import type * as React from "react";
import * as Waku from "last-ts/Waku";
import { urls } from "../lib/site";

export const Brand = (): React.ReactElement => (
  <Waku.Link className="navbar-brand" to={urls.index()}>
    last.ts
  </Waku.Link>
);

export const Links = (): React.ReactElement => (
  <nav className="navbar-links" aria-label="Primary">
    <Waku.Link to={urls.index()}>Home</Waku.Link>
    <Waku.Link to={urls.about()}>About</Waku.Link>
    <Waku.Link to={urls.guides_slug("routing")}>Docs</Waku.Link>
    <Waku.Link to={urls.view()}>View</Waku.Link>
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
