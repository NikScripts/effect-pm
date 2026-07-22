---
"hyperlink-ts": minor
---

**Per-resource readiness, aggregated into `/health` and `HostStatus`.** Every resource can report whether it's actually working — derived from its own status (its single source of truth), not stored separately:

- **`Resource.withReadiness`** — a dual combinator (data-first `withReadiness(tag, fn)` or pipeable `tag.pipe(withReadiness(fn))`, idiomatic in a class `extends`) that attaches a readiness derivation `(svc) => Effect<{ ready, detail? }>` to a tag. The built-in contracts apply it from their status: a queue/custom-queue is ready iff its worker pool is `running`; a scheduled process iff it's `supervising`. A bare `Resource.Tag` opts in the same way (and any tag without one is **ready by default**, so nothing falsely fails a gate). Read a tag's result with `Resource.readinessCheck(tag, service)`.
- **`/health` now returns `503` (`status: "degraded"`)** when any served resource is not ready — so a deploy gate won't promote a half-booted host — and its JSON body lists each resource's `{ key, kind, ready, detail? }`.
- **`HostStatus` folds in the same aggregate** (no parallel `HostHealth`): its schema gains `status` (`ok`/`degraded`) and `resources[]`, fed by the one readiness pass `/health` uses — so a dashboard health board reads the stream it already consumes. New: `HostStatus.resourceReadiness` schema / `HostStatus.ResourceReadiness` type.
