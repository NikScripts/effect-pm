# Worktree + tmux setup — parallel agents (Jun 2026)

One repo (`github.com/NikScripts/effect-pm`). **Open the worktree path in Cursor/tmux — not the branch name alone.**

Transport slices 6.4–6.6 are **merged into hub**. The transport-only branch is retired for new work.

---

## Layout (authoritative)

| Tmux session | Worktree path | Branch | Agent | Prompt file |
| --- | --- | --- | --- | --- |
| **`effect-pm-alt`** | `/Users/nikolasstow/Coding/packages/effect-pm-alt` | `cursor/hub-runresource-vertical` | **Hub** — RunResource pilot, 6.7 follow-up, transport already merged | [`AGENT-PROMPT.md`](../../AGENT-PROMPT.md) |
| **`effect-pm`** | `/Users/nikolasstow/Coding/packages/effect-pm-alt-transport` | `cursor/queue-telemetry-hub-migration` | **Queue migration** — hub telemetry pattern for QueueResource | [`../effect-pm-alt-transport/AGENT-PROMPT.md`](../../../effect-pm-alt-transport/AGENT-PROMPT.md) |
| **`epm-aa`** | `/Users/nikolasstow/Coding/packages/effect-pm` | `rewrite/store-transport` | **Integration only** — merge when ready; no feature work | [`../effect-pm/AGENT-PROMPT.md`](../../../effect-pm/AGENT-PROMPT.md) |

**Do not repoint** the `effect-pm-alt` tmux session or hub worktree branch without owner approval.

**Integration target:** merge topic branches into `rewrite/store-transport`, then `develop` / `main`.

---

## Verify before coding

```sh
pwd
git branch --show-current
```

| If you see… | You should be… |
| --- | --- |
| `effect-pm-alt` + `cursor/hub-runresource-vertical` | Hub agent |
| `effect-pm-alt-transport` + `cursor/queue-telemetry-hub-migration` | Queue migration agent |
| `effect-pm` + `rewrite/store-transport` | Integration coordinator only |

---

## Quick commands

```sh
git -C ~/Coding/packages/effect-pm-alt worktree list

# Hub
cd ~/Coding/packages/effect-pm-alt
git branch --show-current   # cursor/hub-runresource-vertical

# Queue migration (effect-pm tmux)
cd ~/Coding/packages/effect-pm-alt-transport
git fetch origin
git checkout cursor/queue-telemetry-hub-migration

# Integration (epm-aa tmux)
cd ~/Coding/packages/effect-pm
git checkout rewrite/store-transport
```

### Create queue migration branch (once)

```sh
cd ~/Coding/packages/effect-pm-alt
git branch cursor/queue-telemetry-hub-migration cursor/hub-runresource-vertical
git -C ~/Coding/packages/effect-pm-alt-transport checkout cursor/queue-telemetry-hub-migration
```

---

## Ownership boundary

| Hub (`effect-pm-alt`) | Queue agent (`effect-pm-alt-transport`) |
| --- | --- |
| `TelemetryHub`, `sink/*`, `RunResource*`, `telemetryTransport` | `queueResource.ts` → `QueueResourceStore.ts` + `QueueResourceTelemetry.ts` |
| `ProcessStorage` / ProcessArchive rename | `QueueResource.ts` worker emit migration |
| Transport modules (already merged) | — |

**Shared merge conflicts:** `package.json`, `tsup.config.ts`, `src/index.ts`, `ProcessStorage.ts`.

---

## Architecture status (telemetry vs storage)

| Facet | Emit path | Store path | Coupled? |
| --- | --- | --- | --- |
| **RunResource** (pilot) | `TelemetryHub` via `RunResourceTelemetry` | `RunResourceStore` queries + optional `ArchiveSink` | **No** — split modules, opt-in persist |
| **QueueResource** | `QueueResourceStore.Entry.*` via `ProcessStore.telemetry` spine | Same facet class | **Yes** — legacy |
| **Log, ProcessExecution, ProcessGroup, ProcessLifecycle** | `ProcessStore.telemetry(...)` inside facet | Same facet class | **Yes** — legacy |

See [`docs/plans/20-process-store-split-and-telemetry.md`](../plans/20-process-store-split-and-telemetry.md).

---

## Handoff docs

| Doc | Agent |
| --- | --- |
| [architecture-hub-runresource-handoff.md](./architecture-hub-runresource-handoff.md) | Hub |
| [architecture-split-and-transports.md](../recipes/architecture-split-and-transports.md) | Both |
| [src-reorganization.md](../plans/src-reorganization.md) | Both |
