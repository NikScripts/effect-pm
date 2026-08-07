"use client";

import * as React from "react";
import { Link } from "last-ts/Router/waku";
import { urls } from "../lib/site.js";

export function Nav(): React.ReactElement {
  return (
    <aside className="nav">
      <Link className="brand" to={urls.home()}>
        last.ts
      </Link>
      <h2>RSC pages</h2>
      <ul>
        <li>
          <Link to={urls.home()}>Home · Page.static</Link>
        </li>
        <li>
          <Link to={urls.view()}>View.Service island</Link>
        </li>
        <li>
          <Link to={urls.about()}>About · Page.static</Link>
        </li>
        <li>
          <Link to={urls.chapter("routing")}>Guide · Page.build</Link>
        </li>
      </ul>
      <h2>Imports</h2>
      <ul className="imports">
        <li>
          <code>last-ts/Page</code>
        </li>
        <li>
          <code>last-ts/Router/waku</code>
        </li>
        <li>
          <code>last-ts/View</code>
        </li>
        <li>
          <code>waku</code> RSC
        </li>
      </ul>
    </aside>
  );
}
