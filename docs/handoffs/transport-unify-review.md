# Transport unify branch — critical review (must fix before merge)

> **Historical (Jun 2026):** Transport slices merged into `cursor/hub-runresource-vertical`.
> Layout note: `src/store/runResource/` was replaced by flat `RunResource*.ts` files.

**Branch:** `cursor/transport-protocol-unify`  
**Commit reviewed:** `ce191ae` — `refactor(storeTransport): use RpcServer.Protocol; drop StoreTransportProtocol`  
**Reviewer:** main agent (Cursor)  
**Date:** 2026-06-04  
**Base at review time:** `5a20083` (docs architecture bake)  
**Parallel branch (main agent):** `cursor/hub-runresource-vertical` @ `45a1e70` (TelemetryHub + ArchiveSink + RunResource split)

---

## Verdict

**Do not merge as-is.**

The agent completed roughly **40% of slice 6.4** and **zero** of 6.5 / 6.6. The architectural direction (delete forked protocol, use `RpcServer.Protocol` directly) is correct, but the execution skips the work that makes the refactor trustworthy: tests, type safety, docs, and changeset hygiene.

---

## Handoff scope vs delivered

| Slice | Handoff | Status | Notes |
|-------|---------|--------|-------|
| **6.4** Store Protocol unify | Required | **Partial** | Fork removed, file renamed |
| **6.5** Control/log dedup | Required | **Not started** | `/logs/stream` still on control HTTP |
| **6.6** `terminalTransport` v1 | Required | **Not started** | Module does not exist |

**Assigned:** 6.4 → 6.6 (three slices).  
**Delivered:** one commit touching 6.4 only.

Reference handoff: [`architecture-transport-unify-handoff.md`](./architecture-transport-unify-handoff.md)

---

## What is acceptable

- Deleted `StoreTransportProtocol` and `layerProtocolFromRpc` from `src/internal/store/storeTransport.ts`.
- `makeStore` / `layerStore` now require `RpcServer.Protocol` from context.
- Renamed `src/StoreTransportRpc.ts` → `src/storeTransport.ts`; export `storeTransport`.
- Updated `package.json`, `tsup.config.ts`, `src/index.ts`, `ProcessStorage.ts` imports.
- Grep: no `StoreTransportProtocol`, no `layerProtocolFromRpc` in `src/`.
- `pnpm run typecheck`, `pnpm test` (370), `pnpm run lint` green on transport branch.

---

## Blockers (must fix)

### 1. No new tests — handoff acceptance explicitly required one

**Handoff 6.4 acceptance:**

> Add/adjust test: in-memory or test protocol round-trip for one `RunResourceStore` registry query

**Finding:** There is **no test** under `test/` that references `storeTransport`, `layerStore`, `makeNoStore`, or protocol round-trip. The refactor deleted ~118 lines of adapter code and added **zero** proof that `RpcServer.Protocol` composes with the store server loop.

370 passing tests only means nothing regressed; it does **not** validate the unify.

**Required:** Add something like `test/store-transport-protocol.test.ts`:

- In-memory or test `RpcServer.Protocol` layer
- `storeTransport.serverLayer(ProcessStore.registry([RunResourceStore]))`
- Client via `storeTransport.makeClient` + `toProcessStoreQueryClient`
- Assert one query (e.g. `RunResourceStore.facts`) round-trips

---

### 2. `as any` at the protocol boundary — violates repo standards

**File:** `src/internal/store/storeTransport.ts` (in `makeStore`)

```typescript
send(clientId, response as any)
run((clientId: number, message: any) => server.write(clientId, message))
```

We removed the bridge to get **one** protocol type. Replacing structural compatibility with `any` defeats the purpose. The messages were structurally compatible before (`FromClientEncoded` / `FromServerEncoded` vs RPC encoded types); express that with proper narrowing — **no unsafe casts**.

**Required:** Remove both `as any`. Typecheck under `tsconfig.src.strict-effect-provide.json` must stay green.

---

### 3. Breaking export rename without migration path

**Handoff:**

> Update subpath: `@nikscripts/effect-pm/storeTransport` (keep old subpath as re-export alias **one release** if needed)

**Finding:**

- `./StoreTransportRpc` removed from `package.json` with **no alias**.
- `src/index.ts` still exports `makeClient as makeStoreTransportRpcClient` — inconsistent naming.
- `.changeset/store-transport-rpc.md` still documents **old** API (`StoreTransportRpc`, `layerProtocolFromRpc`, `Protocol`).

**Required (pick one, document in changeset):**

- **A)** Re-add `@nikscripts/effect-pm/StoreTransportRpc` subpath as deprecated re-export for one release, **or**
- **B)** Hard break + new changeset describing rename and migration (`storeTransport`, no bridge).

Either way: **update or replace the changeset**; do not ship with stale `store-transport-rpc.md` content.

---

### 4. Naming: `storeTransportApi` violates conventions

Architecture bake (step 4): **camelCase modules, PascalCase types**.

`export interface storeTransportApi` is wrong. Rename to `StoreTransportApi` (or similar PascalCase).

---

### 5. Documentation still describes deleted architecture

Still wrong or stale after refactor:

