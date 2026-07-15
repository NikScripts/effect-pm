import { ApiSymbolRow } from "../../../../components/ApiSymbol.js";
import { moduleSummary, packages } from "../../../../lib/api-data.js";

// A module page — a light list of its symbols (no Shiki, so it stays small). Loads only this
// module's summary file; each row links to the symbol's own page.
export default async function ApiModulePage({ pkg, module }: { pkg: string; module: string }) {
  const m = moduleSummary(pkg, module);
  if (m === undefined)
    return (
      <p className="prose">
        Module not found: {pkg}/{module}
      </p>
    );
  return (
    <>
      <title>{`${m.entry} — API — effect-pm`}</title>
      <article className="prose">
        <p className="api-back">
          <a href={`/api/${pkg}`}>← {m.package}</a>
        </p>
        <h1 className="api-ns-title">
          {m.entry}
          <span className="api-ns-count">{m.symbols.length}</span>
        </h1>
        <div className="api-rows">
          {m.symbols.map((s) => (
            <ApiSymbolRow key={s.name} s={s} href={s.url} />
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
        staticPaths: packages().flatMap((p) => p.modules.map((m) => [p.slug, m.slug] as const)),
      } as const);
