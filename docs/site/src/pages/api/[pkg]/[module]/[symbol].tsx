import { ApiSymbolCard } from "../../../../components/ApiSymbol.js";
import { readSourceFile, symbolDetail, symbolSourceHtml } from "../../../../lib/api-data.js";
import { loadHighlighter } from "../../../../lib/highlight.js";
import { runServer } from "../../../../lib/runtime.js";

// One symbol, in full: /api/effect-pm/QueueResource/Tag. Loads only this symbol's file; the heavy
// Shiki/twoslash markup is scoped to a single symbol.
export default async function ApiSymbolPage({
  pkg,
  module,
  symbol,
}: {
  pkg: string;
  module: string;
  symbol: string;
}) {
  const s = await runServer(symbolDetail(pkg, module, symbol));
  if (s === undefined)
    return (
      <p className="prose">
        Not found: {pkg}/{module}/{symbol}
      </p>
    );
  await loadHighlighter();
  // Source panel: our own package twoslashes live from the file text; effect-smol deps (repos/*) use
  // the precomputed twoslash HTML from gen-hovers (twoslashing them live is too slow per symbol).
  const isDep = s.source.file.startsWith("repos/");
  const fileText = isDep ? undefined : await runServer(readSourceFile(s.source.file));
  const sourceHtml = isDep ? await runServer(symbolSourceHtml(pkg, module, symbol)) : undefined;
  return (
    <>
      <title>{`${s.qualifiedName} — API — effect-pm`}</title>
      <article className="prose">
        <p className="api-back">
          <a href={`/api/${pkg}/${module}`}>← {s.entry}</a>
        </p>
        <ApiSymbolCard s={s} fileText={fileText} sourceHtml={sourceHtml} />
      </article>
    </>
  );
}

// Rendered on demand (SSR), never pre-rendered: even scoped to effect + platform-node +
// sql-sqlite-node, effect core alone is ~3900 symbol pages with heavy twoslash source panels.
// Statically pre-rendering them overflows the build's serializer (V8 string cap) and produces a
// multi-GB dist. Served dynamically, the data is read per request (cwd paths resolve in the server).
export const getConfig = async () => ({ render: "dynamic" }) as const;
