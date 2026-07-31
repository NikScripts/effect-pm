{#lifecycle title="Lifecycle" status="stable" done="api" appliesTo=all}
<!-- docs-site-link:begin -->
> [!NOTE]
> You're reading this page's **source**. The rendered version — with navigation, search,
> and live type previews — is at <https://dev.hyperlink.cool/docs/lifecycle>.
<!-- docs-site-link:end -->
# Lifecycle — contract roles + deferred start

Two cooperating surfaces for management tools and HyperService bring-up:

1. **`hyperlink-ts/Lifecycle`** — stamp Spec methods so generic widgets discover start / pause /
   resume / stop without hardcoding WorkPool vs Daemon names.
2. **`Hyperlink.deferStart`** — Policy-shaped **Layer** pipe that keeps the engine idle until
   `start` (WorkPool / Daemon). Not a Tag stamp; not [Policy](/docs/policy).

## Method roles (contract)

```ts
import * as Lifecycle from "hyperlink-ts/Lifecycle"
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import { Schema } from "effect"

pause: Hyperlink.effect(Schema.Void)
  .annotate({ description: "Pause processing." })
  .pipe(Lifecycle.pause),
```

| Combinator | `methodMeta(…).lifecycle` |
|------------|---------------------------|
| `Lifecycle.state` | `"state"` |
| `Lifecycle.start` | `"start"` |
| `Lifecycle.pause` | `"pause"` |
| `Lifecycle.resume` | `"resume"` |
| `Lifecycle.stop` | `"stop"` |

WorkPool and Daemon control specs ship with these stamps. Sugar:
`.pipe(Lifecycle.lifecycle("pause"))`.

### Shared state badge

`Lifecycle.State` is `idle | running | paused | draining | off`. Project kind-native
snapshots:

```ts
Lifecycle.fromWorkPool(status) // phase + paused
Lifecycle.fromDaemon(status)   // supervising
```

WorkPool `phase` includes `"idle"` when bring-up was deferred. Idle pools stay
**ready** for dial / client verify (workers just aren't forked); `draining` /
`off` are not ready.

## Deferred start (layer)

```ts
import * as Hyperlink from "hyperlink-ts/Hyperlink"
import * as WorkPool from "hyperlink-ts/WorkPool"
import * as Daemon from "hyperlink-ts/Daemon"

WorkPool.serve(Jobs, { effect }).pipe(Hyperlink.deferStart)
Daemon.layer(Sweeper, { effect }).pipe(Hyperlink.deferStart)
```

Resolve order for WorkPool: call-site `autoStart` when set → else `!DeferStart` → default
`true`. Daemon has no `autoStart` bag field — only the layer pipe.

## See also

- [Policy](/docs/policy) — dial / verify / conflict / yield (client + advertise)
- [WorkPool](/docs/work-pools) · [Daemons](/docs/daemons)
- [Observation and control](/docs/observation-and-control) — generic tools via `specOf` + `methodMeta`
