---
"hyperlink-ts": minor
---

`hyperlink-ts/Versioned` — contiguous Schema migration chains for cross-version handoff.

- **`Versioned.make(origin).migrate(next, step)`** — tip-typed chain; compile error on gaps
- **`Versioned.schemaVersion`** — tip id (`Schema.Class.identifier` or AST hash); one system for status / durable / descriptors
- **`Versioned.wireSchema` / `decodeFromVersion` / `encodeToVersion`** — auto upcast/downcast on seams
- WorkPool payload Spec uses wire Schema when Versioned; durable rows stamp string `schemaVersion`
- Status `services[].schemaVersion` beside `contractHash`
- Tagged errors: `MigrationPathMissing`, `MigrationDecodeFailed`
- `WorkPool.withSchemaVersion` / `schemaVersionOf` deprecated (identifier `vN` bridge)
