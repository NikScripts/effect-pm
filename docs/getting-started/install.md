{#install title="Installation" status="draft" done="api previews types" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/install>.
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
- **`/Store`** — Soft journals (`Store.Service`, `Daemon.store` / `WorkPool.store` / …)
- **`/DurableWorkPoolStore`**, **`/HistoryStore`**, **`/storage/sqlite`** — WorkPool durability + history backfill (SQL)
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

**Effect Language Service** — richer diagnostics, type extraction, and refactors. Install and add the
plugin:

``` install
-D @effect/language-service
```

``` json
{
  "compilerOptions": {
    "plugins": [{ "name": "@effect/language-service" }]
  }
}
```

Defaults are enough to start. Ratchet individual rules to `error` as you adopt them. If you have a
**browser / React** layer, give it its own `tsconfig` that turns Effect purity rules off for that
path (`globalDate`, `globalConsole`, `globalTimers`, `asyncFunction`, `newPromise`, …) — those
primitives are correct in UI code, wrong in Effect-domain code.

**Prettify TS** — editor extension `mylesmurphy.prettify-ts`, so type hovers expand into readable
shapes instead of a collapsed `…`. Nearly every type in hyperlink-ts reads better through it.

## Next

Head to **[Core Concepts](/docs/core-concepts)** for the mental model, or jump straight into
**[Creating a Hyperlink Service](/docs/creating-a-hyperlink)**.
