# Agent report: Process

**Branch:** `cursor/process-platform-a009` (targets `integration/storage`)  
**Agent:** Agent 2 — Process platform Session 2  
**Priority:** Store `Failed.error` fidelity + RPC investigation + examples/docs.

---

## Shipped on `integration/storage` (cumulative)

| Area | Status | Key files |
|------|--------|-----------|
| Config-object `Process.Tag` wire (`success` / `error`) | ✅ | `src/Process.ts`, `src/internal/processTagSchemas.ts` |
| Store contract (queue/run aligned, cast-free) | ✅ | `src/internal/store/processStoreSpec.ts` — `BuiltInProcessContract`, `builtInProcessStoreContract` |
| Engine store wiring (layer path) | ✅ | `src/Process.ts` — `buildProcessImpl`, `Store.effects` + `catchWriteErrors`, `Resource.provideContext` |
| `Failed.error` store encoding | ✅ | `Process.ts:581-596` — `errorOf(tag)` typed path + `String(...)` fallback |
| Legacy facet writes | ✅ removed | **`ProcessExecutionStore` facet deleted** — `Process.store(tag)` only |
| Event `_tag` names | ✅ | `Started` / `Completed` / `Failed` / `Interrupted` (no `Run*` prefix) |
| `Completed.success` population | ✅ | From `SubscriptionRef` when tag stamps `success` |
| `hasPriorExecutions` | ✅ | Tier-1 contract + toolkit layer |
| `Process.result` removed | ✅ | Use `{ success }` on tag |
| `Resource.builtResource` + default memory | ✅ | `layer` / `serve` / `serveRemote` |
| Store contract tests | ✅ | `test/process-store-*.test.ts`, `test/process-store-contract.test-d.ts` |

Authoritative cutover notes: [`../store-cutover-process.md`](../store-cutover-process.md).

---

## Session 2 outcomes (`cursor/process-platform-a009`)

| Item | Status | Evidence |
|------|--------|----------|
| Store `Failed.error` — typed + fallback | ✅ | `test/process-store-engine.test.ts` (memory, engine path); `test/process-store-sqlite.test.ts` (typed error journal codec round-trip) |
| RPC `error` wire | ⛔ **Blocked** | See § RPC error wire blocker below — no half-ship |
| Examples + review docs | ✅ | `examples/forms/process-store/*`, `process-store-cutover-review.md` Review 2026-07-09, `integration-sync-2026-07-07.md`, `STORAGE.md` Process subsection |
| `process-contract-shape.test-d.ts` | ✅ | `errorOf(PricedErr)` + store-only comment |

---

## Open items (owner decision)

### RPC error wire blocker

Tag `error` is **stamped** on the tag object but **not grafted** onto the RPC spec. Process failures today are background poll ticks recorded to the store — there is no request/response worker RPC like RunResource `run`.

| Step | Location | What happens |
|------|----------|--------------|
| Tag stamp | `src/Process.ts:1889-1890` | `applyProcessTagSchemas` sets `stamp[errorSym] = schemas.error` on the tag |
| Store write | `src/Process.ts:581-596` | `recordStoreFailed` uses typed `error` when `errorOf(storeScopeTag)` is set, else `String(...)` |
| RPC spec | `src/Process.ts:1548-1569` | `processSpec` lifecycle methods are `Resource.effectFn(Schema.Void)` — default error channel `Schema.Never` |
| Contrast (RunResource) | `src/internal/runResourceSchema.ts:30-37` | `runSpec(payload, success, error)` bakes `error` into the per-tag RPC spec at tag construction (`RunResource.ts:346-358`) |

**Why blocked:** Wiring typed `error` on Process RPC failure responses requires rebuilding `processSpec` per tag (mirror `runSpec`) or shared RPC fingerprint infrastructure. Process has no terminal RPC method that returns failure payloads today — lifecycle verbs are void commands.

**Owner ask:** Defer until Process gains a typed failure RPC surface, or fund shared per-tag spec rebuild like RunResource.

**Session 3 (2026-07-10, `cursor/process-consumer-docs-a009`):** Agent 2 recommends **defer**. Consumer docs updated (`PROCESS-API.md`, `guides/process.md`) pending owner confirmation. No code or RPC spec changes in this session.

### Other optional follow-ups (out of scope Session 2)

- **Typed full-capture (worker-A)** — tag `success` drives persisted rows; worker `Effect` return not schema-driven like queue.

---

## Verification

```bash
pnpm run typecheck
pnpm test
pnpm exec vitest run test/process-store-*.test.ts test/process-built-resource.test-d.ts test/process-toolkit.test.ts
```

Session 2: **438 tests passed** (98 files).

---

## Coordination

- **Docs-release agent:** CHANGELOG + release notes when owner approves changeset.
- **Queue / RunResource:** separate agents — Process Session 2 does not track their engine work.
