"use client";

/**
 * Tiny API showcase for the Waku + Route layer (prototype).
 * Not linked from nav — import/render when reviewing the surface.
 */
import * as React from "react";
import { path } from "../lib/siteRoutes.js";
import { SiteLink } from "./SiteLink.js";
import { useSiteRouter } from "../lib/useSiteRouter.js";

export function SiteRoutesApiDemo(): React.ReactElement {
  const router = useSiteRouter();
  return (
    <div className="prose">
      <h2>Site routes API (prototype)</h2>
      <p>
        Waku owns the page. Typed hrefs via <code>path</code> /{" "}
        <code>SiteLink</code>.
      </p>
      <ul>
        <li>
          <SiteLink to={(p) => p.home()}>path.home()</SiteLink>
        </li>
        <li>
          <SiteLink to={(p) => p.docs("work-pools")}>
            path.docs(&quot;work-pools&quot;) — static SSG chapter
          </SiteLink>
        </li>
        <li>
          <SiteLink to={path.apiSymbol("hyperlink-ts", "WorkPool", "Tag")}>
            path.apiSymbol(hyperlink-ts) — static own API
          </SiteLink>
        </li>
        <li>
          <SiteLink to={path.apiSymbol("effect", "Effect", "succeed")}>
            path.apiSymbol(effect) — dynamic SSR dep API
          </SiteLink>
        </li>
      </ul>
      <button
        type="button"
        onClick={() => {
          void router.push((p) => p.releases());
        }}
      >
        router.push((p) =&gt; p.releases())
      </button>
      <p>
        Current Waku path: <code>{router.path || "/"}</code>
      </p>
    </div>
  );
}
