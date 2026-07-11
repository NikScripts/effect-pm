{#public-vs-internal title="Public vs internal surface" order=30 appliesTo=src}
# Public vs internal surface

The companion to *Module layout*: that chapter shapes a single module; this one draws the
public/internal boundary and governs how the surface grows as modules get large.

{#public-is-app-imported .must appliesTo=src}
## Public is what apps import; internal is package-only

**Public** = a symbol an app imports, via `@nikscripts/effect-pm`, a documented subpath, or a bin
entry. **Internal** (`src/internal/`) = package-only wiring: never exported from the barrel, no
subpath, never imported by an app.

``` ts
// ✅ public
import * as Process from "@nikscripts/effect-pm/Process"

// ❌ internal — apps must never reach here
import { makeQueueEffect } from "@nikscripts/effect-pm/internal/queueResource"
```

{#never-split-namespace .must appliesTo=src}
## Never split a namespace to escape file size

Size is not a reason to fan one namespace across public files. A namespace is always one public
file, however large — the growth goes to `internal/` (heavy implementation, per *Module layout*) or to a
separate concern (below), never to a second public file for the same namespace.

{.note}
A 15,000-line module is fine: Effect's `Effect.ts` and `Schema.ts` are each ~15k lines in a single
file.

{#concern-becomes-sibling .must appliesTo=src}
## A distinct concern becomes its own sibling namespace

When a separable concern grows, split it into a **sibling module named by a shared prefix** — its
own file, namespace, and import — not sub-sections of a mega-namespace.

{.note}
`Schema` sits beside `SchemaAST`, `SchemaParser`, `SchemaIssue`, `SchemaGetter`,
`SchemaTransformation`, `SchemaRepresentation`; `Rpc` beside `RpcClient`, `RpcServer`, `RpcGroup`,
`RpcSchema`. Related by name, independent as modules.

{#domain-family-subdir .must appliesTo=src}
## A domain family is a subdirectory with its own barrel and internal/

A group of related modules that ship as one import surface lives in a **subdirectory that is a
single subpath**, with its **own `index.ts` barrel and its own `internal/`**.

{.note}
`unstable/rpc/` = `Rpc.ts` + `RpcClient.ts` + `RpcServer.ts` + … + `index.ts` + `internal/`,
exported as the one subpath `unstable/rpc`. Each domain — `rpc`, `sql`, `http`, `persistence`,
`eventlog` — is a self-contained folder.

{#substrate-vs-consumer .must appliesTo=src}
## Substrate gets its own home; consumer-specific wiring stays with the consumer

The placement test. Reusable substrate used by several engines gets its own module or family; wiring
specific to one consumer stays in *that* consumer's module or its `internal/`.

{.note}
Persistence primitives shared across engines stand alone (as the `persistence` and `eventlog`
domains do); an engine's private wiring lives in its own `internal/`.

This decides where persistence code lives: the shared, type-agnostic spine is substrate (its own
home, today `src/internal/store/`); a facet only one resource uses co-locates with that resource.
Group facets under a `store/` family only when they're a reusable surface in their own right.
