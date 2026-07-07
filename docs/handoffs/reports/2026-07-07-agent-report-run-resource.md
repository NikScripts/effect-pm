# Agent report: RunResource

**Branch:** `cursor/run-resource-handle-observable-a009` (includes RunResource handle/RPC/store work)  
**Integration base:** merge `cursor/integration-result-schema-a3ad` before work  
**Agent:** RunResource owner  
**Priority:** Low — **most work is done**; this agent finishes gaps and verifies.

---

## Shipped (do not redo)

| Area | Status | Key files |
|------|--------|-----------|
| `.run` handle API | ✅ | `src/RunResource.ts`, `src/internal/runResource.ts` |
| Subscribable observation | ✅ | `status`, `waiting`, `inFlight`, … |
| RPC `layer` / `serve` / `serveRemote` | ✅ | `runSpec`, `buildRunImpl` |
| Tag wire slots `payload` / `success` / `error` | ✅ | commit `2c8a95e` |
| `RunResource.store(tag)` | ✅ | `builtInRunResourceStoreContract` |
| Engine store tap | ✅ (stopgap) | `src/internal/runResourceStoreTap.ts` (legacy facet + Store; lazy bridge — migrate to `storeTap.ts`) |
| Integration tests | ✅ | `test/run-resource.test.ts` (ProcessStorage + Store auto-write) |
| Remote HTTP test | ✅ | `test/run-resource-remote-http.test.ts` |
| Changeset (partial) | ✅ | `.changeset/run-resource-handle-rpc-store.md` |

---

## Remaining work

### 1. Consume integration branch Store typing fix

Integration commit `4597ee1` tightens `bridge.at` / `Tag.store` so consumers get `StoreHandleOf<C>` without casts.

- **File:** `src/internal/runResourceStoreTap.ts` — may drop `as unknown as StoreHandleFromContract<…>` after merge.
- **Verify:** `test/store.test.ts`, `test/store-default.test.ts`.

### 2. Doc sweep (stale names)

Grep and fix any remaining `inputSchema` / `successSchema` / `RunGate` / callable `gate(`:

- `docs/CODEBASE-INVENTORY.md` — RunResource Service line still mentions `inputSchema` (as of pre-report tree)
- `docs/guides/resource-configure.md` — confirm `payload` / `success` / `error`
- Examples under `examples/forms/resource/`

### 3. Changeset consolidation

Merge `.changeset/run-resource-handle-rpc-store.md` into the platform-wide rename/release changeset (see Docs + release report). Avoid two conflicting beta notes.

### 4. Optional hardening

- **`serve` / `serveRemote` casts** — `Layer.unwrap` + casts mirror Process; revisit only if typecheck improves upstream.
- **SQLite example** — `examples/forms/process-store/process-store-events-sqlite-layer.ts` already logs run facts; no blocker.

---

## Out of scope (other agents)

- Process engine → `Process.store` tap
- Queue `itemSchema` → `payload` rename
- RPC fingerprint / buildId handshake
- Removing legacy `RunResourceStore` facet (ProcessStorage still depends on it)

---

## Verification

```bash
pnpm run typecheck
pnpm exec vitest run test/run-resource.test.ts test/run-resource-remote-http.test.ts \
  test/run-resource-store-facet.test.ts test/store.test.ts
npx tsx examples/forms/process-store/process-store-events-sqlite-layer.ts
```

---

## Critical notes

1. **`RunResource.make`** uses the observable engine internally but exposes **`.run` only** (no Subscribables on public handle). Documented in module TSDoc — keep accurate.
2. **Do not rename** persisted fact fields (`run-resource.run.*`) or `RunGateStatus` counters — only tag config uses `payload` / `success` / `error`.

---

## Review 2026-07-07 (post store-cutover merge)

Read: [`integration-sync-2026-07-07.md`](../integration-sync-2026-07-07.md), [`store-cutover-00-store-core.md`](../store-cutover-00-store-core.md), [`store-cutover-runresource.md`](../store-cutover-runresource.md).

### Corrections to this report

| Prior claim | Updated position |
|-------------|------------------|
| Lazy bridge at write time is long-term | **Stopgap only.** Owner preference + store-core §2: migrate to shared `internal/store/storeTap.ts` (eager resolve once in forked fiber). |
| Engine store tap ✅ done | **Feature-complete for beta**, not **architecture-complete**. Dual-write + lazy path ships; cutover is follow-up after Queue prototypes `storeTap.ts`. |
| Drop tap cast after Store merge | **Partially done.** `bridge.at` is 2-arg; `runResourceStoreTap.ts:91` still has `as unknown as StoreHandleFromContract<…>`; `runResourceStoreSpec.ts:119` still has `as BuiltInRunResourceContract` (queue is cast-free reference). |

### Other agents on RunResource

| Agent | Opinion |
|-------|---------|
| **Store** | RunResource is only engine with Store tap today; lazy path was workaround before `layerDefaultMemory`. Process/Queue still facet-only. |
| **Process** | RunResource tap is reference for `processStoreTap.ts`; Process report still says lazy at write time — **stale** vs store-cutover; Process should adopt shared helper, not copy lazy pattern. |
| **Queue** | Owns `storeTap.ts` prototype; **rejects** lazy per-run resolution; build-time resolve deadlocks (`AppStore.at` hang). RunResource must adopt after queue proof. |
| **Docs** | Consolidate changeset; grep sweep; STORAGE.md should state RunResource auto-writes Store + facet, Process/Queue legacy-only until taps land. |

### RunResource owner recommendations (for discussion)

1. **Do not refactor the tap until Queue lands `storeTap.ts` and proves deadlock fix** — current lazy tap is stable, tested, and unblocks beta; premature migration risks regressions without the shared helper.
2. **When adopting `storeTap.ts`, re-run `Layer.mergeAll` sibling ordering tests** — the original lazy design addressed gate + Store as merge siblings; queue's forked-fiber design must pass the same composition before we delete lazy code.
3. **Keep dual-write (facet + Store) until Process and Queue cut over** — do not remove `RunResourceStore` early; ProcessStorage and sqlite examples still depend on facet reads.
4. **Cast removal is low-risk follow-up** — mirror `builtInQueueStoreContract` in `runResourceStoreSpec.ts`; may unblock tap cast at line 91 without waiting for `storeTap.ts`.
5. **Ship RunResource PR without blocking on store cutover** — handle/RPC/tag rename/store registration are done; open follow-up PR for `storeTap` migration tied to queue prototype merge.
6. **`RunResource.make` without Subscribables** — keep as-is (intentional slim API); observation lives on Tag/Service/layer handles only.

### Open decision for owner

When to drop legacy `RunResourceStore` facet — after all three engines on Store-only, or keep facet as read-optimized projection indefinitely?
