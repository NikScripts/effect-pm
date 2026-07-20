// Client-side search index loader — fetches the generated corpus chunks ONCE (module-level
// promise, so the typeahead, the results page, and the 404 page share the load) and builds the
// per-type MiniSearch indexes locally (~50ms for ~5k docs). Nothing loads until the first search
// interaction. The three chunks fetch in parallel; precompressed variants (.gz/.br) exist beside
// them for hosts that negotiate encoding.

import { buildIndex, type SearchDoc, type SearchIndex } from "../lib/search-core.js";

const chunkFiles = ["/search/api.json", "/search/pages.json", "/search/glossary.json"];

const fetchChunk = (path: string): Promise<ReadonlyArray<SearchDoc>> =>
  fetch(path)
    .then((r) => {
      if (!r.ok) throw new Error(`search index ${path}: HTTP ${r.status}`);
      return r.json();
    })
    .then((data: { docs: ReadonlyArray<SearchDoc> }) => data.docs);

let loading: Promise<SearchIndex> | undefined;

export const loadSearchIndex = (): Promise<SearchIndex> => {
  loading ??= Promise.all(chunkFiles.map(fetchChunk)).then((chunks) => buildIndex(chunks.flat()));
  return loading;
};
