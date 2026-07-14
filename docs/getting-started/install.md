{#install title="Installation" appliesTo=all}
# Installation

effect-pm is published as **`@nikscripts/effect-pm`**. It builds on Effect, so you bring your own
`effect` version as a peer dependency — the toolkit pins a range, you pick the exact release.

{.note}
**Pre-1.0 beta** (`0.8.0-beta`, tracking Effect's own beta). It's stable enough to build on, but shapes
can still change between betas — nothing is frozen until 1.0 (there's no `@since` yet).

## Requirements

- **Node.js ≥ 20.19**
- **Effect** `^4.0.0-beta.92` — a peer dependency, installed alongside (below).

## Install

``` install
@nikscripts/effect-pm effect
```

That's the core — queues, processes, resources, and serving them over RPC.

## Additional dependencies

Beyond `effect`, some entry points want extra peers. Install them **only when you use that entry
point** — nothing here is needed for core resources.

**Serving over HTTP** needs a platform HTTP server. Pick the one that matches your runtime —
`@effect/platform-node` already ships as a dependency, so it's there for Node:

`@effect/platform-node`\
`@effect/platform-bun`\
`@effect/platform-deno`

**Dashboards** render with React:

| Using | Also install |
|-------|--------------|
| Web dashboard — `/web` | `react`, `react-dom`, `recharts`, `@tanstack/react-table` |
| Terminal dashboard — `/tui` | `react`, `ink` |

Install them the same way — for the full web dashboard:

``` install
react react-dom recharts @tanstack/react-table
```

## The package surface

Each area is a tree-shakeable subpath under `@nikscripts/effect-pm/*` — import only what you use:

- **`/Resource`** — build your own resource
- **`/QueueResource`**, **`/Process`**, **`/ShardMap`** — ready-made resource kinds
- **`/Store`** — durable storage
- **`/web`**, **`/tui`**, **`/cli`** — dashboards
- **`@nikscripts/effect-pm`** — the barrel: everything under short names

## TypeScript

effect-pm ships ESM with bundled types. Your `tsconfig.json` needs modern module resolution and strict
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

**Prettify TS** — the editor extension `mylesmurphy.prettify-ts`, so type hovers expand into readable
shapes instead of a collapsed `…`. Nearly every type in effect-pm reads better through it.

## Next

Head to **[Core Concepts](/docs/core-concepts)** for the mental model, or jump straight into
**[Creating a Resource](/docs/creating-a-resource)**.
