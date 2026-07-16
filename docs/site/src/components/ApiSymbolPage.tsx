import { ApiSymbolCard } from "./ApiSymbol.js";
import { readSourceFile, symbolDetail, symbolSourceHtml } from "../lib/api-data.js";
import { loadHighlighter } from "../lib/highlight.js";
import { runServer } from "../lib/runtime.js";

// One symbol, in full: /api/<pkg>/<module>/<symbol>. Loads only this symbol's file; the heavy
// Shiki/twoslash markup is scoped to a single symbol. Shared by two routes: the static
// /api/effect-pm/… route (our own package, pre-rendered at build) and the dynamic /api/[pkg]/… route
// (the effect dependencies, SSR — too many/too heavy to pre-render).
export async function ApiSymbolPage({
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
