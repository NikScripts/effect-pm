# Transport protocol unify + cleanup — parallel agent handoff

## Branch

```text
cursor/transport-protocol-unify
```

Branch from:

```text
rewrite/store-transport
```

**Do not** implement TelemetryHub, RunResource facet split, or projections — main
agent owns [`architecture-hub-runresource-handoff.md`](./architecture-hub-runresource-handoff.md).

Merge back into `rewrite/store-transport` (or main agent's topic branch) after CI green.
Expect touch conflicts only in export wiring (`src/index.ts`, `package.json`, `tsup.config.ts`).

---

## Role

**Parallel implementer.** Converges existing transports onto the locked architecture:
**one `RpcServer.Protocol`**, official Effect layers, camelCase modules, dedup control
HTTP surfaces. **No facet/telemetry/hub code.**

---

## Read first

| Doc | Why |
| --- | --- |
| [`docs/recipes/architecture-split-and-transports.md`](../recipes/architecture-split-and-transports.md) | Steps 4–5 locked (Protocol + transport mapping) |
| [`docs/plans/19-transport-boundaries.md`](../plans/19-transport-boundaries.md) | Transport ownership |
| [`docs/plans/16-effect-rpc-transport-migration.md`](../plans/16-effect-rpc-transport-migration.md) | Reframed: RPC = framing, not domain wrapper |
| [`src/internal/store/storeTransport.ts`](../../src/internal/store/storeTransport.ts) | Reference `makeNo*` loop (store) |
| [`repos/effect/packages/rpc/src/RpcServer.ts`](../../repos/effect/packages/rpc/src/RpcServer.ts) | Official `Protocol`, `layerProtocolWebsocketRouter` |

---

## Slice assignments (6.4 → 6.6)

### 6.4 — Store transport Protocol unify (priority)

**Goal:** Delete forked protocol; use Effect's `RpcServer.Protocol` directly.

**Tasks:**

- Rename `src/StoreTransportRpc.ts` → `src/storeTransport.ts` (export `storeTransport`).
- Remove `StoreTransportProtocol` and `layerProtocolFromRpc` from
  `src/internal/store/storeTransport.ts`.
- Refactor `makeNoStore` / `makeStore` / `serverLayer` to require `RpcServer.Protocol`
  from context (same as `RpcServer.makeNoSerialization` pattern).
- Update subpath exports: `@nikscripts/effect-pm/storeTransport` (keep old subpath as
  re-export alias **one release** if needed — prefer clean break + changeset note).
- Update `tsup.config.ts`, `package.json` exports, `src/index.ts`.
- Add/adjust test: in-memory or test protocol round-trip for one `RunResourceStore`
  registry query (reuse existing facet — no hub work).

**Do not change:** registry builder semantics, `layerRemote`, message shapes in
`StoreMessage.ts` (structurally identical to RpcMessage).

**Acceptance:**

- Grep: no `StoreTransportProtocol`, no `layerProtocolFromRpc`.
- `pnpm run typecheck && pnpm test && pnpm run build` green.
- Store server composes with `RpcServer.layerNdjson` + `layerProtocolWebsocketRouter`
  on path `/ws/store`.

### 6.5 — Control / log transport dedup

**Goal:** Align with transport boundaries; remove duplicated log surface from control HTTP.

**Tasks:**

1. **`ControlTransportHttp`** — remove `GET /logs/stream` handler; document migration
   to `logTransport` in module TSDoc (do not add new control routes for logs/history).
2. **Scaffold `logTransport.ts`** (camelCase) — begin `makeNo*` loop using
   `RpcServer.Protocol` + existing `LogStreamRequestSchema` / `ProcessManagerLogEntrySchema`
   from `LogTransportRpc.ts`. Can land as parallel module while `LogTransportRpc` re-exports
   deprecated alias briefly, or replace in one PR if small enough.
3. **Scaffold `controlTransport.ts`** — same pattern for `ControlProtocol` dispatch
   (one envelope in/out); `ControlTransportRpc` becomes thin re-export or deleted in
   same slice if owner approves breaking change.

**Out of scope:** Changing `ControlRouter` semantics or `ControlProtocol` shapes.

**Acceptance:**

- No `/logs/stream` route in `ControlTransportHttp`.
- Log live stream documented as `logTransport` + path `/ws/log`.
- Control dispatch path documented as `/ws/control`.

### 6.6 — `terminalTransport` v1 scaffold

**Goal:** Fifth transport exists; not forgotten; siloed from control.

**Tasks:**

- New module `src/terminalTransport.ts` — message schemas from `Terminal.ts`
  (`OpenTerminalSession`, `TerminalEvent`, input messages TBD from existing contracts).
- Server layer: `terminalTransport.serverLayer` using `RpcServer.Protocol` + bidirectional
  stream pattern (mirror log stream + control request/response where applicable).
- Path: `/ws/terminal`.
- Client factory stub + layer for tests.
- Subpath export + changeset note (minor).

**Do not implement:** Full dashboard terminal UI or PTY backend — wire + layer scaffold only.

**Acceptance:**

- Module composes under `layerProtocolWebsocketRouter` on `/ws/terminal`.
- No imports from TelemetryHub, archive facets, or hub sinks.
- Test: open session mock or protocol smoke test.

---

## Optional (if time, no conflict)

- Mark [`store-transport-rpc-handoff.md`](./store-transport-rpc-handoff.md) **completed**
  with pointer to architecture recipe (small docs PR).
- Add `docs/handoffs/README.md` index row for both new handoffs.
- Wire example layer snippet in `docs/plans/19-transport-boundaries.md` appendix showing
  five paths on one router (documentation only).

---

## Files — ownership boundary

| Parallel agent MAY edit | Parallel agent must NOT edit |
| --- | --- |
| `src/storeTransport.ts` (rename from StoreTransportRpc) | `src/internal/store/service.ts` facet factory |
| `src/internal/store/storeTransport.ts` (Protocol only) | `src/store/runResource/**` split |
| `src/controlTransport.ts`, `src/logTransport.ts`, `src/terminalTransport.ts` | New `TelemetryHub.ts` |
| `src/ControlTransportHttp.ts` (remove logs route) | Projection modules |
| `src/index.ts`, `package.json`, `tsup.config.ts` | Hub sinks / ArchiveSink |
| Tests for transport protocol | RunResource projection tests |

---

## Verification

```sh
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

---

## Suggested commits

1. `refactor(storeTransport): use RpcServer.Protocol; drop StoreTransportProtocol`
2. `fix(control): remove /logs/stream; route live logs to logTransport`
3. `feat(terminalTransport): v1 scaffold on /ws/terminal`
4. `refactor(logTransport): makeNo* loop with official Protocol` (if separate from 2)

Recommend **changeset** for export renames and removed HTTP route (behavior change for
anyone using control HTTP log stream).

---

## Coordination checklist before merge

- [ ] Main agent's `TelemetryHub` subpath does not collide with your export names.
- [ ] `/ws/telemetry` path reserved in router docs — main agent mounts telemetry server.
- [ ] Rebase onto main agent branch if hub landed first; resolve index/package conflicts.
- [ ] Combined branch: all 370+ tests pass.
