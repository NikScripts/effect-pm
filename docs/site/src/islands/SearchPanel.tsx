"use client";

// The typeahead PREVIEW panel: small sectioned results (API first, then Pages, Glossary), each
// section capped with a "show more" link into /search. Rendered inside the nav overlay whenever
// the query is non-empty; Enter navigation is the NavBar input's job.
//
// Keyboard: the OWNING input forwards its keydown through `controlRef.handleKey` before its own
// Enter handling — ↑/↓ walk the flattened hit list, Enter on a selection navigates to it (and
// returns true so the owner skips its Enter → /search fallback).

import * as React from "react";
import { searchSections, type SearchHit, type SearchIndex } from "../lib/search-core.js";
import * as Router from "../ui/Router.js";
import { loadSearchIndex } from "./search-client.js";
import { HitRow } from "./SearchHit.js";

const sectionMeta = [
  { key: "api", label: "API Reference", type: "api" },
  { key: "pages", label: "Pages", type: "page" },
  { key: "glossary", label: "Glossary", type: "glossary" },
] as const;

export interface SearchPanelControl {
  readonly handleKey: (e: React.KeyboardEvent) => boolean;
}

export function SearchPanel({
  query,
  onNavigate,
  controlRef,
}: {
  readonly query: string;
  readonly onNavigate?: () => void;
  readonly controlRef?: React.MutableRefObject<SearchPanelControl | null>;
}): React.ReactElement | null {
  const router = Router.useRouter();
  const [index, setIndex] = React.useState<SearchIndex | undefined>(undefined);
  const [failed, setFailed] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const panelRef = React.useRef<HTMLDivElement>(null);

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
  const sections = React.useMemo(
    () =>
      index !== undefined && q !== ""
        ? searchSections(index, q, { api: 5, pages: 4, glossary: 3 })
        : undefined,
    [index, q]
  );
  const flat: ReadonlyArray<SearchHit> = React.useMemo(
    () =>
      sections !== undefined ? [...sections.api, ...sections.pages, ...sections.glossary] : [],
    [sections]
  );

  // selection resets when the query changes; clamp if the list shrank under it
  React.useEffect(() => {
    setActive(-1);
  }, [q]);
  const selected = active >= 0 && active < flat.length ? active : -1;

  React.useEffect(() => {
    if (controlRef === undefined) return;
    controlRef.current = {
      handleKey: (e) => {
        if (flat.length === 0) return false;
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const next =
            e.key === "ArrowDown"
              ? (selected + 1) % flat.length
              : (selected - 1 + flat.length) % flat.length;
          setActive(next);
          panelRef.current
            ?.querySelectorAll(".search-hit")
            [next]?.scrollIntoView({ block: "nearest" });
          return true;
        }
        if (e.key === "Enter" && selected !== -1) {
          const hit = flat[selected];
          if (hit !== undefined) {
            e.preventDefault();
            onNavigate?.();
            void router.go(hit.doc.url);
          }
          return true;
        }
        return false;
      },
    };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef, flat, selected, onNavigate, router]);

  if (q === "") return null;
  if (failed) return <p className="search-note">Search index unavailable.</p>;
  if (sections === undefined) return <p className="search-note">Loading search…</p>;
  if (flat.length === 0) return <p className="search-note">No results for “{q}”.</p>;

  let offset = 0;
  return (
    <div className="search-panel" ref={panelRef}>
      {sectionMeta.map(({ key, label, type }) => {
        const hits = sections[key];
        if (hits.length === 0) return null;
        const base = offset;
        offset += hits.length;
        return (
          <section className="search-section" key={key}>
            <div className="search-section-head">
              <span>{label}</span>
              <Router.Link
                to={(u) => u.search({ query: { q, type } })}
                onClick={onNavigate}
              >
                more →
              </Router.Link>
            </div>
            {hits.map((hit, i) => (
              <HitRow
                hit={hit}
                query={q}
                active={base + i === selected}
                key={hit.doc.id}
                onNavigate={onNavigate}
              />
            ))}
          </section>
        );
      })}
      <Router.Link
        className="search-all"
        to={(u) => u.search({ query: { q } })}
        onClick={onNavigate}
      >
        All results for “{q}” ↵
      </Router.Link>
    </div>
  );
}
