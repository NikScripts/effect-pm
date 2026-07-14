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
point** — nothing here is needed for core resources:

| Using | Also install |
|-------|--------------|
| Core — `/Resource`, `/QueueResource`, `/Process`, `/ShardMap`, `/Store` | *nothing beyond `effect`* |
| Serving over HTTP | `@effect/platform-node` (bundled for Node; swap `@effect/platform-bun` / `-deno` per runtime) |
| Web dashboard — `/web` | `react`, `react-dom`, `recharts`, `@tanstack/react-table` |
| Terminal dashboard — `/tui` | `react`, `ink` |
| CLI — `/cli` | *nothing* — uses Effect's own CLI |

Install them the same way — for the full web dashboard:

``` install
react react-dom recharts @tanstack/react-table
```

## Verify it works

A ten-second check that everything resolved — run it with `tsx` (or your runner); it logs and exits:

{.twoslash}
``` ts
import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

NodeRuntime.runMain(Effect.log("effect-pm is installed"))
```

## The package surface

Each area is its own tree-shakeable subpath — import only what you use:

- **`@nikscripts/effect-pm/Resource`** — build your own cross-runtime resource
- **`.../QueueResource`** (and `/CustomQueueResource`) — a priority work queue
- **`.../Process`** — scheduled and long-running processes
- **`.../ShardMap`** — keyed state, sharded across a fleet
- **`.../Store`** — durable storage
- **`.../web`, `/tui`, `/cli`** — dashboards over any resource
- **`@nikscripts/effect-pm`** — the barrel: everything above under short names

Plus more for advanced use — `/Group`, `/Telemetry`, `/ApiMetrics`, `/DynamicConfig`, `/HttpApiResource`, and others.

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
