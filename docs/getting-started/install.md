{#install title="Installation" status="draft" done="api previews types" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://hyperlink.cool/docs/install>.
<!-- docs-site-link:end -->
# Installation

hyperlink-ts is published as **`hyperlink-ts`**. It builds on Effect, so you bring your own
`effect` version as a peer dependency — the toolkit pins a range, you pick the exact release.

{.note}
**Pre-1.0 beta** (`0.9.0-beta`, tracking Effect's own beta). It's stable enough to build on, but shapes
can still change between betas — nothing is frozen until 1.0 (there's no `@since` yet).

## Requirements

- **Node.js ≥ 20.19**
- **Effect** `^4.0.0-beta.98` — a peer dependency, installed alongside (below).

## Install

``` install
hyperlink-ts effect
```

That's the core — Hyperlink Services, included WorkPool / Daemon / Gate kinds, and serving them over RPC.

## Additional dependencies

Beyond `effect`, some entry points want extra peers. Install them **only when you use that entry
point** — nothing here is needed for core Hyperlink work.

**Serving over HTTP** needs a platform HTTP server. Pick the one that matches your runtime —
`@effect/platform-node` already ships as a dependency, so it's there for Node:

`@effect/platform-node`\
`@effect/platform-bun`\
`@effect/platform-deno`

**Dashboards** render with React:

| Using | Also install |
|-------|--------------|
| `/web` Web dashboard | `react`, `react-dom`, `recharts`, `@tanstack/react-table` |
| `/tui` Terminal dashboard | `react`, `ink` |
| `/ui` Shared dashboard core | pulled in by `/web` / `/tui` — no extra install if you only use those |

Install them the same way — for the full web dashboard:

``` install
react react-dom recharts @tanstack/react-table
```

## The package surface

Each area is a tree-shakeable subpath under `hyperlink-ts/*` — import only what you use:

- **`/Hyperlink`** — build your own Hyperlink Service
- **`/WorkPool`**, **`/Daemon`**, **`/Gate`**, **`/ShardMap`** — included Hyperlink Services
- **`/Store`** — durable storage
- **`/ui`** — shared dashboard core (data, routing, atoms) used by web and TUI
- **`/web`**, **`/tui`**, **`/cli`** — web dashboard, terminal dashboard, CLI
- **`hyperlink-ts`** — the barrel: everything under short names

## TypeScript

hyperlink-ts ships ESM with bundled types. Your `tsconfig.json` needs modern module resolution and strict
mode — the same settings Effect itself wants:

``` json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "target": "ES2022"
  }
}
```

(`"NodeNext"` works too if you're not on a bundler.)

## Editor setup

Two one-time additions make the whole experience better:

**Effect Language Service** — Effect's TypeScript plugin: richer diagnostics, type extraction, and
refactors (our own standards are checked with it). Add it to `tsconfig.json`:

``` json
{
  "compilerOptions": {
    "plugins": [{ "name": "@effect/language-service" }]
  }
}
```

and install the package:

``` install
-D @effect/language-service
```

### Diagnostic rulesets

The language service is more than nicer hovers — it enforces a **ruleset**. It's worth knowing there
are several, because the right rules for Effect-domain code are not the right rules for a browser UI.

**What hyperlink-ts's own source enforces.** Effect language-service diagnostics are `error` by
default — including `anyUnknownInErrorContext`, `missingLayerContext`, and `effectDoNotation`.
`serviceNotAsClass` is also `error`; the only allowed silence is a next-line off at a real
`Context.Service` / `Context.Tag` **factory**. `strictEffectProvide` is `message` in both Effect-domain
typecheck projects: it still surfaces in the editor / `tsc` output, but does not fail the build. So
our Effect source is held to Effect's idioms — no raw `Date` / `console` / `setTimeout` / `fetch` /
`Math.random` / `process.env` outside Effect, `Schema` over hand-rolled JSON, pipeables over nesting,
typed error channels, and so on. `typecheck` runs several passes:

| Config | Scope | Notes |
|--------|-------|-------|
| `tsconfig.json` | `src`, `test`, `examples` (excludes UI trees) | full diagnostic set; `strictEffectProvide: message` |
| `tsconfig.src.strict-effect-provide.json` | Effect-domain `src/**` | same severities |
| `src/ui/tsconfig.json` | shared dashboard core | relaxed Effect-purity rules |
| `src/web/tsconfig.json` | web dashboard (+ `src/ui`) | relaxed Effect-purity rules |
| `src/tui/tsconfig.json` | terminal dashboard | relaxed Effect-purity rules |

**UI / React code is a different ruleset.** A handful of Effect rules assume Effect-domain code and
are wrong for a UI layer, where raw `Date.now()`, `console`, `setTimeout`, `fetch` and `async` event
handlers *are* the correct primitives (`globalDate`, `globalConsole`, `globalTimers`, `globalFetch`,
`globalRandom`, `asyncFunction`, plus `newPromise` / `nodeBuiltinImport` where the UI tsconfigs turn
them off). Shared dashboard logic lives under **`src/ui`**; the **`src/web`** and **`src/tui`**
shells each have their own `tsconfig` with that relaxed plugin config. The root config **excludes**
`src/ui/**`, `src/web/**`, and `src/tui/**` so the editor and `typecheck` resolve those trees to the
UI configs. Declaration builds for the UI entries point at those configs too (see `tsup.config.ts`).

{.note}
A bundler build (`tsup`/Vite) doesn't mind the split — it compiles from an entry, not the config's
`include`. The wrinkle: tsup's `.d.ts` step runs the plugin too, so each UI entry's declaration build
is pointed at the matching UI `tsconfig`, not the strict root.

The same layer also gets a **React ESLint ruleset** — `eslint-plugin-react` + `eslint-plugin-react-hooks`
(`rules-of-hooks` / `exhaustive-deps`) with browser globals — scoped to `src/web` and `src/tui`, since
the base ESLint config only lints Effect-domain `.ts`.

**What to do in your project.** Add the plugin with its **defaults** — you don't need our strict
severities to benefit, and you can ratchet individual rules up to `error` as you adopt them. If you
have a **browser/React layer**, give it its own `tsconfig` that turns the browser-global and
`asyncFunction` rules off for that path (keep the strict set on your Effect-domain code), and give it
the React ESLint plugins.

**Prettify TS** — the editor extension `mylesmurphy.prettify-ts`, so type hovers expand into readable
shapes instead of a collapsed `…`. Nearly every type in hyperlink-ts reads better through it.

## Next

Head to **[Core Concepts](/docs/core-concepts)** for the mental model, or jump straight into
**[Creating a Hyperlink Service](/docs/creating-a-hyperlink)**.
