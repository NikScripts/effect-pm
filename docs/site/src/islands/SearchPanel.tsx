"use client";

// The typeahead PREVIEW panel: small sectioned results (API first, then Pages, Glossary), each
// section capped with a "show more" link into /search. Rendered inside the nav overlay whenever
// the query is non-empty; Enter navigation is the NavBar input's job.

import * as React from "react";
import { searchSections, type SearchHit, type SearchIndex } from "../lib/search-core.js";
import { loadSearchIndex } from "./search-client.js";

const sectionMeta = [
  { key: "api", label: "API Reference", type: "api" },
  { key: "pages", label: "Pages", type: "page" },
  { key: "glossary", label: "Glossary", type: "glossary" },
] as const;

const Hit = ({
  hit,
  onNavigate,
}: {
  hit: SearchHit;
  onNavigate?: () => void;
}): React.ReactElement => (
  <a className="search-hit" href={hit.doc.url} onClick={onNavigate}>
    <span className="search-hit-title">
      {hit.doc.title}
      {hit.doc.kind !== undefined ? (
        <span className={`api-kind api-kind-${hit.doc.kind}`}>{hit.doc.kind}</span>
      ) : null}
      {hit.doc.context !== undefined ? (
        <span className="search-hit-ctx">{hit.doc.context}</span>
      ) : null}
    </span>
    {hit.doc.summary !== "" ? <span className="search-hit-sum">{hit.doc.summary}</span> : null}
  </a>
);

export function SearchPanel({
  query,
  onNavigate,
}: {
  readonly query: string;
  readonly onNavigate?: () => void;
}): React.ReactElement | null {
  const [index, setIndex] = React.useState<SearchIndex | undefined>(undefined);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (query.trim() === "" || index !== undefined || failed) return;
    let alive = true;
    loadSearchIndex().then(
      (i) => {
        if (alive) setIndex(i);
      },
      () => {
        if (alive) setFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, [query, index, failed]);

  const q = query.trim();
  if (q === "") return null;
  if (failed) return <p className="search-note">Search index unavailable.</p>;
  if (index === undefined) return <p className="search-note">Loading search…</p>;

  const sections = searchSections(index, q, { api: 5, pages: 4, glossary: 3 });
  const empty = sections.api.length + sections.pages.length + sections.glossary.length === 0;
  if (empty) return <p className="search-note">No results for “{q}”.</p>;

  return (
    <div className="search-panel">
      {sectionMeta.map(({ key, label, type }) => {
        const hits = sections[key];
        if (hits.length === 0) return null;
        return (
          <section className="search-section" key={key}>
            <div className="search-section-head">
              <span>{label}</span>
              <a href={`/search?q=${encodeURIComponent(q)}&type=${type}`} onClick={onNavigate}>
                more →
              </a>
            </div>
            {hits.map((hit) => (
              <Hit hit={hit} key={hit.doc.id} onNavigate={onNavigate} />
            ))}
          </section>
        );
      })}
      <a className="search-all" href={`/search?q=${encodeURIComponent(q)}`} onClick={onNavigate}>
        All results for “{q}” ↵
      </a>
    </div>
  );
}
