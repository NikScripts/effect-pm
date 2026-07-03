---
"@nikscripts/effect-pm": minor
---

**Live `value` fields land in the queues, plus the accessors + a de-brand to make them ergonomic.**

- **`Resource.changes(svc, (s) => s.a.b)` / `Resource.ref(svc, …)`** — subscribe to a `value` field's live
  delta stream (current value first, then every update) or grab its `SubscriptionRef`. A **selector**, not a
  string path, so nested `value` fields are addressed by navigation with full autocomplete. `value` fields
  are now `SubscriptionRef`-backed (the plain read is unchanged).
- **De-brand (Effect idiom).** The internal symbol brands are gone in favour of Effect's own convention —
  a string identity `TypeId` and a readable **`_tag`** (`"constant"`/`"value"`) / **`fleet: true`**. Spec
  types read as English (`Method<…> & { _tag: "value" }`), no `Symbol(…)` keys. **`.annotate()` now preserves
  the marker** — `value(x).annotate({…})` stays a value (previously it silently degraded to a stream field).
- **`ImplOf<S>` is now exported** — the type an impl must satisfy (a `value`'s impl is the `Stream` that
  feeds it, a `constant`'s is the `Effect<A>`), distinct from how they surface in `ServiceOf`.
- **Queues adopt `value`** (BREAKING service shape): `status` is now a live **`value`** (plain `p.status`
  *and* subscribable via `changes`); **`statusNow` removed** (`p.status` is the one-shot read); `size` /
  `isEmpty` are `value`s; `sizes` / `completed` removed (read `p.status.*`); `metrics` / `logs` are nested
  `{ live, history }` groups (`p.metrics.live` / `p.metrics.history(query)`). Same for `CustomQueueResource`
  (`levelSizes` stays an `effect` — the raw index array isn't in the named-Record `status`).
