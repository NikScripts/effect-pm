import { ApiSymbolCard } from "./ApiSymbol.js";
import { PageMeta } from "./PageMeta.js";
import { SymbolAside } from "./ApiAside.js";
import { readSourceFile, referencedBy, symbolDetail, symbolSourceHtml } from "../lib/api-data.js";
import { loadHighlighter } from "../lib/highlight.js";
import { runServer } from "../lib/runtime.js";
import { urls } from "../lib/siteRoutes.js";
import * as Router from "../ui/Router.js";

// `/api/<pkg>/<module>/<name>` → a compact display label: `Module.name`, plus the package when it
// differs from the page's own.
const refLabel = (url: string, ownPkg: string): string => {
  const parts = url.split("/");
  const pkg = parts[2] ?? "";
  const module = parts[3] ?? "";
  const name = parts[4] ?? url;
  const base = module === "top-level" ? name : `${module}.${name}`;
  return pkg === ownPkg ? base : `${base} (${pkg})`;
};

const MAX_REFS = 40; // chips shown; the rest collapse into a count

// One symbol, in full: /api/<pkg>/<module>/<symbol>. Loads only this symbol's file; the heavy
// Shiki/twoslash markup is scoped to a single symbol. Shared by two routes: the static
// /api/hyperlink-ts/… route (our own package, pre-rendered at build) and the dynamic /api/[pkg]/… route
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
  const refs = await runServer(referencedBy(s.url));
  return (
    <>
      <PageMeta
        title={`${s.qualifiedName} — API — Hyperlink`}
        description={
          s.summary !== "" ? s.summary : `API reference for ${s.qualifiedName} (${s.kind}).`
        }
        path={s.url}
      />
      <article className="prose">
        <p className="api-back">
          <Router.Link to={urls.api.module(pkg, module)}>← {s.entry}</Router.Link>
        </p>
        <ApiSymbolCard s={s} fileText={fileText} sourceHtml={sourceHtml} />
        {refs.length > 0 ? (
          <section className="api-source" id="referenced-by">
            <div className="api-source-head">
              Referenced by <span className="api-source-lines">{refs.length} symbols</span>
            </div>
            <div className="api-chips">
              {refs.slice(0, MAX_REFS).map((url) => (
                <Router.Link className="api-chip api-chip-ref" to={url} key={url}>
                  {refLabel(url, pkg)}
                </Router.Link>
              ))}
              {refs.length > MAX_REFS ? (
                <span className="api-chip">+{refs.length - MAX_REFS} more</span>
              ) : null}
            </div>
          </section>
        ) : null}
      </article>
      <SymbolAside s={s} pkg={pkg} module={module} refsCount={refs.length} />
    </>
  );
}
