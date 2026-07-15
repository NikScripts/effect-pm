import { packageBySlug, packages } from "../../../lib/api-data.js";

// A package page — the list of its modules. Loads only the top index (module names + counts).
export default async function ApiPackagePage({ pkg }: { pkg: string }) {
  const p = packageBySlug(pkg);
  if (p === undefined) return <p className="prose">Package not found: {pkg}</p>;
  return (
    <>
      <title>{`${p.name} — API — effect-pm`}</title>
      <article className="prose">
        <p className="api-back">
          <a href="/api">← API Reference</a>
        </p>
        <h1>{p.name}</h1>
        <div className="api-index">
          {p.modules.map((m) => (
            <a className="api-index-item" key={m.slug} href={`/api/${p.slug}/${m.slug}`}>
              <span className="api-index-name">{m.entry}</span>
              <span className="api-index-count">{m.count}</span>
            </a>
          ))}
        </div>
      </article>
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV
    ? ({ render: "dynamic" } as const)
    : ({ render: "static", staticPaths: packages().map((p) => p.slug) } as const);
