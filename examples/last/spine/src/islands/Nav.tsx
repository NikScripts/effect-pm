"use client";

import type { ReactElement } from "react";
import { Link, urls } from "../lib/site";

export function Nav(): ReactElement {
  return (
    <aside className="nav">
      <Link className="brand" to={urls.index()}>
        spine
      </Link>
      <ul>
        <li>
          <Link to={urls.index()}>Home</Link>
        </li>
        <li>
          <Link to={urls.about()}>About</Link>
        </li>
        <li>
          <Link to={urls.guides_slug("routing")}>Guide · routing</Link>
        </li>
        <li>
          <Link to={urls.guides_slug("provider")}>Guide · provider</Link>
        </li>
      </ul>
    </aside>
  );
}
