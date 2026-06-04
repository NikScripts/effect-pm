# Hub agent — slice 6.3 complete

**Worktree:** `/Users/nikolasstow/Coding/packages/effect-pm-alt`  
**Branch:** `cursor/hub-runresource-vertical`  
**Tmux session:** `effect-pm-alt`  
**Status:** **Slice 6.3 done** — awaiting transport agent (6.4–6.6) before integration merge.

**Parallel agent:** transport on `effect-pm-alt-transport` → [`../effect-pm-alt-transport/AGENT-PROMPT.md`](../effect-pm-alt-transport/AGENT-PROMPT.md)

---

## Shipped (6.1 + 6.2 + 6.3)

| Slice | Deliverable | Where |
| --- | --- | --- |
| 6.1 | TelemetryHub core | `src/TelemetryHub.ts`, `src/internal/telemetryHub/` |
| 6.2 | RunResource telemetry + archive split | `src/store/runResource/telemetry.ts`, `archive.ts` |
| 6.2 | ArchiveSink | `src/sink/ArchiveSink.ts` |
| 6.3 | ProjectionSink | `src/sink/ProjectionSink.ts` |
| 6.3 | BroadcastSink + TelemetryBroadcast | `src/sink/BroadcastSink.ts` |
| 6.3 | RunResourceProjection + hydrate | `src/RunResourceProjection.ts` |
| 6.3 | telemetryTransport v1 | `src/telemetryTransport.ts` |
| 6.3 | Tests (385 total) | `test/run-resource-projection.test.ts`, `test/telemetry-transport.test.ts` |

**Acceptance:** all three 6.3 criteria covered by tests.

---

## Hub agent — do not start until transport lands

| Slice | Owner | Status |
| --- | --- | --- |
| 6.4 storeTransport Protocol unify | Transport | In progress |
| 6.5 control/log dedup | Transport | Not started |
| 6.6 terminalTransport v1 | Transport | Not started |
| 6.7 ProcessArchive rename + domain folders | Hub (follow-up) | Deferred |

**Do not touch:** `storeTransport`, `ControlTransportHttp` log routes, `logTransport`, `controlTransport`, `terminalTransport`.

---

## Integration merge (after transport done)

Use worktree `effect-pm` on `rewrite/store-transport` — see [`../effect-pm/AGENT-PROMPT.md`](../effect-pm/AGENT-PROMPT.md).

```sh
git merge origin/cursor/hub-runresource-vertical
git merge origin/cursor/transport-protocol-unify
```

Resolve: `package.json`, `tsup.config.ts`, `src/index.ts`, `ProcessStorage.ts`.

---

## Verification

```sh
git branch --show-current   # cursor/hub-runresource-vertical
pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build
```

---

## Read first (reference)

1. [`docs/handoffs/architecture-hub-runresource-handoff.md`](./docs/handoffs/architecture-hub-runresource-handoff.md)
2. [`docs/recipes/architecture-split-and-transports.md`](./docs/recipes/architecture-split-and-transports.md)
3. [`docs/handoffs/WORKTREE-SETUP.md`](./docs/handoffs/WORKTREE-SETUP.md)
