import { ApiSymbolCard } from "../../../components/ApiSymbol.js";
import { allSymbolPaths, findSymbol, slugForEntry } from "../../../lib/api.js";
import { loadHighlighter } from "../../../lib/highlight.js";

// One symbol, in full: /api/QueueResource/EffectContext. Small pages — the heavy Shiki markup is
// scoped to a single symbol instead of the whole namespace on one page.
export default async function ApiSymbolPage({
  namespace,
  symbol,
}: {
  namespace: string;
  symbol: string;
}) {
  const found = findSymbol(namespace, symbol);
  if (found === undefined)
    return (
      <p className="prose">
        Not found: {namespace}.{symbol}
      </p>
    );
  await loadHighlighter();
  return (
    <>
      <title>{`${found.symbol.qualifiedName} — API — effect-pm`}</title>
      <article className="prose">
        <p className="api-back">
          <a href={`/api/${slugForEntry(found.ns.entry)}`}>← {found.ns.entry}</a>
        </p>
        <ApiSymbolCard s={found.symbol} />
      </article>
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV
    ? ({ render: "dynamic" } as const)
    : ({
        render: "static",
        staticPaths: allSymbolPaths().map(([ns, s]) => [ns, s]),
      } as const);
