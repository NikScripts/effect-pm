import { PageMeta } from "../../../components/PageMeta.js";
import { moduleSummary, packageBySlug, packages, type ModuleInfo } from "../../../lib/api-data.js";
import { runServer } from "../../../lib/runtime.js";

// JSDoc emphasis markers don't belong in chrome text.
const plain = (s: string): string =>
  s
    .replace(/\{@link\s+([^}|\s]+)(?:\s*\|\s*|\s+)?([^}]*?)\s*\}/g, (_m, target, text) =>
      String(text ?? "").trim() !== "" ? String(text).trim() : String(target)
    )
    .replace(/[`*]/g, "");

// The symbols worth naming on a hero card: canonical entry points first, then constructors.
const canonical = ["Tag", "Service", "make", "layer", "serve", "client", "ref"];
const heroChips = (
  symbols: ReadonlyArray<{ readonly name: string; readonly category?: string }>
): ReadonlyArray<string> => {
  const named = canonical.filter((n) => symbols.some((s) => s.name === n));
  const ctors = symbols
    .filter((s) => s.category === "constructors" && !named.includes(s.name))
    .map((s) => s.name);
  return [...named, ...ctors].slice(0, 5);
};

// Option C for OUR package: three flagship modules up top (largest surface), the rest in a
// compact grid. Dep packages keep the plain pill index — their story isn't ours to curate.
const HeroLayout = async ({ p }: { p: { slug: string; modules: ReadonlyArray<ModuleInfo> } }) => {
  const byCount = [...p.modules].sort((a, b) => b.count - a.count);
  const heroes = byCount.slice(0, 3);
  const heroNames = new Set(heroes.map((m) => m.slug));
  const rest = p.modules.filter((m) => !heroNames.has(m.slug));
  const chips = await Promise.all(
    heroes.map(async (m) => {
      const summary = await runServer(moduleSummary(p.slug, m.slug));
      return heroChips(summary?.symbols ?? []);
    })
  );
  return (
    <>
      <h2 className="api-pkg-sub">Start here</h2>
      <div className="api-heroes">
        {heroes.map((m, i) => (
          <a className="api-hero" key={m.slug} href={`/api/${p.slug}/${m.slug}`}>
            <div className="api-hero-top">
              <span className="api-hero-name">{m.entry}</span>
              <span className="api-index-count">{m.count}</span>
            </div>
            {m.summary !== undefined ? <p className="api-hero-desc">{plain(m.summary)}</p> : null}
            <div className="api-hero-syms">
              {chips[i]?.map((name) => (
                <span className="api-hero-chip" key={name}>
                  {name}
                </span>
              ))}
              <span className="api-hero-chip api-hero-more">
                +{m.count - (chips[i]?.length ?? 0)}
              </span>
            </div>
          </a>
        ))}
      </div>
      <h2 className="api-pkg-sub">All modules</h2>
      <div className="api-minis">
        {rest.map((m) => (
          <a
            className="api-mini"
            key={m.slug}
            href={`/api/${p.slug}/${m.slug}`}
            title={m.summary !== undefined ? plain(m.summary) : undefined}
          >
            <span className="api-mini-name">{m.entry}</span>
            <span className="api-index-count">{m.count}</span>
          </a>
        ))}
      </div>
    </>
  );
};

// A package page — the list of its modules. Loads only the top index (module names + counts).
export default async function ApiPackagePage({ pkg }: { pkg: string }) {
  const p = await runServer(packageBySlug(pkg));
  if (p === undefined) return <p className="prose">Package not found: {pkg}</p>;
  const total = p.modules.reduce((n, m) => n + m.count, 0);
  return (
    <>
      <PageMeta
        title={`${p.name} — API — effect-pm`}
        description={`API reference for ${p.name}: ${p.modules.length} documented modules.`}
      />
      <article className="prose">
        <p className="api-back">
          <a href="/api">← API Reference</a>
        </p>
        <h1>{p.name}</h1>
        <p className="api-pkg-stats">
          {p.modules.length} modules · {total} documented exports
        </p>
        {pkg === "effect-pm" ? (
          <HeroLayout p={p} />
        ) : (
          <div className="api-index">
            {p.modules.map((m) => (
              <a className="api-index-item" key={m.slug} href={`/api/${p.slug}/${m.slug}`}>
                <span className="api-index-name">{m.entry}</span>
                <span className="api-index-count">{m.count}</span>
              </a>
            ))}
          </div>
        )}
      </article>
    </>
  );
}

export const getConfig = async () =>
  import.meta.env.DEV
    ? ({ render: "dynamic" } as const)
    : ({
        render: "static",
        staticPaths: (await runServer(packages())).map((p) => p.slug),
      } as const);
