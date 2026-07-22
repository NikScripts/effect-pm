import { NotFoundSearch } from "../islands/NotFoundSearch.js";
import { PageMeta } from "../components/PageMeta.js";

// Custom 404 — the dead URL's last segment seeds a live search, so mistyped or moved links land
// next to what they meant instead of on a blank wall.
export default function NotFound() {
  return (
    <div className="notfound">
      <PageMeta
        title="Page not found — hyperlink-ts"
        description="This page does not exist; search the docs instead."
      />
      <h1>Page not found</h1>
      <p className="search-note">
        Nothing lives at this address. The closest matches to its last segment:
      </p>
      <NotFoundSearch />
      <p>
        <a href="/">Back to the docs home</a> · <a href="/api">API reference</a>
      </p>
    </div>
  );
}

export const getConfig = async () => ({ render: "static" } as const);
