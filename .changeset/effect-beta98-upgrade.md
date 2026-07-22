---
"hyperlink-ts": patch
---

Upgrade effect + platform-node + sql-sqlite-node + vitest from `4.0.0-beta.92` to `4.0.0-beta.98`.

Two upstream migration points handled:

- **`HttpApiGroup.Any` split into `HttpApiGroup.Constraint` (the `extends` bound) + `HttpApiGroup.Top` (the concrete widest instance).** `HttpApiResource.ts` now bounds its `Groups` type params with `HttpApiGroup.Constraint` and uses `HttpApiGroup.Top` only where a concrete widest value is needed — matching how effect's own `HttpApiBuilder`/`HttpApiClient` APIs constrain groups.
- **`HttpApiEndpoint.name` renamed to `HttpApiEndpoint.identifier`.** `instrumentEndpoints` (the ApiMetrics usage instrumentation) read `endpoint.name`, which became `undefined` under beta.98 and silently stopped recording endpoint metrics. `HttpApiEndpoint.Top` carries an `any` type parameter, so this was a **runtime-only** regression that the typechecker could not catch — it was caught by the ApiMetrics test suite.

This also brings in `effect/Optic`, the schema-derived optics module (lens/prism/optional/traversal, `fromChecks` reusing `Schema` refinements).
