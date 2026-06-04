# Worktree setup — parallel agents (Jun 2026)

Two active worktrees on the same repo (`github.com/nikscripts/effect-pm`). Open **one Cursor window per worktree** when running agents in parallel.

---

## Layout

| Worktree path | Git role | Branch | Agent | Start here |
| --- | --- | --- | --- | --- |
| **`effect-pm`** | main worktree | `cursor/hub-63-projection` | **Hub** — slice 6.3 projection + telemetryTransport | [`../effect-pm/AGENT-PROMPT.md`](../../../effect-pm/AGENT-PROMPT.md) |
| **`effect-pm-alt`** | linked worktree | `cursor/hub-runresource-vertical` | **Hub integration** — merge target for 6.3 work | [`AGENT-PROMPT.md`](../../AGENT-PROMPT.md) |
| **`effect-pm-alt-transport`** | linked worktree | `cursor/transport-protocol-unify` | **Transport** — storeTransport, control/log, terminal | [`../effect-pm-alt-transport/AGENT-PROMPT.md`](../../../effect-pm-alt-transport/AGENT-PROMPT.md) |

**Integration target (later):** `rewrite/store-transport` → then `develop` / `main`.

---

## Quick commands

```sh
# List worktrees
git -C ~/Coding/packages/effect-pm-alt worktree list

# Hub agent — slice 6.3 (effect-pm)
cd ~/Coding/packages/effect-pm
git checkout cursor/hub-63-projection
pnpm install   # if fresh
pnpm run typecheck && pnpm test

# Hub integration branch (merge target)
cd ~/Coding/packages/effect-pm-alt
git checkout cursor/hub-runresource-vertical

# Transport agent (third window)
cd ~/Coding/packages/effect-pm-alt-transport
git checkout cursor/transport-protocol-unify
pnpm install   # if fresh
pnpm run typecheck && pnpm test
```

---

## Ownership boundary

| Hub 6.3 (`effect-pm`) | Transport (`effect-pm-alt-transport`) |
| --- | --- |
| `TelemetryHub`, `ArchiveSink` | `storeTransport` Protocol unify |
| `src/store/runResource/**` | `ControlTransportHttp` (remove `/logs/stream`) |
| `ProjectionSink`, `RunResourceProjection`, `telemetryTransport` | `logTransport`, `controlTransport`, `terminalTransport` |
| `/ws/telemetry` | `/ws/store`, `/ws/log`, `/ws/control`, `/ws/terminal` |

**Shared touch points (merge conflicts expected):** `package.json`, `tsup.config.ts`, `src/index.ts`, `ProcessStorage.ts`.

---

## Handoff docs

| Doc | Agent |
| --- | --- |
| [architecture-hub-runresource-handoff.md](./architecture-hub-runresource-handoff.md) | Hub |
| [architecture-transport-unify-handoff.md](./architecture-transport-unify-handoff.md) | Transport |
| [transport-protocol-unify-review.md](./transport-protocol-unify-review.md) | Transport (review blockers) |
| [architecture-split-and-transports.md](../recipes/architecture-split-and-transports.md) | Both (locked architecture) |

---

## Status snapshot (2026-06-04)

| Slice | Hub branch | Transport branch |
| --- | --- | --- |
| 6.1 TelemetryHub | Done | — |
| 6.2 RunResource split + ArchiveSink | Done | — |
| 6.3 Projection + telemetryTransport | **In progress** | — |
| 6.4 storeTransport Protocol unify | — | Mostly done; test/export gaps |
| 6.5 Control/log dedup | — | Not started |
| 6.6 terminalTransport v1 | — | Not started |

---

## Adding a third worktree (optional)

For a cheap-model mechanical pass (exports/docs only) **after** implementation lands:

```sh
git -C ~/Coding/packages/effect-pm-alt worktree add \
  ~/Coding/packages/effect-pm-alt-mechanical \
  cursor/hub-runresource-vertical
```

Point the agent at a single scoped task (e.g. “add `telemetryTransport` export mirroring `TelemetryHub`”). Do not run implementation agents on mechanical branches without rebasing onto latest hub tip.

---

## Cleanup notes

- Removed duplicate worktree was **restored** as `effect-pm-alt-transport` (transport agent home).
- Main worktree `effect-pm` parked on `rewrite/store-transport` — not an active agent slot.
