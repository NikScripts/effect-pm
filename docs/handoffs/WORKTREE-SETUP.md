# Worktree + tmux setup — parallel agents (Jun 2026)

One repo (`github.com/NikScripts/effect-pm`). **Open the worktree path in Cursor/tmux — not the branch name alone.**

---

## Layout (authoritative)

| Tmux session | Worktree path | Branch | Agent | Prompt file |
| --- | --- | --- | --- | --- |
| **`effect-pm-alt`** | `/Users/nikolasstow/Coding/packages/effect-pm-alt` | `cursor/hub-runresource-vertical` | **Hub** — slice 6.3 done; integration target | [`AGENT-PROMPT.md`](../../AGENT-PROMPT.md) |
| **`effect-pm`** | `/Users/nikolasstow/Coding/packages/effect-pm-alt-transport` | `cursor/transport-protocol-unify` | **Transport** — 6.4–6.6 | [`../effect-pm-alt-transport/AGENT-PROMPT.md`](../../../effect-pm-alt-transport/AGENT-PROMPT.md) |
| **`epm-aa`** | `/Users/nikolasstow/Coding/packages/effect-pm` | `rewrite/store-transport` | **Integration only** — merge when ready; no feature work | [`../effect-pm/AGENT-PROMPT.md`](../../../effect-pm/AGENT-PROMPT.md) |

**Do not repoint** the `effect-pm-alt` tmux session or hub worktree branch without owner approval.

**Integration target (later):** merge both topic branches into `rewrite/store-transport`, then `develop` / `main`.

---

## Verify before coding

```sh
pwd
git branch --show-current
```

| If you see… | You should be… |
| --- | --- |
| `effect-pm-alt` + `cursor/hub-runresource-vertical` | Hub agent |
| `effect-pm-alt-transport` + `cursor/transport-protocol-unify` | Transport agent |
| `effect-pm` + `rewrite/store-transport` | Integration coordinator only |

---

## Quick commands

```sh
git -C ~/Coding/packages/effect-pm-alt worktree list

# Hub (effect-pm-alt tmux — do not change)
cd ~/Coding/packages/effect-pm-alt
git branch --show-current   # cursor/hub-runresource-vertical

# Transport (effect-pm tmux)
cd ~/Coding/packages/effect-pm-alt-transport
git checkout cursor/transport-protocol-unify

# Integration (epm-aa tmux)
cd ~/Coding/packages/effect-pm
git checkout rewrite/store-transport
```

---

## Ownership boundary

| Hub (`effect-pm-alt`) | Transport (`effect-pm-alt-transport`) |
| --- | --- |
| `TelemetryHub`, `sink/*`, `RunResourceProjection`, `telemetryTransport` | `storeTransport` Protocol unify |
| `src/store/runResource/**` | `ControlTransportHttp` (remove `/logs/stream`) |
| `/ws/telemetry` | `logTransport`, `controlTransport`, `terminalTransport` |

**Shared merge conflicts:** `package.json`, `tsup.config.ts`, `src/index.ts`, `ProcessStorage.ts`.

---

## Handoff docs

| Doc | Agent |
| --- | --- |
| [architecture-hub-runresource-handoff.md](./architecture-hub-runresource-handoff.md) | Hub |
| [architecture-transport-unify-handoff.md](./architecture-transport-unify-handoff.md) | Transport |
| [transport-protocol-unify-review.md](./transport-protocol-unify-review.md) | Transport |
| [architecture-split-and-transports.md](../recipes/architecture-split-and-transports.md) | Both |

---

## Status snapshot (2026-06-04)

| Slice | Hub branch | Transport branch |
| --- | --- | --- |
| 6.1 TelemetryHub | Done | — |
| 6.2 RunResource + ArchiveSink | Done | — |
| 6.3 Projection + telemetryTransport | Done on hub tip | — |
| 6.4 storeTransport Protocol unify | — | Mostly done; test/export gaps |
| 6.5 Control/log dedup | — | Not started |
| 6.6 terminalTransport v1 | — | Not started |
