"use client";

import * as React from "react";
import { Link } from "last-ts/Waku";
import { urls } from "../lib/site";

export function Nav(): React.ReactElement {
  return (
    <aside className="nav">
      <Link className="brand" to={urls.index()}>
        last.ts
      </Link>
      <h2>Docs</h2>
      <ul>
        <li>
          <Link to={urls.index()}>Home</Link>
        </li>
        <li>
          <Link to={urls.view()}>View.make</Link>
        </li>
        <li>
          <Link to={urls.about()}>About</Link>
        </li>
        <li>
          <Link to={urls.guides_slug("routing")}>Guide · routing</Link>
        </li>
        <li>
          <Link to={urls.guides_slug("view-service")}>Guide · view-service</Link>
        </li>
        <li>
          <Link to={urls.docs_path("intro/rest")}>Rest · intro/rest</Link>
        </li>
      </ul>
      <h2>Surface</h2>
      <ul className="imports">
        <li>
          <code>Router.make</code> / <code>Route.get</code>
        </li>
        <li>
          <code>View.make</code> / <code>View.mount</code>
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
