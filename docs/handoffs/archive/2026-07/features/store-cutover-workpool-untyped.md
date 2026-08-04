# Store cutover — WorkPool (untyped `.Service` / engine)

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

Prereq: `store-cutover-00-store-core.md`.

## Tag API — config object only (2026-07-09)

**All wire schemas live on the config object** — no positional schema overloads on any toolkit `Tag`.
untyped WorkPool takes the same optional `success` / `error` slots as {@link WorkPool.Service} (plus lane fields).

```ts
WorkPool.Service /* untyped .Service */<Jobs>()("@app/Jobs", {
  payload: Job,
  levelCount: 3,
  namedLevels: { urgent: 0, normal: 1, bulk: 2 },
  success: ResultSchema,  // optional
  error: WorkerErrSchema, // optional
})
```

- [x] Config-object-only `Tag` on WorkPool, Daemon, Gate, WorkPool.define (untyped).
- [x] untyped WorkPool optional `success` / `error` — stamped like QR; store wire from tag SSOT.
- [x] untyped WorkPool `layer` / `serve` / `serveRemote` use `Hyperlink.builtHyperlink` + `grantLocal` (parity with WorkPool / Daemon).

## Store cutover — mostly free

Untyped WorkPool shares the queue **engine** (`buildQueueEngine` / `makeQueueRuntime` in
`internal/workPool.ts`), so once the **queue** store wiring lands (engine resolves
`StoreScopeBridgeTag` as a declared dependency — **no `serviceOption`**, store-core §1 — and `publishEvent`
persists), untyped WorkPool inherits event persistence with no separate engine work.

- [x] After the queue cutover: confirm untyped WorkPool's events flow to its store (it uses the same
      `publishEvent`), and that its custom-lane events (if any beyond the shared `QueueEvent<T>` set) are
      represented. If untyped WorkPool emits lane-specific events not in `QueueEvent<T>`, decide whether they join the
      union or stay live-only. **Done:** untyped WorkPool shares `QueueEvent<T>`; lane is on the entry, not a separate event union.
- [x] Cast check: no `... as` identity cast in any untyped WorkPool store contract (mirror `builtInQueueStoreContract`).

## Verify
`pnpm typecheck` (both) + `test/custom-work-pool-contract.test.ts` + untyped WorkPool suites.
