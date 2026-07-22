---
"hyperlink-ts": minor
---

Tree-shakeable, browser-safe resource tags + one unified `QueueResource` namespace + a clean `strictEffectProvide` gate.

**Unified `QueueResource`.** The toolkit queue and the engine are now a single `QueueResource` namespace (one import) — `Tag` / `layer` / `configure` / `server` / `serveHttp` plus the engine helpers `make` / `Service` / `Schema` / `Errors`. `Tag` is a normal Effect service driven the same `yield* Tag` whether local or remote.

**Tree-shakeable browser-safe tags.** Queue, Process, and ProcessSchedule are restructured the Effect way — light contract modules (engine-free `Tag`/spec), shared wire schemas in their own module, namespaces assembled via `export * as`, and `tsup` code-splitting (`splitting: true`) + `"sideEffects": false`. Importing a tag for a browser bundle no longer pulls the engine:

```ts
import * as QueueResource from "@nikscripts/effect-pm/QueueContract";
import * as ProcessResource from "@nikscripts/effect-pm/ProcessContract";
import * as ProcessScheduleResource from "@nikscripts/effect-pm/ProcessScheduleContract";
// QueueResource.Tag / ProcessResource.Tag bundle to ~kb with zero engine code (proven via esbuild).
```

All toolkit modules are also verified to have **no native/node deps** (browser-safe regardless of bundler). Guaranteed *barrel*-namespace tree-shaking (vs the subpath form above) is a tracked follow-up.

**Process default fix.** A `ProcessResource` runs immediately with its layer (`alwaysArmed` default), matching the engine; pass `schedule: ProcessSchedule.empty` to start disarmed.

**`strictEffectProvide` cleanup.** The 6 previously-held sites are fixed by building each layer once into its scope and providing the resulting `Context` (rate-limiter and capture-logger in the queue engine; the legacy RPC transport servers). The strict typecheck gate is now clean (0 errors).
