import { namespaceSummaries, slugForEntry } from "../../lib/api-index.js";

// The API-reference landing page. Uses only the tiny summary (names + counts), never the full model.
export default async function ApiIndex() {
  const nss = namespaceSummaries();
  const total = nss.reduce((n, ns) => n + ns.count, 0);
  return (
    <>
      <title>API Reference — effect-pm</title>
      <article className="prose">
        <h1>API Reference</h1>
        <p>
          {total} public symbols across {nss.length} namespaces, each signature resolved from the
          TypeScript type checker. Pick a namespace:
        </p>
        <div className="api-index">
          {nss.map((ns) => (
            <a className="api-index-item" key={ns.entry} href={`/api/${slugForEntry(ns.entry)}`}>
              <span className="api-index-name">{ns.entry}</span>
              <span className="api-index-count">{ns.count}</span>
            </a>
          ))}
        </div>
      </article>
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