| File | Problem |
|------|---------|
| `docs/recipes/store-transport-rpc.md` | Still documents `StoreTransportProtocol`, `layerProtocolFromRpc` |
| `.changeset/store-transport-rpc.md` | Still `StoreTransportRpc` + bridge API |
| `docs/handoffs/store-transport-rpc-handoff.md` | Historical; mark completed or add pointer |
| Module TSDoc in `storeTransport.ts` | Updated ✓; rest of doc surface was not |

**Required:** Update recipe + changeset. Optionally mark old handoff complete with pointer to [`architecture-split-and-transports.md`](../recipes/architecture-split-and-transports.md).

---

### 6. Compose examples may reference wrong Effect APIs

**In `src/storeTransport.ts` TSDoc examples:**

```typescript
Layer.provide(RpcServer.layerNdjson)
```

In vendored `repos/effect/packages/rpc`, **`layerNdjson` is on `RpcSerialization`**, not `RpcServer`. Verify against `repos/effect/` before documenting.

Handoff mentions `layerProtocolWebsocketRouter` on `/ws/store`; examples use `layerProtocolWebsocket`. Align with actual Effect APIs and locked paths in [`architecture-split-and-transports.md`](../recipes/architecture-split-and-transports.md).

**Required:** Examples must match vendored Effect; add test or example that actually composes the stack.

---

## Slice 6.5 — not started (architecture still violated)

Handoff tasks **untouched**:

1. **`ControlTransportHttp`** — remove `GET /logs/stream` (still at ~line 526 in `src/ControlTransportHttp.ts`).
2. **Scaffold `logTransport.ts`** — `makeNo*` loop with `RpcServer.Protocol`.
3. **Scaffold `controlTransport.ts`** — control envelope dispatch.

**Still present on branch:**

- `/logs/stream` route in `ControlTransportHttp`
- Tests hitting `/logs/stream`: `test/control-service-contract.test.ts`, `test/control-plane-fetch.test.ts`
- React: `src/react/controlHttp.ts` builds `/logs/stream` URLs
- Internal: `src/internal/manager/groupLogWatch.ts`

**Acceptance (6.5):**

- No `/logs/stream` in `ControlTransportHttp`.
- Log live stream documented as `logTransport` + `/ws/log`.
- Control dispatch documented as `/ws/control`.

---

## Slice 6.6 — not started

**Required:**

- New `src/terminalTransport.ts` — schemas from `Terminal.ts`, server layer on `RpcServer.Protocol`, path `/ws/terminal`.
- Client factory stub + smoke test.
- Subpath export + changeset note.

**Must not import:** TelemetryHub, archive facets, hub sinks.

---

## Minor / boundary notes

- Handoff said **must NOT edit** `src/internal/store/service.ts` facet factory; branch only changed a comment. Acceptable but avoid further edits.
- `makeStore` lost explicit `Effect.Effect<never, never, ...>` return type; restore if inference weakens.
- `Effect.asVoid` on `run(...)` — confirm this matches prior `never`-returning behavior.

---

## Merge coordination with main agent branch

Main branch `cursor/hub-runresource-vertical` adds:

- `TelemetryHub`, `ArchiveSink`
- `src/store/runResource/` split (telemetry / archive / projection stub)
- New subpaths: `./TelemetryHub`, `./ArchiveSink`
- 378 tests (vs 370 on transport branch)

**Expected conflict zones on merge:**

- `package.json`
- `tsup.config.ts`
- `src/index.ts`
- `src/ProcessStorage.ts`
- Possibly `src/internal/store/service.ts`

**Before merge:**

1. Rebase transport branch onto latest `cursor/hub-runresource-vertical` (or `rewrite/store-transport` after both land).
2. Resolve export wiring; preserve both `storeTransport` rename and hub/archive subpaths.
3. Combined suite must be **378+** tests green (plus new store transport test).

**Reserved path:** `/ws/telemetry` — main agent mounts telemetry transport; do not collide.

---

## Required checklist before merge approval

- [ ] **Test:** protocol round-trip for one `RunResourceStore` registry query
- [ ] **Types:** zero `as any` in `makeStore` protocol wiring
- [ ] **Exports:** migration alias or documented breaking changeset
- [ ] **Types:** rename `storeTransportApi` → PascalCase
- [ ] **Docs:** update `store-transport-rpc.md` recipe + changeset body
- [ ] **Examples:** correct `RpcSerialization` / `RpcServer` layer names from vendored Effect
- [ ] **6.5:** remove `/logs/stream` from control HTTP; scaffold `logTransport` (+ `controlTransport` if in scope)
- [ ] **6.6:** `terminalTransport` v1 scaffold + smoke test
- [ ] **Rebase** onto main agent branch; all tests green
- [ ] **Changeset** for export renames and removed HTTP route (if 6.5 ships)

---

## Suggested commit order (remaining work)

1. `test(storeTransport): protocol round-trip for RunResourceStore.facts`
2. `fix(storeTransport): remove any casts at Protocol boundary`
3. `docs(changeset): storeTransport rename + migration`
4. `fix(control): remove /logs/stream; route live logs to logTransport` (6.5)
5. `feat(terminalTransport): v1 scaffold on /ws/terminal` (6.6)

---

## Paste path for agent

```text
docs/handoffs/transport-unify-review.md
```

Full path (transport worktree):

```text
/Users/nikolasstow/Coding/packages/effect-pm-alt-transport/docs/handoffs/transport-unify-review.md
```
