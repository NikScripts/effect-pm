"use client";

import * as React from "react";
import { Link } from "last-ts/Waku";
import { urls } from "../lib/site";

export function Nav(): React.ReactElement {
  return (
    <aside className="nav">
      <Link className="brand" to={urls.home()}>
        last.ts
      </Link>
      <h2>Docs</h2>
      <ul>
        <li>
          <Link to={urls.home()}>Home</Link>
        </li>
        <li>
          <Link to={urls.view()}>View.Service</Link>
        </li>
        <li>
          <Link to={urls.about()}>About</Link>
        </li>
        <li>
          <Link to={urls.chapter("routing")}>Guide · routing</Link>
        </li>
        <li>
          <Link to={urls.chapter("view-service")}>Guide · view-service</Link>
        </li>
      </ul>
      <h2>Surface</h2>
      <ul className="imports">
        <li>
          <code>Page.make</code> / <code>Page.static</code>
        </li>
        <li>
          <code>Route.fromPage</code>
        </li>
        <li>
          <code>Last.provider</code>
        </li>
        <li>
          <code>docs/last/site</code>
        </li>
      </ul>
    </aside>
  );
}
