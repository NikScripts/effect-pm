import { Schema } from "effect";
import * as Page from "last-ts/Page";
import { PageMeta } from "../../../../components/PageMeta.js";
import { moduleSummary, packageBySlug, type ModuleInfo } from "../../../../lib/api-data.js";
import { urls } from "../../../../lib/siteRoutes.js";
import { runServer } from "../../../../lib/runtime.js";
import * as Router from "../../../../ui/Router.js";

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
          <Router.Link
            className="api-hero"
            key={m.slug}
            to={urls.api.module(p.slug, m.slug)}
          >
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
          </Router.Link>
        ))}
      </div>
      <h2 className="api-pkg-sub">All modules</h2>
      <div className="api-minis">
        {rest.map((m) => (
          <Router.Link
            className="api-mini"
            key={m.slug}
            to={urls.api.module(p.slug, m.slug)}
            title={m.summary !== undefined ? plain(m.summary) : undefined}
          >
            <span className="api-mini-name">{m.entry}</span>
            <span className="api-index-count">{m.count}</span>
          </Router.Link>
        ))}
      </div>
    </>
  );
};

// A package page — the list of its modules. Loads only the top index (module names + counts).
async function ApiPackageBody(props: { readonly params: { readonly pkg: string } }) {
  const { pkg } = props.params;
  const p = await runServer(packageBySlug(pkg));
  if (p === undefined) return <p className="prose">Package not found: {pkg}</p>;
  const total = p.modules.reduce((n, m) => n + m.count, 0);
  return (
    <>
      <PageMeta
        title={`${p.name} — API — Hyperlink`}
        description={`API reference for ${p.name}: ${p.modules.length} documented modules.`}
        path={urls.api.pkg(pkg)}
      />
      <article className="prose">
        <p className="api-back">
          <Router.Link to={urls.api.index()}>← API Reference</Router.Link>
        </p>
        <h1>{p.name}</h1>
        <p className="api-pkg-stats">
          {p.modules.length} modules · {total} documented exports
        </p>
        {pkg === "hyperlink-ts" ? (
          <HeroLayout p={p} />
        ) : (
          <div className="api-index">
            {p.modules.map((m) => (
              <Router.Link
                className="api-index-item"
                key={m.slug}
                to={urls.api.module(p.slug, m.slug)}
                title={m.summary !== undefined ? plain(m.summary) : undefined}
              >
                <span className="api-index-name">{m.entry}</span>
                <span className="api-index-count">{m.count}</span>
              </Router.Link>
            ))}
          </div>
        )}
      </article>
    </>
  );
}

// DEV-dynamic / prod-static render mode (+ staticPaths) is chosen on `waku.server.tsx`.
export class ApiPackagePage extends Page.make(
  { params: { pkg: Schema.String } },
  ApiPackageBody,
) {}
