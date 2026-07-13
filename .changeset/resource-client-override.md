---
"@nikscripts/effect-pm": patch
---

Cleaner resource-handle types + a client-type override API, and drop the redundant `Kind` type param.

- `yield* Tag` now hovers as the real service shape: `Method<…>` spec descriptors resolve to their effects, and `Schema.Struct.ReadonlySide<…>` payloads read as `{ to: string }` (internal `Simplify` + `PrettifyPayload`).
- New **two-stage override** forms let a method's client-facing type be overridden without touching wire/impl (which stay schema-derived): `effectFn<T>()(schema)` / `effect<Effect<T>>()(success)` — **narrowing** (`T` must be assignable to the schema-derived shape); `unsafeEffectFn<T>()(schema)` / `unsafeEffect<Effect<T>>()(success)` — **unconstrained**. `Resource.Decoded<S>` exposes a schema's prettified `.Type` for spelling overrides. The built-in queue's `add`/`prioritize`/`defer` now surface real `(item)` / `(items[])` overloads.
- Single-stage `effectFn(schema)` / `effect(success)` are unchanged. **Breaking:** a void query is now written explicitly `effect(Schema.Void)` — the empty `effect()` is the two-stage override entry.
- **Breaking (types):** the `Method` `Kind` type param (`"query"`/`"mutate"`) is dropped — `kind` is a runtime-only field now (still stamped, still read by `getMethodMeta`), so `Method<…>` types no longer carry it.
