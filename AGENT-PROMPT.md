# Hub + transport vertical — merged integration branch

**Worktree:** `/Users/nikolasstow/Coding/packages/effect-pm-alt`  
**Branch:** `cursor/hub-runresource-vertical`  
**Tmux session:** `effect-pm-alt`  
**Status:** Hub slices 6.1–6.3 + transport slices 6.4–6.6 merged on this branch.

**Transport-only worktree (optional):** `effect-pm-alt-transport` on `cursor/transport-protocol-unify` — see [`../effect-pm-alt-transport/AGENT-PROMPT.md`](../effect-pm-alt-transport/AGENT-PROMPT.md)

---

## Shipped on this branch

| Slice | Deliverable |
| --- | --- |
| 6.1–6.2 | TelemetryHub, RunResource split, ArchiveSink |
| 6.3 | ProjectionSink, BroadcastSink, RunResourceProjection, telemetryTransport |
| 6.4 | storeTransport → `RpcServer.Protocol`; `@nikscripts/effect-pm/storeTransport` |
| 6.5 | `/logs/stream` removed from control HTTP; `logTransport`, `controlTransport` scaffolds |
| 6.6 | `terminalTransport` v1 scaffold on `/ws/terminal` |

---

## Deferred / follow-up

| Slice | Status |
| --- | --- |
| 6.7 ProcessArchive rename + domain folders | Hub follow-up |
| Client migration off deprecated `/logs/stream` URLs | In progress on transport branch |
| Integration merge into `rewrite/store-transport` | Use `effect-pm` worktree when ready |

---

## Verification

```sh
git branch --show-current   # cursor/hub-runresource-vertical
pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build
```

---

## Read first

1. [`docs/handoffs/WORKTREE-SETUP.md`](./docs/handoffs/WORKTREE-SETUP.md)
2. [`docs/handoffs/architecture-hub-runresource-handoff.md`](./docs/handoffs/architecture-hub-runresource-handoff.md)
3. [`docs/handoffs/architecture-transport-unify-handoff.md`](./docs/handoffs/architecture-transport-unify-handoff.md)
4. [`docs/recipes/architecture-split-and-transports.md`](./docs/recipes/architecture-split-and-transports.md)
