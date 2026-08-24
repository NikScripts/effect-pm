{#install title="Installation" done="api previews types" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version has navigation, search,
> and live type previews at <https://dev.hyperlink.cool/docs/install>.
<!-- docs-site-link:end -->
# Installation

hyperlink-ts is published as **`hyperlink-ts`**. It builds on Effect, so you bring your own
`effect` version as a peer dependency (the toolkit pins a range; you pick the exact release).

{.note}
**Pre-1.0 beta** (`0.9.0-beta`, tracking Effect's own beta). It's stable enough to build on, but shapes
can still change between betas. Nothing is frozen until 1.0 (there's no `@since` yet).

## Requirements

- **Node.js ≥ 20.19**
- **Effect** `^4.0.0-beta.102` (peer dependency, installed alongside below)

## Install

``` install
hyperlink-ts effect
```

That's enough for day one: define Hyperlink Services, use the included WorkPool / Daemon / Gate
kinds, and listen with `Node.http` / `Node.ws` / `Node.unix` (see
[Managing Layers](/docs/managing-layers)). No separate platform recipe for the common case.
`@effect/platform-node` already ships as a dependency of `hyperlink-ts`.

## Additional dependencies

Beyond `effect`, some entry points want extra peers. Install them **only when you use that entry
point**. Nothing here is required for core Hyperlink work.

**Other runtimes** (Bun / Deno) need their platform HTTP package when you serve outside Node:

`@effect/platform-bun`\
`@effect/platform-deno`

**Dashboards** render with React:

| Using | Also install |
|-------|--------------|
| `/web` Web dashboard | `react`, `react-dom`, `recharts`, `@tanstack/react-table` |
| `/tui` Terminal dashboard | `react`, `ink` |
| `/ui` Shared dashboard core | pulled in by `/web` / `/tui`, no extra install if you only use those |

Install them the same way, for the full web dashboard:

``` install
react react-dom recharts @tanstack/react-table
```

## The package surface

Each area is a tree-shakeable subpath under `hyperlink-ts/*`. Import only what you use:

- **`/Hyperlink`**: build your own Hyperlink Service
- **`/WorkPool`**, **`/Daemon`**, **`/Gate`**, **`/ShardMap`**: included Hyperlink Services
- **`/Store`**: Soft journals (`Store.Service`, `Daemon.store` / `WorkPool.store` / …)
- **`/DurableWorkPoolStore`**, **`/HistoryStore`**, **`/storage/sqlite`**: WorkPool durability + history backfill (SQL)
- **`/ui`**: shared dashboard core (data, routing, atoms) used by web and TUI
- **`/web`**, **`/tui`**, **`/cli`**: web dashboard, terminal dashboard, CLI
- **`hyperlink-ts`**: the barrel (everything under short names)

## TypeScript

hyperlink-ts ships ESM with bundled types. Your `tsconfig.json` needs modern module resolution and strict
mode, the same settings Effect itself wants:

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

**Effect Language Service**, richer diagnostics, type extraction, and refactors. Install and add the
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
path (`globalDate`, `globalConsole`, `globalTimers`, `asyncFunction`, `newPromise`, …), those
primitives are correct in UI code, wrong in Effect-domain code.

**Prettify TS**, editor extension `mylesmurphy.prettify-ts`, so type hovers expand into readable
shapes instead of a collapsed `…`. Nearly every type in hyperlink-ts reads better through it.

## Tags vs runtime (bundler-safe split)

Keep the **tag** (identity + contract) separate from the **runtime** (layers, `serve` /
`httpServer`, storage, native adapters). A browser or dashboard bundle imports only the tag; the
engine, SQL adapters, and Node bits never get pulled in.

``` ts
// tags.ts — browser-safe. Import namespaces from their subpaths.
import * as WorkPool from "hyperlink-ts/WorkPool"
import * as Daemon from "hyperlink-ts/Daemon"
import { Schema } from "effect"

const EmailJob = Schema.Struct({ to: Schema.String })

export class Emails extends WorkPool.Service<Emails>()("app/Emails", { payload: EmailJob }) {}
export class Digest extends Daemon.Service<Digest>()("app/Digest") {}
```

``` ts
// runtime.ts — Node OS edge only. Layers, serve, storage.
import { Effect } from "effect"
import * as WorkPool from "hyperlink-ts/WorkPool"
import { Emails } from "./tags"

declare const sendEmail: (job: { readonly to: string }) => Effect.Effect<void>

export const EmailsLive = WorkPool.layer(Emails, { effect: sendEmail })
```

If a file calls `Layer.provide` / `serve` / `httpServer` / a storage adapter, it belongs in
**runtime**, not beside client/widget imports. Subpath imports (`hyperlink-ts/WorkPool`,
`/Daemon`, …) tree-shake per member.

## Next

Head to **[Core Concepts](/docs/core-concepts)** for the mental model, or jump straight into
**[Creating a Hyperlink Service](/docs/creating-a-hyperlink)**.
