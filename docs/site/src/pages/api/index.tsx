import { PageMeta } from "../../components/PageMeta.js";
import { packages } from "../../lib/api-data.js";
import { runServer } from "../../lib/runtime.js";

// The API landing — the list of documented packages. Loads only the tiny top index.
export default async function ApiIndex() {
  const pkgs = await runServer(packages());
  return (
    <>
      <PageMeta
        title="API Reference — effect-pm"
        description="Compiler-accurate API reference for effect-pm and its effect dependencies."
      />
      <article className="prose">
        <h1>API Reference</h1>
        <p>
          {pkgs.length} package{pkgs.length === 1 ? "" : "s"}, each generated from its TypeScript
          types. Pick a package:
        </p>
        <div className="api-index">
          {pkgs.map((p) => (
            <a className="api-index-item" key={p.slug} href={`/api/${p.slug}`}>
              <span className="api-index-name">{p.name}</span>
              <span className="api-index-count">{p.modules.reduce((n, m) => n + m.count, 0)}</span>
            </a>
          ))}
        </div>
      </article>
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV ? ({ render: "dynamic" } as const) : ({ render: "static" } as const);
