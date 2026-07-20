"use client";

// Desktop search entry: the sidebar's input + typeahead panel. The mobile overlay has its own
// input (NavBar); both render the same SearchPanel so results never differ between layouts.

import * as React from "react";
import { SearchPanel } from "./SearchPanel.js";

export function SidebarSearch(): React.ReactElement {
  const [query, setQuery] = React.useState("");

  return (
    <div className="sidebar-search">
      <input
        className="menu-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && query.trim() !== "") {
            window.location.assign(`/search?q=${encodeURIComponent(query.trim())}`);
          }
        }}
        placeholder="Search docs and API…"
        aria-label="Search docs and API"
      />
      <SearchPanel query={query} onNavigate={() => setQuery("")} />
    </div>
  );
}
