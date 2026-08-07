---
"last-ts": minor
---

`View.Service()(key, default)` — optional view slot as `Context.Reference` with a positional default component. Override via `Effect.provideService` or `Layer.provideMerge(Layer.succeed(…))` (themes, sidebars, nested settings chrome). Annotations remain `Service()(key, { … })` when the second arg is an object.
