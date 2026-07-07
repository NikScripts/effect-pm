# Store cutover — CustomQueueResource

Prereq: `store-cutover-00-store-core.md`.

## Tag API — OWNER DECISION LOCKED (2026-07-06)

**CQR does NOT take the `success`/`error` triplet.** It is **config-object only** — no positional wire
slots, no `success`/`error`. The triplet is a QueueResource concern; CQR's arity (lanes) makes positional
wire slots a non-starter, and the owner ruled it out.

```ts
// CQR Tag: config object only, no success/error.
CustomQueueResource.Tag<Jobs>()("@app/Jobs", {
  payload: Job,
  levelCount: 3,
  namedLevels: { urgent: 0, normal: 1, bulk: 2 },
})
```

- [ ] Land the config-object-only `Tag` (no `success`/`error` slots, no positional-triplet overload).
- [ ] Supersedes the earlier "trailing `{ success?, error? }` bag" proposal (result-schema doc §C / sync
      cross-cutting #6) — dropped.

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
