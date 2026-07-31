{#lifecycle title="Lifecycle" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/lifecycle>.
<!-- docs-site-link:end -->
# Lifecycle — building blocks for services + tools

`hyperlink-ts/Lifecycle` is a **small protocol** any HyperService can adopt. Toolkit kinds
(WorkPool, Daemon) use the same blocks as an app-authored service — no kind-specific helpers
in the Lifecycle module. Generic CLI / TUI / dashboard code discovers controls and the badge
via `methodMeta`, without WorkPool-vs-Daemon switches.

## Building blocks

| Block | What it is |
|-------|------------|
| **`Lifecycle.Role`** | PascalCase method annotation: `"State"`, `"Start"`, `"Pause"`, `"Resume"`, `"Stop"` |
| **`Lifecycle.State`** | PascalCase wire vocabulary + Schema: `"Idle"`, `"Running"`, `"Paused"`, `"Draining"`, `"Off"` |
| **Method pipes** | `Lifecycle.pause` / `start` / `resume` / `stop` / `state` — stamp a Spec leaf |
| **`Hyperlink.deferStart`** | Layer pipe (on Hyperlink) — stay Idle until `Start` |

## Author a participating service

Expose a reactive field whose success schema **is** `Lifecycle.State`, stamped with
`Lifecycle.state`. Stamp commands the same way:

```ts
import * as Lifecycle from "hyperlink-ts/Lifecycle"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Schema } from "effect"

const spec = {
  // domain snapshot (whatever you need)
  status: Hyperlink.ref(MyStatus).annotate({ description: "Domain status." }),

  // shared protocol — tools look for lifecycle === "State"
  lifecycle: Hyperlink.ref(Lifecycle.State)
    .annotate({ description: "Lifecycle badge." })
    .pipe(Lifecycle.state),

  start: Hyperlink.effect(Schema.Void)
    .annotate({ description: "Begin." })
    .pipe(Lifecycle.start),
  pause: Hyperlink.effect(Schema.Void)
    .annotate({ description: "Hold." })
    .pipe(Lifecycle.pause),
  resume: Hyperlink.effect(Schema.Void)
    .annotate({ description: "Continue." })
    .pipe(Lifecycle.resume),
  stop: Hyperlink.effect(Schema.Void)
    .annotate({ description: "Stop.", destructive: true })
    .pipe(Lifecycle.stop),
}
```

Sugar: `.pipe(Lifecycle.lifecycle("Pause"))`. Combinators are camelCase; **annotation /
wire strings are PascalCase**.

How you *derive* `Lifecycle.State` from internal engine fields is the service's business
(map in the impl). Lifecycle does not ship `fromWorkPool` / `fromDaemon`.

## Tools

```ts
import { methodMeta, specOf } from "hyperlink-ts"

for (const [name, m] of Object.entries(specOf(Tag))) {
  const role = methodMeta(m).lifecycle // "Pause" | "State" | …
  // Role "State" → read the ref (success schema is Lifecycle.State)
  // Role "Pause" → invoke the void command
}
```

## Deferred start (layer)

```ts
WorkPool.serve(Jobs, { effect }).pipe(Hyperlink.deferStart)
Daemon.layer(Sweeper, { effect }).pipe(Hyperlink.deferStart)
```

WorkPool resolve order: call-site `autoStart` when set → else `!DeferStart` → default
`true`. Deferred WorkPools report `lifecycle: "Idle"` (engine `phase: "idle"`) and stay
**ready** for dial / verify; `Draining` / `Off` are not ready.

## See also

- [Policy](/docs/policy) — dial / verify / conflict / yield (different grain)
- [WorkPool](/docs/work-pools) · [Daemons](/docs/daemons)
- [Observation and control](/docs/observation-and-control)
