{#install title="Installation & Setup" appliesTo=all}
# Installation & Setup

effect-pm is published as **`@nikscripts/effect-pm`**. It builds on Effect, so you bring your own
`effect` version as a peer dependency — the toolkit pins a range, you pick the exact release.

## Requirements

- **Node.js ≥ 20.19**
- **Effect** `^4.0.0-beta.92` — a peer dependency, installed alongside (below).

## Install

``` install
@nikscripts/effect-pm effect
```

That's the core: [queues](/docs/queues), [processes](/docs/processes), [resources](/docs/creating-a-resource),
and serving them over RPC. `@effect/platform-node` — used when you serve a resource over HTTP — ships as
a dependency, so it's already there; add it directly only if your setup requires every import to be a
declared dependency.

### Dashboards (optional)

The web, TUI, and CLI dashboards (`@nikscripts/effect-pm/web`, `/tui`, `/cli`) render with React, so add
it — plus `recharts` for the charts — when you use them:

``` install
react react-dom recharts
```

## Setup

effect-pm is pure Effect — no config files, no scaffolding. You wire it in code and run it with an
Effect runtime. A minimal Node entry point:

{.twoslash}
``` ts
import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"

const main = Effect.log("effect-pm is running")

NodeRuntime.runMain(main)
```

Provide your resource layers to `main` (`Effect.provide`) and they start and stop with it.

### Setting up nodes

If your app spans more than one runtime — a worker draining a queue here, a scheduler filling it there —
name each runtime a **node**, carrying the port it's served on. Nodes are how resources reach each other
across runtimes:

{.twoslash}
``` ts
import * as Resource from "@nikscripts/effect-pm/Resource"

class Worker extends Resource.Node<Worker>("app/Worker", 3001) {}
class Scheduler extends Resource.Node<Scheduler>("app/Scheduler", 3002) {}
```

A single-runtime app needs none of this — you declare nodes only when you serve a resource or mesh
resources across runtimes. See **[Fleets & Peers](/docs/fleets-and-peers)** for the multi-node story.

## Next

Head to **[Core Concepts](/docs/core-concepts)** for the mental model, or jump straight into
**[Creating a Resource](/docs/creating-a-resource)**.
