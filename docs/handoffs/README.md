# Agent handoffs

**Worktree map:** [WORKTREE-SETUP.md](./WORKTREE-SETUP.md) — paths, branches, agent prompts.

Active handoffs for parallel architecture work (Jun 2026):

| Handoff | Agent | Worktree | Branch | Prompt |
| --- | --- | --- | --- | --- |
| [architecture-hub-runresource-handoff.md](./architecture-hub-runresource-handoff.md) | **Hub** — slice 6.3 projection, telemetryTransport | `effect-pm` | `cursor/hub-63-projection` | [`effect-pm/AGENT-PROMPT.md`](../../../effect-pm/AGENT-PROMPT.md) |
| [architecture-transport-unify-handoff.md](./architecture-transport-unify-handoff.md) | **Transport** — storeTransport, control/log, terminal | `effect-pm-alt-transport` | `cursor/transport-protocol-unify` | [`effect-pm-alt-transport/AGENT-PROMPT.md`](../../../effect-pm-alt-transport/AGENT-PROMPT.md) |

Authoritative architecture: [`docs/recipes/architecture-split-and-transports.md`](../recipes/architecture-split-and-transports.md).

Completed / stale: [store-transport-rpc-handoff.md](./store-transport-rpc-handoff.md) (store transport shipped on `rewrite/store-transport`).
