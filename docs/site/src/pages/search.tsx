import { SearchResults } from "../islands/SearchResults.js";
import { PageMeta } from "../components/PageMeta.js";
import { SearchAside } from "../components/ApiAside.js";

// Full search results: a static shell + the client island (the island reads ?q= from the URL and
// runs the same engine/ranking the typeahead uses, over the same lazily-fetched index).
export default function SearchPage() {
  return (
    <>
      <PageMeta
        title="Search — Hyperlink"
        description="Search the Hyperlink docs, API reference, and glossary."
        path="/search"
      />
      <article className="prose">
        <h1>Search</h1>
        <SearchResults />
      </article>
      <SearchAside />
    </>
  );
}
