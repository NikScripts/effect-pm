import { PageMeta } from "../../../components/PageMeta.js";
import { packages } from "../../../lib/api-data.js";
import { urls } from "../../../lib/siteRoutes.js";
import { runServer } from "../../../lib/runtime.js";
import * as Router from "../../../ui/Router.js";

// The API landing — the list of documented packages. Loads only the tiny top index.
export default async function ApiIndex() {
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
              to={(u) => u.api.pkg(p.slug)}
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

export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
