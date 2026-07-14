import { ApiSymbolRow } from "../../../components/ApiSymbol.js";
import { namespaceBySlug, namespaces, slugForEntry } from "../../../lib/api.js";

// A namespace page — a light list of its symbols (no Shiki here, so the page stays small); each
// row links to the symbol's own page.
export default async function ApiNamespacePage({ namespace }: { namespace: string }) {
  const ns = namespaceBySlug(namespace);
  if (ns === undefined) return <p className="prose">Namespace not found: {namespace}</p>;
  return (
    <>
      <title>{`${ns.entry} — API — effect-pm`}</title>
      <article className="prose">
        <p className="api-back">
          <a href="/api">← API Reference</a>
        </p>
        <h1 className="api-ns-title">
          {ns.entry}
          <span className="api-ns-count">{ns.symbols.length}</span>
        </h1>
        <div className="api-rows">
          {ns.symbols.map((s) => (
            <ApiSymbolRow key={s.name} s={s} href={`/api/${slugForEntry(ns.entry)}/${s.name}`} />
          ))}
        </div>
      </article>
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV
    ? ({ render: "dynamic" } as const)
    : ({
        render: "static",
        staticPaths: namespaces().map((ns) => slugForEntry(ns.entry)),
      } as const);
