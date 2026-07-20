// Client-side search index loader — fetches the generated corpus ONCE (module-level promise, so
// the typeahead and the results page share the load) and builds the MiniSearch index locally
// (~50ms for ~5k docs). Nothing loads until the first search interaction.

import { buildIndex, type SearchIndex } from "../lib/search-core.js";

let loading: Promise<SearchIndex> | undefined;

export const loadSearchIndex = (): Promise<SearchIndex> => {
  loading ??= fetch("/search/docs.json")
    .then((r) => {
      if (!r.ok) throw new Error(`search index: HTTP ${r.status}`);
      return r.json();
    })
    .then((data: { docs: Parameters<typeof buildIndex>[0] }) => buildIndex(data.docs));
  return loading;
};
