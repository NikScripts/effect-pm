# Store cutover — CustomQueueResource

Prereq: `store-cutover-00-store-core.md`.

## Tag API — config object only (2026-07-09)

**All wire schemas live on the config object** — no positional schema overloads on any toolkit `Tag`.
CQR takes the same optional `success` / `error` slots as {@link QueueResource.Tag} (plus lane fields).

```ts
CustomQueueResource.Tag<Jobs>()("@app/Jobs", {
  payload: Job,
  levelCount: 3,
  namedLevels: { urgent: 0, normal: 1, bulk: 2 },
  success: ResultSchema,  // optional
  error: WorkerErrSchema, // optional
})
```

- [x] Config-object-only `Tag` on QueueResource, Process, RunResource, CustomQueueResource.
- [x] CQR optional `success` / `error` — stamped like QR; store wire from tag SSOT.

## Store cutover — mostly free

CustomQueue shares the queue **engine** (`buildQueueEngine` / `makeQueueRuntime` in
`internal/queueResource.ts`), so once the **queue** store wiring lands (engine resolves
`StoreScopeBridgeTag` as a declared dependency — **no `serviceOption`**, store-core §1 — and `publishEvent`
persists), CustomQueue inherits event persistence with no separate engine work.

- [x] After the queue cutover: confirm CustomQueue's events flow to its store (it uses the same
      `publishEvent`), and that its custom-lane events (if any beyond the shared `QueueEvent<T>` set) are
      represented. If CQR emits lane-specific events not in `QueueEvent<T>`, decide whether they join the
      union or stay live-only. **Done:** CQR shares `QueueEvent<T>`; lane is on the entry, not a separate event union.
- [x] Cast check: no `... as` identity cast in any CQR store contract (mirror `builtInQueueStoreContract`).

## Verify
`pnpm typecheck` (both) + `test/custom-queue-contract.test.ts` + CQR suites.
