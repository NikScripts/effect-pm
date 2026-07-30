"use client";

// The FULL results page (/search?q=…[&type=…]): the same engine and ranking as the typeahead,
// bigger sections. Reads the query from the URL so results are shareable; re-searchable in place.

import * as React from "react";
import {
  searchSections,
  searchType,
  type SearchDoc,
  type SearchIndex,
} from "../lib/search-core.js";
import { urls } from "../lib/siteRoutes.js";
import { loadSearchIndex } from "./search-client.js";
import { HitRow } from "./SearchHit.js";

const sectionMeta = [
  { key: "api", label: "API Reference", type: "api" },
  { key: "pages", label: "Pages", type: "page" },
  { key: "glossary", label: "Glossary", type: "glossary" },
] as const;

const isType = (s: string | null): s is SearchDoc["type"] =>
  s === "api" || s === "page" || s === "glossary";

export function SearchResults(): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const [only, setOnly] = React.useState<SearchDoc["type"] | undefined>(undefined);
  const [index, setIndex] = React.useState<SearchIndex | undefined>(undefined);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQuery(params.get("q") ?? "");
    const t = params.get("type");
    if (isType(t)) setOnly(t);
    loadSearchIndex().then(setIndex, () => setFailed(true));
  }, []);

  const q = query.trim();

  return (
    <div className="search-page">
      {failed ? <p className="search-note">Search index unavailable.</p> : null}
      {!failed && index === undefined ? <p className="search-note">Loading search…</p> : null}
      {index !== undefined && q === "" ? (
        <p className="search-note">No query — open search (⌘K) and press Enter to land here.</p>
      ) : null}
      {index !== undefined && q !== "" ? (
        only !== undefined ? (
          <section className="search-section">
            <div className="search-section-head">
              <span>{sectionMeta.find((s) => s.type === only)?.label}</span>
              <a href={urls.search({ query: { q } })} onClick={() => setOnly(undefined)}>
                all sections
              </a>
            </div>
            {searchType(index, q, only, 50).map((hit) => (
              <HitRow hit={hit} query={q} showPkg key={hit.doc.id} />
            ))}
          </section>
        ) : (
          (() => {
            const sections = searchSections(index, q, { api: 12, pages: 10, glossary: 6 });
            const total = sections.api.length + sections.pages.length + sections.glossary.length;
            if (total === 0) return <p className="search-note">No results for “{q}”.</p>;
            return sectionMeta.map(({ key, label, type }) => {
              const hits = sections[key];
              if (hits.length === 0) return null;
              return (
                <section className="search-section" key={key}>
                  <div className="search-section-head">
                    <span>{label}</span>
                    <a href={urls.search({ query: { q, type } })}>show all</a>
                  </div>
                  {hits.map((hit) => (
                    <HitRow hit={hit} query={q} showPkg key={hit.doc.id} />
                  ))}
                </section>
              );
            });
          })()
        )
      ) : null}
    </div>
  );
}
