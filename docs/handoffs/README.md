# Agent handoffs

**Worktree + tmux map:** [WORKTREE-SETUP.md](./WORKTREE-SETUP.md)

| Handoff | Agent | Worktree | Branch | Prompt |
| --- | --- | --- | --- | --- |
| [run-resource-service-handoff.md](./run-resource-service-handoff.md) | **RunResource service** | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | Domain `Context.Service` + tag/kernel split; **before telemetry Step 1** |
| [telemetry-implementation-handoff.md](./telemetry-implementation-handoff.md) | Telemetry impl | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | After / parallel R1–R4 from run-resource handoff |
| [state-root-telemetry-resume-handoff.md](./state-root-telemetry-resume-handoff.md) | Telemetry impl | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | **Read before resuming after Step 3a** — `State.Root` lock + pause Step 5–6 |
| [telemetry-split-bake-prompt.md](./telemetry-split-bake-prompt.md) | **Owner — paste to start** | any | — | Docs-only bake; recommended + DX forks |
| [telemetry-split-bake-handoff.md](./telemetry-split-bake-handoff.md) | Owner bake | any | — | Context + after-bake order |
| [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) | Bake agent | any | — | **Historical** bake ledger — prefer requirements doc |
| [architecture-hub-runresource-handoff.md](./architecture-hub-runresource-handoff.md) | Hub (post-bake) | `effect-pm-alt` | `cursor/hub-runresource-vertical` | [`AGENT-PROMPT.md`](../../AGENT-PROMPT.md) |
| [queue-telemetry-direct-emit-handoff.md](./queue-telemetry-direct-emit-handoff.md) | Queue (after bake) | `effect-pm-alt-transport` | `cursor/queue-telemetry-hub-migration` | transport `AGENT-PROMPT.md` |

**Integration (merge only):** `effect-pm` worktree on `rewrite/store-transport`.

**Authoritative architecture:** [architecture-split-and-transports.md](../recipes/architecture-split-and-transports.md).

**State vocabulary:** [21-state-vocabulary.md](../plans/21-state-vocabulary.md).

**Telemetry implementation SSoT:** [telemetry-requirements.md](../recipes/telemetry-requirements.md).

**Stale / merged:** [architecture-transport-unify-handoff.md](./architecture-transport-unify-handoff.md) (transport merged into hub), [store-transport-rpc-handoff.md](./store-transport-rpc-handoff.md).
