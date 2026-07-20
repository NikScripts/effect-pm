// The search engine wrapper — MiniSearch under one tunable ranking model. Browser-safe (no node
// imports); the SAME code indexes and ranks in the typeahead island and the /search page, so
// results never disagree. Documents come from scripts/gen-search.ts (engine-agnostic JSON).
//
// Ranking model (each lever exists for a measured reason — see test/search-rank.test.ts):
//   - field boosts: identifier fields beat prose (`Subscribable` should find the API page).
//   - identifier tokenization: camelCase + dot-paths split, so `queue res` finds QueueResource.
//   - doc boosts (the per-document lever MiniSearch gives us): package tier (effect-pm first),
//     kind weight (modules/namespaces/classes over helper consts), and a DAMPENED popularity
//     factor from the reference graph — types only, where declaration references mean something.
//   - exact dominance: an exact name/title match multiplies AFTER everything else, so popularity
//     can only break near-ties, never beat the thing you literally typed (the `retry` lesson).
//   - one index per doc type (api/page/glossary) + query-side synonyms (`ws` → websocket).

import MiniSearch from "minisearch";

export interface SearchDoc {
  readonly id: string;
  readonly type: "api" | "page" | "glossary";
  readonly title: string;
  readonly url: string;
  readonly summary: string;
  readonly kind?: string;
  readonly pkg?: string;
  readonly name?: string;
  readonly refs?: number;
  readonly context?: string;
  readonly text?: string;
}

export interface SearchHit {
  readonly doc: SearchDoc;
  readonly score: number;
}

export interface SearchSections {
  readonly api: ReadonlyArray<SearchHit>;
  readonly pages: ReadonlyArray<SearchHit>;
  readonly glossary: ReadonlyArray<SearchHit>;
}

// Identifier-aware tokenizer: split on separators AND camelCase humps, keeping the full word too
// (`QueueResource` -> queueresource, queue, resource) so both exact and part queries match.
export const tokenize = (s: string): Array<string> =>
  s
    .split(/[\s.,;:!?()[\]{}<>"'`|/\\-]+/)
    .flatMap((w) => [w, ...w.split(/(?=[A-Z])/)])
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 1);

const packageTier: Record<string, number> = {
  "effect-pm": 2.0, // our own API outranks dependencies decisively
  effect: 1.0,
};

const kindWeight: Record<string, number> = {
  module: 1.6,
  namespace: 1.4,
  class: 1.25,
  interface: 1.25,
  type: 1.15,
};

// Popularity from the reference graph — types only: declaration-site references are a strong
// signal for types and a weak one for functions (Effect.retry has 0 declaration refs).
const typeish = new Set(["interface", "class", "type", "namespace", "module"]);

// One MiniSearch per doc type: sections never need cross-type filtering, term statistics stay
// within a type (an API-heavy corpus can't skew page ranking), and the per-type corpus chunks
// can index independently as they arrive.
export interface SearchIndex {
  readonly minis: { readonly [T in SearchDoc["type"]]: MiniSearch<SearchDoc> };
  readonly byId: ReadonlyMap<string, SearchDoc>;
}

const miniFor = (docs: ReadonlyArray<SearchDoc>): MiniSearch<SearchDoc> => {
  const mini = new MiniSearch<SearchDoc>({
    fields: ["title", "name", "summary", "text", "context"],
    storeFields: ["type", "title", "url", "summary", "kind", "pkg", "name", "refs", "context"],
    tokenize,
    searchOptions: {
      boost: { title: 5, name: 4, summary: 1.5, text: 1, context: 1 },
      prefix: true,
      fuzzy: 0.15,
    },
  });
  mini.addAll([...docs]);
  return mini;
};

export const buildIndex = (docs: ReadonlyArray<SearchDoc>): SearchIndex => ({
  minis: {
    api: miniFor(docs.filter((d) => d.type === "api")),
    page: miniFor(docs.filter((d) => d.type === "page")),
    glossary: miniFor(docs.filter((d) => d.type === "glossary")),
  },
  byId: new Map(docs.map((d) => [d.id, d])),
});

// Query-side synonyms — for abbreviations prefix search can't reach (`ws` never prefixes
// `websocket`). Each match adds an expanded query; results merge by best score.
const synonyms: Record<string, string> = {
  ws: "websocket",
  wss: "websocket",
};

const expandQuery = (q: string): ReadonlyArray<string> => {
  const words = q.split(/\s+/);
  const expanded = [q];
  words.forEach((word, i) => {
    const alias = synonyms[word.toLowerCase()];
    if (alias !== undefined) {
      expanded.push(words.map((w, j) => (j === i ? alias : w)).join(" "));
    }
  });
  return expanded;
};

const docBoost = (fields: Record<string, unknown>): number => {
  const pkg = typeof fields.pkg === "string" ? fields.pkg : undefined;
  const kind = typeof fields.kind === "string" ? fields.kind : undefined;
  const refs = typeof fields.refs === "number" ? fields.refs : 0;
  const tier = pkg !== undefined ? packageTier[pkg] ?? 0.9 : 1;
  const weight = kind !== undefined ? kindWeight[kind] ?? 1 : 1;
  const popularity = kind !== undefined && typeish.has(kind) ? 1 + Math.log1p(refs) * 0.15 : 1;
  return tier * weight * popularity;
};

const search = (
  index: SearchIndex,
  query: string,
  type: SearchDoc["type"],
  limit: number
): ReadonlyArray<SearchHit> => {
  const q = query.trim();
  if (q === "") return [];
  const lowered = q.toLowerCase();
  const best = new Map<string, { readonly id: string; readonly score: number }>();
  for (const variant of expandQuery(q)) {
    for (const r of index.minis[type].search(variant, {
      boostDocument: (_id, _term, fields) => docBoost(fields ?? {}),
    })) {
      const id = String(r.id);
      const seen = best.get(id);
      if (seen === undefined || r.score > seen.score) {
        best.set(id, {
          id,
          score: r.score,
        });
      }
    }
  }
  return [...best.values()]
    .map((r) => {
      const doc = index.byId.get(String(r.id));
      if (doc === undefined) return undefined;
      // exact dominance: the literally-typed name always wins over popularity; a CASE-exact
      // match additionally beats a case-folded one (`retry` finds Effect.retry, not Effect.Retry)
      const caseExact = doc.name === q || doc.title === q ? 1.5 : 1;
      const exact =
        doc.name?.toLowerCase() === lowered || doc.title.toLowerCase() === lowered
          ? 3 * caseExact
          : doc.title.toLowerCase().endsWith(`.${lowered}`)
          ? 2.5
          : 1;
      return {
        doc,
        score: r.score * exact,
      };
    })
    .filter((hit): hit is SearchHit => hit !== undefined)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};

/** Sectioned results — the typeahead preview shape (small per-section limits). */
export const searchSections = (
  index: SearchIndex,
  query: string,
  limits: { readonly api: number; readonly pages: number; readonly glossary: number }
): SearchSections => ({
  api: search(index, query, "api", limits.api),
  pages: search(index, query, "page", limits.pages),
  glossary: search(index, query, "glossary", limits.glossary),
});

/** One section, bigger limit — the full results page / "show more". */
export const searchType = (
  index: SearchIndex,
  query: string,
  type: SearchDoc["type"],
  limit: number
): ReadonlyArray<SearchHit> => search(index, query, type, limit);
