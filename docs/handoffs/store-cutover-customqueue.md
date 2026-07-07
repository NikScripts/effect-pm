# Store cutover — CustomQueueResource

Prereq: `store-cutover-00-store-core.md`. Context: `result-schema-and-rpc-validation.md` (§C — the CQR
`payload`/`success`/`error` triplet is flagged **TBD with the CQR agent**).

## Tag wire schemas (open — needs your call)

CustomQueue's `Tag` factory must land the same three wire slots after the required `payload`, but arity
interacts with lane count / named levels. The handoff proposes a trailing options bag:

```ts
CustomQueueResource.Tag<Jobs>()(
  "@app/Jobs",
  Job,                         // payload (required)
  3,                           // lane count
  { urgent: 0, normal: 1, bulk: 2 },
  { success: LaneMeta, error: WorkerErr },   // trailing wire slots
)
```

- [ ] Decide the canonical arity: where do `success`/`error` sit relative to lane count / named levels?
      (Open question #1 in the result-schema doc.) Prefer the trailing options bag over more positional args.
- [ ] Config-object overload parity with QueueResource (`{ payload, success?, error?, … }` + lane config).

## Store cutover — mostly free

CustomQueue shares the queue **engine** (`buildQueueEngine` / `makeQueueRuntime` in
`internal/queueResource.ts`), so once the **queue** store wiring lands (engine resolves
`StoreScopeBridgeTag` as a declared dependency — **no `serviceOption`**, store-core §1 — and `publishEvent`
persists), CustomQueue inherits event persistence with no separate engine work.

- [ ] After the queue cutover: confirm CustomQueue's events flow to its store (it uses the same
      `publishEvent`), and that its custom-lane events (if any beyond the shared `QueueEvent<T>` set) are
      represented. If CQR emits lane-specific events not in `QueueEvent<T>`, decide whether they join the
      union or stay live-only.
- [ ] Cast check: no `... as` identity cast in any CQR store contract (mirror `builtInQueueStoreContract`).

## Verify
`pnpm typecheck` (both) + `test/custom-queue-contract.test.ts` + CQR suites.
