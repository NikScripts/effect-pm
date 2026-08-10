import * as Page from "last-ts/Page";
import { NotFoundSearch } from "../../islands/NotFoundSearch.js";
import { PageMeta } from "../../components/PageMeta.js";
import { urls } from "../../lib/siteRoutes.js";
import * as Router from "../../ui/Router.js";

// Custom 404 — the dead URL's last segment seeds a live search, so mistyped or moved links land
// next to what they meant instead of on a blank wall.
function NotFound() {
  return (
    <div className="notfound">
      <PageMeta
        title="Page not found — Hyperlink"
        description="This page does not exist; search the docs instead."
        noIndex
      />
      <h1>Page not found</h1>
      <p className="search-note">
        Nothing lives at this address. The closest matches to its last segment:
      </p>
      <NotFoundSearch />
      <p>
        <Router.Link to={urls.home()}>Back to the docs home</Router.Link>
        {" · "}
        <Router.Link to={urls.api.index()}>API reference</Router.Link>
      </p>
    </div>
  );
}

export class NotFoundPage extends Page.static(NotFound) {}
