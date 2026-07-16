import { ApiSymbolCard } from "../../../../components/ApiSymbol.js";
import { readSourceFile, symbolDetail, symbolPaths } from "../../../../lib/api-data.js";
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
  // Read the source file for the twoslash panel — our package only; deps (repos/*) stay plain.
  const fileText = s.source.file.startsWith("repos/")
    ? undefined
    : await runServer(readSourceFile(s.source.file));
  return (
    <>
      <title>{`${s.qualifiedName} — API — effect-pm`}</title>
      <article className="prose">
        <p className="api-back">
          <a href={`/api/${pkg}/${module}`}>← {s.entry}</a>
        </p>
        <ApiSymbolCard s={s} fileText={fileText} />
      </article>
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV
    ? ({ render: "dynamic" } as const)
    : ({
        render: "static",
        staticPaths: (await runServer(symbolPaths())).map(([p, m, sym]) => [p, m, sym] as const),
      } as const);
