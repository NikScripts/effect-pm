# Worktree + tmux setup — parallel agents (Jun 2026)

One repo (`github.com/NikScripts/effect-pm`). **Open the worktree path in Cursor/tmux — not the branch name alone.**

Transport slices 6.4–6.6 are **merged into hub**. The transport-only branch is retired for new work.

---

## Layout (authoritative)

| Tmux session | Worktree path | Branch | Agent | Prompt file |
| --- | --- | --- | --- | --- |
| **`effect-pm-alt`** | `/Users/nikolasstow/Coding/packages/effect-pm-alt` | `cursor/hub-runresource-vertical` | **Hub** — **bake first**, then RunResource tree restore | [`AGENT-PROMPT.md`](../../AGENT-PROMPT.md) · [telemetry-split-bake-handoff.md](./telemetry-split-bake-handoff.md) |
| **`effect-pm`** | `/Users/nikolasstow/Coding/packages/effect-pm-alt-transport` | `cursor/queue-telemetry-hub-migration` | **Queue migration** — after bake + RunResource pilot | transport `AGENT-PROMPT.md` |
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

## Architecture status (telemetry / state)

Canonical vocabulary: [21-state-vocabulary.md](../plans/21-state-vocabulary.md).

| Facet | Emit (target) | Emit (hub branch today) | Store | Telemetry state |
| --- | --- | --- | --- | --- |
| **RunResource** | `Telemetry.Service` tree → hub | `defineEvent` (**debt**) | Decoupled queries | **Not built** (kernel `Ref` wrong) |
| **QueueResource** | Same | `ProcessStore.telemetry` on store | Coupled | — |
| **Others** | Same | Coupled on store | Coupled | — |

**Next:** [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) — lock model before code.

**Implementation after bake:** hub worktree on `cursor/hub-runresource-vertical`.

---

## Handoff docs

| Doc | Agent |
| --- | --- |
| [architecture-hub-runresource-handoff.md](./architecture-hub-runresource-handoff.md) | Hub |
| [telemetry-split-bake-handoff.md](./telemetry-split-bake-handoff.md) | Owner / bake agent |
| [architecture-split-and-transports.md](../recipes/architecture-split-and-transports.md) | All |
| [src-reorganization.md](../plans/src-reorganization.md) | Both |
