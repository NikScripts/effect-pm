import { SearchResults } from "../islands/SearchResults.js";

// Full search results: a static shell + the client island (the island reads ?q= from the URL and
// runs the same engine/ranking the typeahead uses, over the same lazily-fetched index).
export default function SearchPage() {
  return (
    <>
      <title>Search — effect-pm</title>
      <article className="prose">
        <h1>Search</h1>
        <SearchResults />
      </article>
    </>
  );
}
