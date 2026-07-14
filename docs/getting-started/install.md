{#install title="Installation" appliesTo=all}
# Installation

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

## Dashboards (optional)

The web, TUI, and CLI dashboards (`@nikscripts/effect-pm/web`, `/tui`, `/cli`) render with React, so add
it — plus `recharts` for the charts — when you use them:

``` install
react react-dom recharts
```

## Next

You're set. Head to **[Core Concepts](/docs/core-concepts)** for the mental model, or jump straight into
**[Creating a Resource](/docs/creating-a-resource)**.
