# Agent handoffs

**Worktree + tmux map:** [WORKTREE-SETUP.md](./WORKTREE-SETUP.md)

| Handoff | Agent | Worktree | Branch | Prompt |
| --- | --- | --- | --- | --- |
| [run-resource-service-handoff.md](./run-resource-service-handoff.md) | **RunResource service** | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | Domain `Context.Service` + tag/kernel split; **before telemetry Step 1** |
| [telemetry-implementation-handoff.md](./telemetry-implementation-handoff.md) | Telemetry impl | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | After / parallel R1–R4 from run-resource handoff |
| [telemetry-step52-transition-handoff.md](./telemetry-step52-transition-handoff.md) | Telemetry impl | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | **Start here** — Phase A: two-tier branch stack + dual API ([bake](../recipes/state-transition-op-provide-bake.md)) |
| [telemetry-phase-a-review.md](./telemetry-phase-a-review.md) | Owner review | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | **Phase A review** @ `027dfe033` — scope-owned SSOT, blockers, fix order |
| [telemetry-step5-emit-handoff.md](./telemetry-step5-emit-handoff.md) | Telemetry impl | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | Broader Step 5–6 emit + runtime roadmap |
| [state-root-telemetry-resume-handoff.md](./state-root-telemetry-resume-handoff.md) | Telemetry impl | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | State.Root + snapshot bake context; issue register mirror |
| [telemetry-branch-issues.md](./telemetry-branch-issues.md) | Telemetry impl | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | **Issue register** — spec drift, op/event rules, P0–P2 triage |
| [telemetry-tag-state-wiring-api-handoff.md](./telemetry-tag-state-wiring-api-handoff.md) | **Owner — API DX bake** | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | Tag / State / Wiring / Service **DX only** — framing superseded by decisions doc |
| [telemetry-redesign-decisions.md](./telemetry-redesign-decisions.md) | **Owner — redesign** | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | **Working decisions** — catalog + scope/op tree + Effect-primitive backing; supersedes the DX handoff framing |
| [telemetry-api-surface.md](./telemetry-api-surface.md) | **Owner — API surface** | `effect-pm-alt-transport` | `cursor/telemetry-redesign-bake-faed` | **Method inventory** — every State/Telemetry method + class method; forms documented class-by-class |
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
