# Agent log — metrics-reset cleanup (2026-06-19)

## Salvage tags (preserve SHAs before branch deletes)

| Tag | SHA | Features preserved |
|-----|-----|-------------------|
| `salvage/command-auth-c64a` | c9c136bfd | CommandAuth, signed ControlTransportHttp, PM auth, keygen CLI |
| `salvage/control-transport-rpc-c64a` | f8d973956 | + ControlTransportRpc |
| `salvage/log-transport-rpc-c64a` | 2de0f2f27 | + LogTransportRpc, live log streaming |
| `salvage/remote-terminal-c64a` | ff9af6f7d | + Terminal, TerminalRpc, recipes |
| `salvage/dashboard-ops-ui-baec` | 4e20bba7f | ops-ui dashboard, StatusTables, LogViewer, shadcn |
| `salvage/integration-jun-2026` | ade46ecfd | merged c64a verticals (early State.ts — reference only) |
| `salvage/transport-protocol-unify` | cc761b79e | storeTransport, layerRemote spine — **reference only, rejected** |
| `archive/telemetry-redesign-bake-faed` | e4d15dba5 | CANCELLED State/Telemetry/Hub — do not transplant |

## Transplant queue (onto metrics-reset)

| # | Item | Status |
|---|------|--------|
| 1 | CommandAuth | ✅ 24e2eff75 |
| 2 | ControlTransportRpc | ✅ 8573f334a |
| 3 | LogTransportRpc | ✅ eb4cd7ce7 |
| 4 | storeTransport + layerRemote spine | ❌ **rejected** — big overhaul; no transplant |
| 5 | Terminal + ops-ui dashboard | ✅ c838dd6ad (Terminal), 850f702e3 (ops-ui) |

## Overhaul direction (locked 2026-06-19)

- **ProcessGroup as control boundary is dead.**
- Each Process / Resource owns its own RPC controls (`Rpc.make` / group on the resource).
- A compose **layer** starts the server and routes to whatever resources were registered for exposure.
- Salvaged group-centric control (`ControlProtocol`, `ControlRouter`, `ControlTransportRpc` envelope) is **legacy baseline** until rewrite lands.
- Keep: CommandAuth, Effect RPC patterns, Terminal/ops-ui as reference UI.

## Verification (2026-06-20)

- `pnpm run typecheck` — green
- `pnpm test` — 338/338
- `pnpm run lint` — green
- Branch: `metrics-reset` @ `850f702e3` (+ agent log commit)

## IDEAS only (from archive tag — use Effect Metric later)

- Domain event catalog: queue/process/run-resource events
- Projection/hydration pattern (without hub)

## Branches deleted in cleanup pass (2026-06-19)

Remote + local: telemetry-redesign-bake-faed, hub-runresource-vertical, hub-63-projection,
queue-telemetry-*, queue-facet-refactor-a3b5, facet/docs/restore 158c, rewrite/store-transport,
transport-protocol-unify, integration-jun-2026, all c64a verticals (SHAs in salvage/* tags).
Worktree removed: effect-pm-alt-transport.
