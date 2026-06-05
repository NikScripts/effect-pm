# Agent handoffs

**Worktree + tmux map:** [WORKTREE-SETUP.md](./WORKTREE-SETUP.md)

| Handoff | Agent | Worktree | Branch | Prompt |
| --- | --- | --- | --- | --- |
| [telemetry-split-bake-handoff.md](./telemetry-split-bake-handoff.md) | **Owner bake** | any | — | Lock model before code |
| [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) | Owner / bake agent | any | — | Recipe steps 1–7 |
| [architecture-hub-runresource-handoff.md](./architecture-hub-runresource-handoff.md) | Hub (post-bake) | `effect-pm-alt` | `cursor/hub-runresource-vertical` | [`AGENT-PROMPT.md`](../../AGENT-PROMPT.md) |
| [queue-telemetry-direct-emit-handoff.md](./queue-telemetry-direct-emit-handoff.md) | Queue (after bake) | `effect-pm-alt-transport` | `cursor/queue-telemetry-hub-migration` | transport `AGENT-PROMPT.md` |

**Integration (merge only):** `effect-pm` worktree on `rewrite/store-transport`.

**Authoritative architecture:** [architecture-split-and-transports.md](../recipes/architecture-split-and-transports.md).

**State vocabulary:** [21-state-vocabulary.md](../plans/21-state-vocabulary.md).

**Stale / merged:** [architecture-transport-unify-handoff.md](./architecture-transport-unify-handoff.md) (transport merged into hub), [store-transport-rpc-handoff.md](./store-transport-rpc-handoff.md).
