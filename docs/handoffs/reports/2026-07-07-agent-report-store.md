# Agent report: Store (platform)

**Branch:** `cursor/integration-result-schema-a3ad` — **Store typing commit `4597ee1`**  
**Agent:** Store / internal-store owner  
**Priority:** Medium — unblock resource engine taps and remove casts.

---

## Shipped on integration branch

Commit **`4597ee1`** — *precise handle resolution*:

| Change | Files |
|--------|-------|
| Generic `bridge.at` / `materializeStoreHandle` carry contract type through | `src/internal/store/bridge.ts`, `memoryScope.ts`, `scopeBridge.ts`, `sqliteLayer.ts` |
| `Tag.store` / `Resource.store` return precise `StoreHandleOf<C>` | `src/Store.ts` |
| Remove consumer `as unknown as` casts | `test/store.test.ts`, `test/store-default.test.ts`, `runResourceStoreTap.ts` |

**Action:** ensure all feature branches **merge integration** before adding new store consumers.

---

## Open issues

### 1. Default in-memory store (Stage 1 blocker)

From `2026-07-06-processstore-removal.md`:

- `Tag.store` / engine tap **fail** with `StoreScopeNotRegistered` when no `Store.Service` layer is provided.
- Agreed direction: **bounded default in-memory store** so engines always have a handle (no `serviceOption` branching).

**RunResource** worked around absence via lazy `Effect.option` on bridge + legacy facet. **Long-term:** default store in `layerDefaultMemory` / scope bridge.

**Task:** implement or confirm status of default store in `src/internal/store/scopeBridge.ts` / `memoryScope.ts`; update handoff when done.

### 2. Engine → Store not wired for Process or Queue

| Resource | New Store tap | Legacy facet |
|----------|---------------|--------------|
| RunResource | ✅ `runResourceStoreTap.ts` | ✅ `RunResourceStore` |
| Process | ❌ | ✅ `ProcessExecutionStore` |
| QueueResource | ❌ | ✅ `QueueResourceStore` |

Store agent **does not** own business events — resource agents add taps — but Store agent owns:

- Bridge API stability
- Registration / `facetStoreRegistration`
- Journal codec (`journalCodec.ts` — Effect Msgpack, no direct msgpackr)

### 3. `msgpackr` direct dependency — resolved on RunResource branch

Verify `package.json` has **no** direct `msgpackr` dep; journal uses `effect/unstable/encoding/Msgpack`. If typecheck fails on fresh install, fix via Effect API — do not re-add msgpackr without a consumer.

### 4. Queue store contract taxonomy

`builtInQueueStoreContract` is **entry-only**. Full facet taxonomy (lifecycle, dedupe, rate limit) port undecided — see processstore-removal handoff. Store agent documents contract shape; Queue agent decides event scope.

---

## Files (Store subsystem)

| Path | Role |
|------|------|
| `src/Store.ts` | Public aggregate API |
| `src/internal/store/bridge.ts` | `StoreScopeBridgeTag` |
| `src/internal/store/memoryScope.ts`, `scopeBridge.ts` | Default / memory resolution |
| `src/internal/store/sqliteLayer.ts` | Durable layers |
| `src/internal/store/journalCodec.ts` | Msgpack payload codec |
| `src/internal/store/*StoreSpec.ts` | Per-resource built-in contracts |
| `test/store.test.ts`, `test/store-default.test.ts`, `test/store.sqlite.test.ts` | Conformance |

---

## Verification

```bash
pnpm run typecheck
pnpm exec vitest run test/store.test.ts test/store-default.test.ts test/store.sqlite.test.ts
```

---

## Coordination

- **RunResource agent:** re-merge integration; drop tap cast if still present.
- **Process agent:** new `processStoreTap.ts` uses same lazy `bridge.at(scopeKey, contract.spec, contract)` pattern as RunResource.
- **Queue agent:** after rename, `builtInQueueStoreContract` reads `payloadOf(tag)`.
