"use client";

// The 404 page's working half: derive a search query from the dead URL's last segment and run
// the real typeahead over it, so a broken link becomes a near-miss list instead of a dead end.

import * as React from "react";
import * as Router from "../ui/Router.js";
import { SearchPanel, type SearchPanelControl } from "./SearchPanel.js";

const queryFromPath = (pathname: string): string => {
  const segment =
    pathname
      .split("/")
      .filter((s) => s !== "")
      .pop() ?? "";
  return decodeURIComponent(segment)
    .replace(/\.[a-z]+$/, "")
    .split(/[-_.]+/)
    .join(" ")
    .trim();
};

export function NotFoundSearch(): React.ReactElement {
  const router = Router.useRouter();
  const [query, setQuery] = React.useState("");
  const panelRef = React.useRef<SearchPanelControl | null>(null);

  React.useEffect(() => {
    setQuery(queryFromPath(window.location.pathname));
  }, []);

  return (
    <div className="sidebar-search notfound-search">
      <input
        className="menu-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (panelRef.current?.handleKey(e) === true) return;
          if (e.key === "Enter" && query.trim() !== "") {
            const q = query.trim();
            void router.to((u) => u.search({ query: { q } }));
          }
        }}
        placeholder="Search docs and API…"
        aria-label="Search docs and API"
      />
      <SearchPanel query={query} controlRef={panelRef} />
    </div>
  );
}
