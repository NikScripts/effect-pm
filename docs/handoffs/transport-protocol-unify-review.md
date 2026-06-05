# Transport branch review — `cursor/transport-protocol-unify`

**Reviewed:** 2026-06-04  
**Commit reviewed:** `ce191ae` (`refactor(storeTransport): use RpcServer.Protocol; drop StoreTransportProtocol`)  
**Base:** `5a20083` (architecture docs handoff)  
**Reviewer:** Main agent (Cursor) — critical / merge-blocking standards  

**Branch:** `cursor/transport-protocol-unify`  
**Worktree:** `effect-pm-alt-transport`

---

## Verdict

**Do not merge as-is.**

The agent did the obvious rename/delete for slice **6.4** and stopped. Direction is correct; execution is incomplete and below repo standards. Slices **6.5** and **6.6** were not started.

| Handoff slice | Status | Notes |
|---------------|--------|-------|
| **6.4** Store Protocol unify | **Partial** | Fork removed, rename done |
| **6.5** Control/log dedup | **Not done** | `GET /logs/stream` still live on control HTTP |
| **6.6** `terminalTransport` v1 | **Not done** | Module does not exist |

---

## What shipped (the good — small)

- **Correct architectural move:** delete `StoreTransportProtocol` + `layerProtocolFromRpc`; wire `makeStore` to `RpcServer.Protocol` directly.
- **Grep acceptance for 6.4 symbols:** no `StoreTransportProtocol` / `layerProtocolFromRpc` left in `src/`.
- **CI green on branch:** typecheck, lint, 370 tests pass.
- **Net deletion:** ~118 lines of adapter boilerplate removed.

That is the minimum bar for the easy part of 6.4. It is not a finished slice.

---

## Merge blockers (must fix)

### 1. Zero new tests — handoff explicitly required one

**Handoff (`architecture-transport-unify-handoff.md`, slice 6.4):**

> Add/adjust test: in-memory or test protocol round-trip for one `RunResourceStore` registry query

**Finding:** No `storeTransport` test file. Grep over `test/` finds no coverage of `storeTransport.serverLayer`, `makeClient`, or Protocol compose.

370 passing tests only mean regression did not fire. They do **not** prove `RpcServer.Protocol` + `makeNoStore` + client round-trip works after removing the bridge.

**Required:**

- [ ] Add test: in-memory (or test protocol) round-trip for at least one registry query, e.g. `RunResourceStore.facts`.
- [ ] Test composes `storeTransport.serverLayer` with a real `RpcServer.Protocol` layer (not a mock that bypasses the boundary).
- [ ] Test fails if `makeStore` / `layerStore` Protocol wiring regresses.

---

### 2. `as any` at the Protocol boundary — violates repo type-safety policy

**File:** `src/internal/store/storeTransport.ts` (in `makeStore`)

```typescript
send(clientId, response as any)
run((clientId: number, message: any) => server.write(clientId, message))
```

We removed the bridge to get **one** protocol type. Replacing structural compatibility with `any` is not unification — it gives up typing at the exact boundary that matters.

**Required:**

- [ ] Remove both `as any` casts.
- [ ] Use proper narrowing or shared wire types (`FromClientEncoded` / `FromServerEncoded` ↔ RpcMessage) so the hot path is type-safe without casts.
- [ ] If Effect RPC types and `StoreMessage` types diverge, fix the message definitions — do not paper over with `any`.

---

### 3. Breaking export rename with no migration path

**Handoff:**

> Update subpath exports: `@nikscripts/effect-pm/storeTransport` (keep old subpath as re-export alias **one release** if needed)

**Finding:**

- `./StoreTransportRpc` removed from `package.json` with **no alias**.
- `index.ts` still exports `makeClient as makeStoreTransportRpcClient` — inconsistent naming.
- `.changeset/store-transport-rpc.md` still documents **old** API (`StoreTransportRpc`, `layerProtocolFromRpc`, `Protocol`).

**Required (pick one policy and apply consistently):**

- [ ] **Option A:** Re-add `@nikscripts/effect-pm/StoreTransportRpc` subpath as deprecated re-export for one release; document in changeset.
- [ ] **Option B:** Hard break — update changeset to describe rename/removals; remove `makeStoreTransportRpcClient` alias or rename to match `storeTransport`.

---

### 4. Naming conventions ignored

Architecture bake: **camelCase modules, PascalCase types**.

**Finding:** Exported interface named `storeTransportApi` (camelCase type name).

**Required:**

- [ ] Rename to `StoreTransportApi` (or equivalent PascalCase) per project convention.

---

### 5. Documentation still describes deleted architecture

Module TSDoc in `storeTransport.ts` was updated. Rest of doc surface was not.

**Stale / wrong after refactor:**

| File | Problem |
|------|---------|
| `docs/recipes/store-transport-rpc.md` | Still documents `StoreTransportProtocol`, `layerProtocolFromRpc` |
| `.changeset/store-transport-rpc.md` | Still `StoreTransportRpc` + bridge API |
| `docs/recipes/architecture-split-and-transports.md` (on branch) | Still says fork exists |

**Required:**

- [ ] Update or supersede `store-transport-rpc.md` to match Protocol-unified compose.
- [ ] Update changeset for export rename + removed symbols.
- [ ] Mark `docs/handoffs/store-transport-rpc-handoff.md` completed with pointer to architecture recipe (handoff optional task).

---

### 6. Example compose code may be wrong

