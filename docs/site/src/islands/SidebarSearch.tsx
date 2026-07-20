"use client";

// Desktop search entry: the sidebar's input + typeahead panel. The mobile overlay has its own
// input (NavBar); both render the same SearchPanel so results never differ between layouts.

import * as React from "react";
import { SearchPanel, type SearchPanelControl } from "./SearchPanel.js";

export function SidebarSearch(): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const panelRef = React.useRef<SearchPanelControl | null>(null);

  return (
    <div className="sidebar-search">
      <input
        className="menu-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (panelRef.current?.handleKey(e) === true) return;
          if (e.key === "Enter" && query.trim() !== "") {
            window.location.assign(`/search?q=${encodeURIComponent(query.trim())}`);
          }
          if (e.key === "Escape") setQuery("");
        }}
        placeholder="Search docs and API…"
        aria-label="Search docs and API"
      />
      <SearchPanel query={query} onNavigate={() => setQuery("")} controlRef={panelRef} />
    </div>
  );
}
