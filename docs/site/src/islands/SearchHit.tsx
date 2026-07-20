// One hit row, shared by the typeahead panel and the /search page so the two surfaces can
// never render the same result differently. Query terms are marked in the title and summary.

import * as React from "react";
import type { SearchHit } from "../lib/search-core.js";

interface Range {
  readonly start: number;
  readonly end: number;
}

// Case-insensitive substring ranges for each query word, merged so overlapping words
// (`queue queuer`) produce one <mark>, not nested ones.
const matchRanges = (text: string, query: string): ReadonlyArray<Range> => {
  const lowered = text.toLowerCase();
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const raw: Array<Range> = [];
  for (const word of words) {
    let from = 0;
    while (from <= lowered.length - word.length) {
      const at = lowered.indexOf(word, from);
      if (at === -1) break;
      raw.push({
        start: at,
        end: at + word.length,
      });
      from = at + 1;
    }
  }
  raw.sort((a, b) => a.start - b.start);
  const merged: Array<Range> = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last !== undefined && r.start <= last.end) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, r.end),
      };
    } else {
      merged.push(r);
    }
  }
  return merged;
};

export const Highlight = ({
  text,
  query,
}: {
  readonly text: string;
  readonly query: string;
}): React.ReactElement => {
  const ranges = matchRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;
  const parts: Array<React.ReactNode> = [];
  let cursor = 0;
  ranges.forEach((r, i) => {
    if (r.start > cursor) parts.push(text.slice(cursor, r.start));
    parts.push(<mark key={i}>{text.slice(r.start, r.end)}</mark>);
    cursor = r.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
};

export const HitRow = ({
  hit,
  query,
  active = false,
  showPkg = false,
  onNavigate,
}: {
  readonly hit: SearchHit;
  readonly query: string;
  readonly active?: boolean;
  readonly showPkg?: boolean;
  readonly onNavigate?: () => void;
}): React.ReactElement => (
  <a
    className={active ? "search-hit is-active" : "search-hit"}
    href={hit.doc.url}
    onClick={onNavigate}
  >
    <span className="search-hit-title">
      <Highlight text={hit.doc.title} query={query} />
      {hit.doc.kind !== undefined ? (
        <span className={`api-kind api-kind-${hit.doc.kind}`}>{hit.doc.kind}</span>
      ) : null}
      {showPkg && hit.doc.pkg !== undefined ? (
        <span className="search-hit-ctx">{hit.doc.pkg}</span>
      ) : null}
      {hit.doc.context !== undefined ? (
        <span className="search-hit-ctx">{hit.doc.context}</span>
      ) : null}
    </span>
    {hit.doc.summary !== "" ? (
      <span className="search-hit-sum">
        <Highlight text={hit.doc.summary} query={query} />
      </span>
    ) : null}
  </a>
);
