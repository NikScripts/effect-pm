{#install title="Installation" status="draft" done="api previews types" appliesTo=all}
# Installation

hyperlink-ts is published as **`hyperlink-ts`**. It builds on Effect, so you bring your own
`effect` version as a peer dependency — the toolkit pins a range, you pick the exact release.

{.note}
**Pre-1.0 beta** (`0.8.0-beta`, tracking Effect's own beta). It's stable enough to build on, but shapes
can still change between betas — nothing is frozen until 1.0 (there's no `@since` yet).

## Requirements

- **Node.js ≥ 20.19**
- **Effect** `^4.0.0-beta.92` — a peer dependency, installed alongside (below).

## Install

``` install
hyperlink-ts effect
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
| `/web` Web dashboard | `react`, `react-dom`, `recharts`, `@tanstack/react-table` |
| `/tui` Terminal dashboard | `react`, `ink` |

Install them the same way — for the full web dashboard:

``` install
react react-dom recharts @tanstack/react-table
```

## The package surface

Each area is a tree-shakeable subpath under `hyperlink-ts/*` — import only what you use:

- **`/Hyperlink`** — build your own resource
- **`/QueueResource`**, **`/Process`**, **`/ShardMap`** — ready-made resource kinds
- **`/Store`** — durable storage
- **`/web`**, **`/tui`**, **`/cli`** — dashboards
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

**What hyperlink-ts's own source enforces.** We run every diagnostic at `error` (a few deliberate
exceptions: `anyUnknownInErrorContext`, `missingLayerContext`, `serviceNotAsClass` are off;
`effectDoNotation` is a warning). So our source is held to Effect's idioms — no raw `Date` / `console` /
`setTimeout` / `fetch` / `Math.random` / `process.env` reached for outside Effect, `Schema` over
hand-rolled JSON, pipeables over nesting, typed error channels, and so on. `typecheck` actually runs
**two** passes:

| Config | Scope | Adds over the base |
|--------|-------|--------------------|
| `tsconfig.json` | `src`, `test`, `examples` | the full diagnostic set at `error` |
| `tsconfig.src.strict-effect-provide.json` | `src/**` only | `strictEffectProvide: error` — too noisy to demand of tests/examples |

**Browser / React code is a different ruleset.** A handful of these rules assume Effect-domain code
and are wrong for a browser/React layer, where raw `Date.now()`, `console`, `setTimeout`, `fetch` and
`async` event handlers *are* the correct primitives: `globalDate`, `globalConsole`, `globalTimers`,
`globalFetch`, `globalRandom`, `asyncFunction`. So our own `src/web` dashboard (and each React example
app) lives under its **own `tsconfig`** with those turned off — the `@effect/language-service` plugin is
configured **per `tsconfig`**, not per glob. The root config excludes `src/web`, and the browser config
is wired into `typecheck` and into the `web` bundle's declaration build, so UI code is checked under the
relaxed rules end-to-end with no inline exemptions.

{.note}
A bundler build (`tsup`/Vite) doesn't mind the split — it compiles from an entry, not the config's
`include`. The one wrinkle: tsup's `.d.ts` step runs the plugin too, so the `web` entry's declaration
build is pointed at the browser `tsconfig` (see `tsup.config.ts`), not the strict root.

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
**[Creating a Hyperlink](/docs/creating-a-resource)**.
