import { ApiSymbolRow } from "../../../../components/ApiSymbol.js";
import { PageMeta } from "../../../../components/PageMeta.js";
import { ModuleAside } from "../../../../components/ApiAside.js";
import { moduleSummary, packages } from "../../../../lib/api-data.js";
import { groupSymbols } from "../../../../lib/api-groups.js";
import { runServer } from "../../../../lib/runtime.js";

// A module page — its symbols in sections (no Shiki, so it stays small): curated @category
// groups where the source tags them, kind buckets otherwise (see lib/api-groups.ts). Loads only
// this module's summary file; each row links to the symbol's own page.
export default async function ApiModulePage({ pkg, module }: { pkg: string; module: string }) {
  const m = await runServer(moduleSummary(pkg, module));
  if (m === undefined)
    return (
      <p className="prose">
        Module not found: {pkg}/{module}
      </p>
    );
  const groups = groupSymbols(m.symbols);
  const sectioned = groups.length > 1;
  return (
    <>
      <PageMeta
        title={`${m.entry} — API — Hyperlink`}
        description={`API reference for the ${m.entry} module: ${
          m.symbols.length
        } exported symbols${
          groups.length > 1 ? ` across ${groups.map((g) => g.label).join(", ")}` : ""
        }.`}
      />
      <article className="prose">
        <p className="api-back">
          <a href={`/api/${pkg}`}>← {m.package}</a>
        </p>
        <h1 className="api-ns-title">
          {m.entry}
          <span className="api-ns-count">{m.symbols.length}</span>
        </h1>
        {sectioned ? (
          <nav className="api-group-toc" aria-label="Symbol groups">
            {groups.map((g) => (
              <a key={g.anchor} href={`#${g.anchor}`}>
                {g.label}
                <span className="api-ns-count">{g.symbols.length}</span>
              </a>
            ))}
          </nav>
        ) : null}
        {groups.map((g) => (
          <section key={g.anchor} id={g.anchor === "" ? undefined : g.anchor}>
            {sectioned ? <h2 className="api-group-title">{g.label}</h2> : null}
            <div className="api-rows">
              {g.symbols.map((s) => (
                <ApiSymbolRow key={s.name} s={s} href={s.url} />
              ))}
            </div>
          </section>
        ))}
      </article>
      <ModuleAside groups={groups} />
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV
    ? ({ render: "dynamic" } as const)
    : ({
        render: "static",
        staticPaths: (await runServer(packages())).flatMap((p) =>
          p.modules.map((m) => [p.slug, m.slug] as const)
        ),
      } as const);
