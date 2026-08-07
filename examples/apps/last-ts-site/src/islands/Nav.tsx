"use client";

import * as React from "react";
import { Link } from "last-ts/Waku";
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
          <Link to={urls.home()}>Home</Link>
        </li>
        <li>
          <Link to={urls.view()}>View.Service island</Link>
        </li>
        <li>
          <Link to={urls.about()}>About</Link>
        </li>
        <li>
          <Link to={urls.chapter("routing")}>Guide · routing</Link>
        </li>
      </ul>
      <h2>Imports</h2>
      <ul className="imports">
        <li>
          <code>last-ts/Last</code>
        </li>
        <li>
          <code>last-ts/Waku</code>
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