**Finding:** Examples use `RpcServer.layerNdjson`. In vendored Effect (`repos/effect/packages/rpc`), **`layerNdjson` is on `RpcSerialization`**, not `RpcServer`.

Handoff mentions `layerProtocolWebsocketRouter`; examples use `layerProtocolWebsocket`. Nobody validated the stack against vendored Effect.

**Required:**

- [ ] Fix server compose examples to use APIs that exist in vendored Effect.
- [ ] Prefer `layerProtocolWebsocketRouter` if that is the locked architecture path for multi-transport router.
- [ ] Add test or example that typechecks / runs the documented layer stack.

---

## Slice 6.5 — not started (architecture still violated)

**Handoff tasks untouched:**

1. Remove `GET /logs/stream` from `ControlTransportHttp`.
2. Scaffold `logTransport.ts` (camelCase) with `makeNo*` + `RpcServer.Protocol`.
3. Scaffold `controlTransport.ts` for `ControlProtocol` dispatch.

**Still present on branch:**

- `ControlTransportHttp.ts` — `/logs/stream` handler (~line 526).
- Tests still hit `/logs/stream` (`control-service-contract.test.ts`, `control-plane-fetch.test.ts`, etc.).
- `src/react/controlHttp.ts`, `groupLogWatch.ts` still build log stream URLs on control HTTP.

**Required for 6.5:**

- [ ] Remove `/logs/stream` from control HTTP server.
- [ ] Document migration to `logTransport` + path `/ws/log` in module TSDoc.
- [ ] Scaffold `logTransport.ts` and `controlTransport.ts` per handoff (can land incrementally with deprecated re-exports from `LogTransportRpc` / `ControlTransportRpc` if needed).
- [ ] Update or migrate tests that depend on control HTTP log stream (or mark as intentional until clients migrate — document explicitly).

---

## Slice 6.6 — not started

**Handoff:** `src/terminalTransport.ts` — v1 scaffold on `/ws/terminal`, Protocol + smoke test.

**Required:**

- [ ] New module `terminalTransport.ts` with server layer using `RpcServer.Protocol`.
- [ ] Subpath export + changeset note.
- [ ] Test: protocol smoke or mock session open.
- [ ] No imports from TelemetryHub, archive facets, or hub sinks.

---

## Other notes

### `makeStore` return typing weakened

Explicit `Effect.Effect<never, never, ...>` return was removed from `makeStore`. `Effect.asVoid` was added on `run(...)`. Verify this does not mask incorrect `run` completion semantics.

### Boundary touch

Handoff: parallel agent **must NOT** edit `src/internal/store/service.ts` (facet factory). Branch has a **comment-only** change. Avoid further edits unless coordinated.

### Merge with main agent branch

Main branch (`cursor/hub-runresource-vertical`) adds: `TelemetryHub`, `ArchiveSink`, RunResource split, new subpaths.

**Expect conflicts in:** `package.json`, `tsup.config.ts`, `src/index.ts`, `ProcessStorage.ts`, possibly `service.ts`.

**Before merge:**

- [ ] Rebase onto latest main transport topic branch (or `rewrite/store-transport` after both land).
- [ ] Combined test suite must be **378+** tests (main added 8); all green.
- [ ] Reserve `/ws/telemetry` in router docs for main agent — do not collide.

---

## Acceptance checklist (repeat from handoff — not met)

### 6.4

- [x] Grep: no `StoreTransportProtocol`, no `layerProtocolFromRpc` in `src/`
- [ ] **Test:** protocol round-trip for one registry query
- [ ] **Type-safe** Protocol boundary (no `as any`)
- [x] `pnpm run typecheck && pnpm test && pnpm run build` green
- [ ] Store server compose example validated against vendored Effect APIs
- [ ] Changeset / export migration policy applied

### 6.5

- [ ] No `/logs/stream` in `ControlTransportHttp`
- [ ] Log live stream documented as `logTransport` + `/ws/log`
- [ ] Control dispatch documented as `/ws/control`

### 6.6

- [ ] `terminalTransport` composes under websocket router on `/ws/terminal`
- [ ] Smoke test exists

---

## Suggested commit order (remaining work)

1. `fix(storeTransport): type-safe Protocol wiring; add round-trip test`
2. `docs(changeset): storeTransport rename and removed bridge API`
3. `fix(control): remove /logs/stream; route live logs to logTransport`
4. `feat(logTransport): makeNo* scaffold with RpcServer.Protocol`
5. `feat(terminalTransport): v1 scaffold on /ws/terminal`
6. `docs: mark store-transport handoff complete; update recipes`

---

## Scorecard

| Criterion | Grade |
|-----------|-------|
| Architectural intent | B+ |
| Completeness vs handoff | D (1/3 slices, partial 6.4) |
| Type safety | F (`as any`) |
| Test discipline | F (no new tests) |
| Docs/changeset hygiene | F |
| Breaking-change hygiene | D |
| **Ready to merge** | **No** |

---

## Agent instruction (paste this path)

Read this file first, then implement **every unchecked item** in **Merge blockers** and **Slices 6.5–6.6** before requesting review again:

```
docs/handoffs/transport-protocol-unify-review.md
```

Authoritative handoff spec (unchanged):

```
docs/handoffs/architecture-transport-unify-handoff.md
```

Architecture context:

```
docs/recipes/architecture-split-and-transports.md
docs/plans/19-transport-boundaries.md
```
