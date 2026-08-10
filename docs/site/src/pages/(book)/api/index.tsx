import * as Page from "last-ts/Page";
import { PageMeta } from "../../../components/PageMeta.js";
import { packages } from "../../../lib/api-data.js";
import { urls } from "../../../lib/siteRoutes.js";
import { runServer } from "../../../lib/runtime.js";
import * as Router from "../../../ui/Router.js";

// The API landing — the list of documented packages. Loads only the tiny top index.
async function ApiIndex() {
  const pkgs = await runServer(packages());
  return (
    <>
      <PageMeta
        title="API Reference — Hyperlink"
        description="Compiler-accurate API reference for Hyperlink and its Effect dependencies."
        path={urls.api.index()}
      />
      <article className="prose">
        <h1>API Reference</h1>
        <p>
          {pkgs.length} package{pkgs.length === 1 ? "" : "s"}, each generated from its TypeScript
          types. Pick a package:
        </p>
        <div className="api-index">
          {pkgs.map((p) => (
            <Router.Link
              className="api-index-item"
              key={p.slug}
              to={urls.api.pkg(p.slug)}
            >
              <span className="api-index-name">{p.name}</span>
              <span className="api-index-count">{p.modules.reduce((n, m) => n + m.count, 0)}</span>
            </Router.Link>
          ))}
        </div>
      </article>
    </>
  );
}

// DEV-dynamic / prod-static render mode is chosen on `waku.server.tsx`, not here.
export class ApiIndexPage extends Page.make(ApiIndex) {}
