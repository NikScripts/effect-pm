# Handoff (docs agent): doc updates from recent toolkit work

Two user-facing guides have drifted from shipped behavior (serveAllHttp + refill dependencies).
Both are small, well-scoped edits. Branch: `rewrite/resource-toolkit`.

## 1. Document `serveAllHttp` + `serverEntry` (currently undocumented)

> **✅ Done:** added §12b "Serve many resources on one host (`serveAllHttp` / `serverEntry`)" to
> `docs/guides/toolkit-by-example.md` — the pattern, the `R | HttpServer` union, the `serve-all-*` test
> references, and a pointer to `per-resource-dependencies.md` for the heterogeneous-dependency case.

`Resource.serveAllHttp` (serve many resources on one HTTP port behind one `Host`) and
`QueueResource.serverEntry` / `ScheduledProcess.serverEntry` shipped but appear in **no** guide —
only `docs/AGENTS.md` and the UI handoff. Add a section to **`docs/guides/toolkit-by-example.md`**
(the home of the `Resource.Host` / serving examples):

- The pattern: bind resources to one `Resource.Host` via the Tag's `{ host }` option →
  `Resource.serveAllHttp([ QueueResource.serverEntry(Q, cfg), ScheduledProcess.serverEntry(P, cfg) ])`
  → `Layer.provideMerge(NodeHttpServer.layer({ port }))`; clients reach each member via
  `Resource.client` + one `connectHttp(Host)`.
- It surfaces the union `R | HttpServer`.
- Working reference: `test/serve-all-queues.test.ts` (two real queue engines, one Host, one port) and
  `test/serve-all-http.test.ts`. The 1:1 replacement for the removed `ControlService.make({ group, port })`.

## 2. Fix the refill section in `docs/guides/queue-resource.md`

The **Self-refill** section (~line 49-60) says only *"`load` … runs in the worker `R`"* — stale since
the refill-dependency fix. Update it to:

- The refill `load` may require its **own** services (`RR`), independent of the worker `effect` — e.g.
  a repository/DB the worker doesn't use. The layer's requirement is the **union `R | RR`**; provide
  both.
- (Optional context) before the fix this collapsed to `never` and wouldn't type-check — see the
  `refill-dependency-support` changeset. Regression test: `test/queue-refill-deps.test.ts`.

## 3. (Optional) Effect v4 contributor gotchas

Worth a short note in `docs/AGENTS.md` (or a CONTRIBUTING note) for future engine work:
`Effect.fork`→`forkChild`, `Effect.transaction`→`Effect.tx`, `Fiber.poll` removed; `Effect.tx` +
`txRetry` blocking is unreliable in `effect@4.0.0-beta.69` (use poll + an explicit wake); timing
tests need `it.live` (TestClock otherwise stalls `sleep`/`delay`).

## Gate
Docs-only — no code gate, but keep cross-links valid and run `pnpm lint` if any example code is added
(examples are linted).
