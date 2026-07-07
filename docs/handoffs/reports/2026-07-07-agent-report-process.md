# Agent report: Process

**Branch:** `cursor/integration-result-schema-a3ad` (Process tag + store contract) + merge RunResource branch  
**Agent:** Process owner  
**Priority:** **High** — rename landed; behavior and engine gaps remain.

---

## Shipped

| Area | Status | Key files |
|------|--------|-----------|
| Tag positional `success` / `error` | ✅ | `src/Process.ts`, `src/internal/processTagSchemas.ts` (`successSym`, `errorSym`) |
| Config object `{ success?, error?, … }` | ✅ | `ProcessTagOptions` |
| Store contract (queue-aligned) | ✅ | `src/internal/store/processStoreSpec.ts`, `processEvent.ts` |
| `Process.store(tag)` registration | ✅ | `builtInProcessStoreContract(tag)` reads `successOf(tag)` |
| Store contract tests | ✅ | `test/process-store-contract.test.ts` |
| Guide update | ✅ | `docs/guides/process.md` |

---

## Open issues (critical)

### 1. `error` slot is decorative — **must fix or remove**

`Process.Tag()(key, success, error)` stamps `errorSym` on the tag and exports `errorOf`, but **nothing consumes it**:

| Consumer | Uses `error`? |
|----------|----------------|
| Supervisor / `buildProcessImpl` | ❌ |
| RPC spec / wire | ❌ |
| Store `RunFailed` | ❌ — still `error: Schema.String` |
| `ProcessExecutionStore` | ❌ |

**Minimum bar:** wire `error` into RPC effect error channel and/or typed `RunFailed` payload in `makeProcessExecutionEvent`. **Alternative:** remove `error` from public Tag API until wired (prefer wiring in same sprint).

### 2. Engine does not write to `Process.store` — asymmetry vs RunResource

RunResource engine auto-appends via `runResourceStoreTap.ts` (legacy facet + `Process.store` bridge).

Process supervisor still writes **only** `ProcessExecutionStore.recordCompleted` / `recordFailed` / `recordInterrupted` (`Process.ts` ~537).

**Task:** add `processStoreTap.ts` (mirror RunResource):

- On run terminal events → `ProcessExecutionStore` static emitters (keep)
- When `StoreScopeBridgeTag` + registered scope → `store.record(event)` on built-in contract
- Lazy bridge resolution at **write time** (same layer-order fix as RunResource)

**Do not** block tag rename on this, but **do not** claim storage parity in docs until done.

### 3. `Process.result` pipe still exists

`Process.result` is `@deprecated` but **not removed**. Dual API violates project policy (no shims).

**Task:** delete `Process.result`, migrate any remaining callsites to `Tag()(key, success)`, update CHANGELOG / changeset.

### 4. Symbol stamp is breaking — document in changeset

`Symbol.for("@nikscripts/effect-pm/Process/success")` replaced `…/resultSchema`. External readers of symbols break. Note in release notes.

### 5. No `payload` on Process tag (by design)

Process effect has no per-invocation RPC payload schema. Tag is **two-slot** (`success`, `error`). Do not add `payload` without a product decision.

---

## Files to touch

| File | Work |
|------|------|
| `src/Process.ts` | Remove `Process.result`; wire `error` into spec if kept |
| `src/internal/processEvent.ts` | Optional typed `RunFailed` from `errorOf(tag)` |
| `src/internal/processStoreTap.ts` | **New** — engine persistence to Store |
| `src/internal/store/processStoreSpec.ts` | Extend if failed events need typed error |
| `test/process-toolkit.test.ts` | Engine → store integration test |
| `test/process-store-contract.test.ts` | Extend for auto-write |
| `docs/PROCESS-API.md`, `docs/STORAGE.md` | Asymmetry until tap lands |

---

## Verification

```bash
pnpm run typecheck
pnpm exec vitest run test/process-toolkit.test.ts test/process-store-contract.test.ts \
  test/process-contract-shape.test-d.ts
```

---

## Coordination

- **Store agent:** bridge typing from `4597ee1` before adding tap.
- **Docs agent:** PROCESS-API persistence section after tap or explicit “legacy facet only” wording.
- **Queue agent:** align positional arity `Tag()(key, payload, success?, error?)` — Process omits `payload`.
