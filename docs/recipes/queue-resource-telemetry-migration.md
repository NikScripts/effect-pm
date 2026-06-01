# QueueResource telemetry migration recipe

## Goal

Migrate `QueueResourceStore` and `QueueResource` telemetry writes from legacy
`ProcessStore.record` static emitters to scope-backed PascalCase telemetry
events.

## Non-goals

- Do not migrate `LogStore` in this recipe.
- Do not keep compatibility write shims for old `record*` statics.
- Do not change queue worker behavior, ordering, rate-limit behavior, or hooks.

## Mise en place findings

- `QueueResourceStore` currently writes entry, lifecycle, dedupe-key, and
  rate-limit rows.
- Queue reads rely on indexed `RuntimeRecord` columns:
  `subjectType`, `subjectId`, `key`, `indexA` (`batchId`), and `indexB`
  (`releaseId`).
- Existing event shapes are rich domain facts/changes, similar to
  `RunResource`.
- Queue runtime has many emit sites and some batch emits for dedupe keys.

## Locked ingredients

- Row `type` is generated from PascalCase telemetry path.
- Event schemas do not include row `type`, `processType`, or `processId`.
- Built-in generic store facets use scope-derived identity.
- Regular schema fields are validated event input.
- Event definitions own best-effort write logging.

## Open recipe steps

### Step 1 — Indexed column metadata

What this decides:
How queue telemetry events populate indexed runtime columns without putting row
identity fields back into event schemas.

Recommended ingredients:
- Add event-level index metadata pipe such as `Telemetry.index(...)`.
- Keep indexes declared beside the event, not inside runtime call sites.
- Support constant and payload-derived fields.

Picture:

```ts
class EntryEnqueued extends Telemetry.Schema<EntryEnqueued>()(QueueEntryScope)({
  entryId: QueueEntryScope.Schema.Leaf.entryId,
  occurredAt: Telemetry.terminal.clockMillis,
  key: Schema.optionalKey(Schema.String),
  batchId: Schema.optionalKey(Schema.String),
  payload: Schema.optionalKey(Schema.Unknown),
}) {}

Telemetry.event("Enqueued", EntryEnqueued).pipe(
  Telemetry.index({
    subjectType: "QueueEntry",
    subjectId: "entryId",
    key: "key",
    indexA: { name: "batchId", field: "batchId" },
  }),
  Telemetry.logWarning("QueueResourceStore write failed for Entry.Enqueued"),
)
```

Alternatives:
1. Encode indexes in `Telemetry.Schema` fields by naming convention — implicit
   and brittle.
2. Keep hand-written store encoders — fastest, but violates the single-source
   telemetry declaration goal.
3. Put indexes in runtime call sites — repeats storage concerns in worker code.

Question:
Should queue indexed columns be declared with an event-level
`Telemetry.index(...)` pipe?

Recommended answer:
Yes. It keeps event schema focused on payload, keeps indexes close to the
event declaration, and avoids returning to hand-written store encoders.

Acceptance check:
`QueueResourceStore.Entry.Enqueued` can populate `subjectId`, `key`, and
`indexA` from the materialized event payload while the queue worker only calls
the event emitter.

## Cleanup status

Open. Delete this recipe once implemented or moved into durable docs.
