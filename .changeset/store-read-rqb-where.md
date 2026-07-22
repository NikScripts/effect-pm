---
"hyperlink-ts": minor
---

**Store shape reads:** remove the per-shape read-payload argument from `Store.shape`. Every shape now shares one baked-in read payload (`limit`, `before`, `after`, and a Drizzle relational-query-style nested `where` with full operators / `AND` / `OR` / `NOT`).

```ts
// before
Store.shape(row, Schema.Struct({ limit: Schema.optional(Schema.Number) }))
yield* handle.readings.read({ limit: 10 })

// after
Store.shape(row)
yield* handle.readings.read({
  limit: 10,
  where: { value: { gte: 70 }, meta: { source: "probe" } },
})
```

Domain filters that used to be custom payload fields (e.g. run facts `runId`) move to `where`. `Process.processEventReadPayload` is deprecated.
