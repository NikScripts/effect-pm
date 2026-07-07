# Agent report: QueueResource + CustomQueueResource

**Branch:** `cursor/integration-result-schema-a3ad`  
**Agent:** Queue owner (owns CQR in same PR)  
**Priority:** **High** — triplet + engine cutover remain.

> **Correction (2026-07-07):** Tag positional arg is already **`payload`** on integration (`QueueResource.Tag(key, payload)`). This report’s “`itemSchema` not renamed” row is stale. Still open: `success`/`error`, config-object overload, stamps, engine `storeTap`.

---

## Current state

| Area | Status |
|------|--------|
| Tag factory uses `itemSchema` | ✅ positional → **`payload`** on integration; config object + triplet **open** |
| Tag triplet `payload` / `success` / `error` | ❌ not on public Tag API |
| Engine internal `itemSchema` in layer config | ⚠️ legacy — should read from tag stamp |
| `QueueResource.store(tag)` | ✅ built-in contract exists |
| Engine → new Store | ❌ still `QueueResourceStore` facet only (see `2026-07-06-processstore-removal.md`) |
| RPC wire on `add` | ✅ item is validated as RPC payload today |

RunResource and Process already use **`payload` / `success` / `error`** on tags. Queue is the drift risk.

---

## Required work

### 1. Tag factory rename (breaking)

**Target API** (from `result-schema-and-rpc-validation.md`):

```ts
QueueResource.Tag()(key, payload)
QueueResource.Tag()(key, payload, success)
QueueResource.Tag()(key, payload, success, error)
QueueResource.Tag()(key, { payload, success?, error?, description?, node? })
```

| Retire | Replace |
|--------|---------|
| `itemSchema` (Tag positional + config) | `payload` |
| (none today) | `success` — worker return / observation (TBD wire) |
| (none today) | `error` — worker failure channel (TBD wire) |

**Internal helpers** keep domain names where appropriate:

- `queueEntry(itemSchema)` param can stay **internal** name or rename param to `payloadSchema` for consistency — **public Tag config must say `payload`**.

**Persisted store rows:** keep `entry.item` in analytics payloads unless storage breaking change is approved.

### 2. Stamp symbols (mirror Process / RunResource)

Add `payloadSym` / `successSym` / `errorSym` (or read from tag fields) so `builtInQueueStoreContract(tag)` and engine read tag SSOT — no layer override.

### 3. CustomQueueResource

Same three slots after required `payload`; lane arity unchanged:

```ts
CustomQueueResource.Tag()(key, payload, levelCount, namedLevels?, { success?, error? })
```

One agent owns **both** QR and CQR in one PR to avoid split naming.

### 4. Engine + store (medium — may follow rename)

Per `2026-07-06-processstore-removal.md`:

- Engine still writes `QueueResourceStore` only, not `QueueResource.store`.
- Event taxonomy port (entry-only vs full lifecycle) **still undecided**.

**This agent:** complete rename first; engine tap is a **follow-up** unless sync assigns same agent.

### 5. Docs + tests

| Path | Action |
|------|--------|
| `src/QueueResource.ts`, `src/CustomQueueResource.ts` | Tag overloads |
| `src/internal/queueResource.ts`, `customQueueResource.ts` | Read tag stamps |
| `src/internal/store/queueStoreSpec.ts` | `queueEvent(payloadSchema)` |
| `test/queue-resource.test.ts`, `queue-contract.test.ts`, `queue-resource-api.test-d.ts` | Update |
| `docs/guides/queue-resource.md`, `RESOURCE-API.md`, `CODEBASE-INVENTORY.md` | Update |

---

## Verification

```bash
pnpm run typecheck
pnpm exec vitest run test/queue-resource.test.ts test/queue-contract.test.ts \
  test/queue-resource-api.test-d.ts test/queue-durable.sqlite.test.ts
```

---

## Critical notes

1. **Tag is SSOT** — layer config must not override `payload` / `success` / `error` (RPC client/server drift risk).
2. **`add` RPC payload** is already the queue item — renaming config to `payload` aligns language with `Resource.effectFn`.
3. **`success` / `error` on queue** — wire semantics for worker return vs item type need one paragraph in PR description (observation vs dequeue payload).
4. **Do not edit** `repos/`.

---

## Coordination

- **Process agent:** two-slot tag (no payload).
- **RunResource agent:** three-slot tag reference implementation.
- **Store agent:** `bridge.at` typing for `QueueResource.store` consumers after rename.
