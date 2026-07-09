# Agent report: Process

**Branch:** `cursor/process-closeout-a009` (targets `integration/storage`)  
**Agent:** Agent 2 — Process close-out  
**Priority:** **Closed** — store cutover + cast removal done on integration line.

---

## Shipped on `integration/storage`

| Area | Status | Key files |
|------|--------|-----------|
| Config-object `Process.Tag` wire (`success` / `error`) | ✅ | `src/Process.ts`, `src/internal/processTagSchemas.ts` |
| Store contract (queue/run aligned, cast-free) | ✅ | `src/internal/store/processStoreSpec.ts` — `BuiltInProcessContract`, `builtInProcessStoreContract` |
| Engine store wiring (layer path) | ✅ | `src/Process.ts` — `buildProcessImpl`, `Store.effects` + `catchWriteErrors`, `Resource.provideContext` |
| Legacy facet writes | ✅ removed | **`ProcessExecutionStore` facet deleted** — `Process.store(tag)` only |
| Event `_tag` names | ✅ | `Started` / `Completed` / `Failed` / `Interrupted` (no `Run*` prefix) |
| `Completed.success` population | ✅ | From `SubscriptionRef` when tag stamps `success` |
| `hasPriorExecutions` | ✅ | Tier-1 contract + toolkit layer |
| `Process.result` removed | ✅ | Use `{ success }` on tag |
| `Resource.builtResource` + default memory | ✅ | `layer` / `serve` / `serveRemote` |
| Store contract tests | ✅ | `test/process-store-*.test.ts`, `test/process-store-contract.test-d.ts` |

Authoritative cutover notes: [`../store-cutover-process.md`](../store-cutover-process.md).

---

## Closed this session (Agent 2)

| Item | Status |
|------|--------|
| Cast on `builtInProcessStoreContract` | ✅ removed — `ProcessEventSchemaOf` erased like `QueueEventSchemaOf`; no `as` |
| Stale report (`processStoreTap`, `Run*`, facet) | ✅ refreshed |
| User docs (`process.md`, `PROCESS-API.md`, `STORAGE.md`) | ✅ corrected + linked to cutover handoff |

---

## Open items

**None** for Process module close-out. Optional follow-ups (owner decision, out of scope here):

- **RPC `error` slot** — tag `error` stamped but not wired on RPC failure paths (see integration-sync).
- **Typed full-capture (worker-A)** — tag `success` drives persisted rows; worker `Effect` return not schema-driven like queue.

---

## Verification

```bash
pnpm run typecheck
pnpm test
pnpm exec vitest run test/process-store-*.test.ts test/process-built-resource.test-d.ts test/process-toolkit.test.ts
```

---

## Coordination

- **Docs-release agent:** CHANGELOG + release notes when owner approves changeset.
- **Queue / RunResource:** separate agents — Process close-out does not track their engine work.
