# Hub agent — slice 6.3 (projection + telemetryTransport)

**Worktree:** `effect-pm-alt`  
**Branch:** `cursor/hub-runresource-vertical`  
**Tip:** `45a1e70` — TelemetryHub + RunResource split + ArchiveSink landed  
**Parallel agent:** transport work on `effect-pm-alt-transport` → see [`../effect-pm-alt-transport/AGENT-PROMPT.md`](../effect-pm-alt-transport/AGENT-PROMPT.md)

---

## Read first

1. This prompt (you are here)
2. [`docs/handoffs/architecture-hub-runresource-handoff.md`](./docs/handoffs/architecture-hub-runresource-handoff.md) — authoritative spec (§6.3)
3. [`docs/recipes/architecture-split-and-transports.md`](./docs/recipes/architecture-split-and-transports.md) — locked architecture
4. [`docs/handoffs/WORKTREE-SETUP.md`](./docs/handoffs/WORKTREE-SETUP.md) — worktree map + merge coordination

**Do not touch:** `storeTransport` Protocol unify, `ControlTransportHttp` log route removal, `logTransport` / `controlTransport` / `terminalTransport` — parallel agent owns those on `effect-pm`.

---

## Already shipped (6.1 + 6.2)

| Deliverable | Where |
| --- | --- |
| TelemetryHub core | `src/TelemetryHub.ts`, `src/internal/telemetryHub/` |
| RunResource telemetry SSoT | `src/store/runResource/telemetry.ts` |
| RunResource archive facet | `src/store/runResource/archive.ts` |
| ArchiveSink | `src/ArchiveSink.ts` |
| Subpaths | `@nikscripts/effect-pm/TelemetryHub`, `@nikscripts/effect-pm/ArchiveSink` |
| Tests | 378 passing (`test/run-resource-archive-sink.test.ts`, hub tests, etc.) |

**Stub only:** `src/store/runResource/projection.ts` — replace in 6.3.

---

## Slice 6.3 — your work

**Goal:** Live projection + `telemetryTransport` v1 — hub updates memory and pushes on wire; **no store poll on hot path.**

### Deliverables

1. **`RunResourceProjection`** service — start with `latestState(resourceId)`
2. **`ProjectionSink`** — generic hub sink (mirror `ArchiveSink.forStore`; reducer typed from `State.Changed` schema in `src/store/runResource/telemetry.ts`)
3. **`RunResourceProjection.layerHydrateFromArchive`** — one-shot cold start from archive `latestState` / bounded history; **not** default on projection layer
4. **`telemetryTransport` v1**
   - Path `/ws/telemetry` (in-process test protocol OK until transport agent merges router unify)
   - `BroadcastSink` at app compose: hub → transport publish
   - Schema-backed stream items (event wire + payload)

### Acceptance (all three required)

1. Emit `State.Changed` → `RunResourceProjection.latestState` updates in-process
2. Telemetry transport client receives event **without** calling `storeTransport`
3. Restart simulation: projection empty → provide hydrate layer → seeded from archive → subsequent emits update without polling loop

### Design rules

- Emit sites keep `R = TelemetryHub` only
- One event def (`State.Changed`) drives wire + encoder + reducer + broadcast (SSoT)
- Functional Effect piping; **no `as any` casts**
- camelCase modules, PascalCase types
- Projection lives under `src/store/runResource/projection.ts` (or dedicated public module if subpath warranted)

---

## Suggested commit order

1. `feat(projection): ProjectionSink + RunResourceProjection + reducer test`
2. `feat(projection): layerHydrateFromArchive + restart simulation test`
3. `feat(telemetry): BroadcastSink + telemetryTransport v1 + wire test`
4. `chore(changeset): projection and telemetryTransport subpaths` (owner approval before committing changeset)

---

## Verification (every commit)

```sh
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

Target: **378+** tests green; add new tests for each acceptance criterion.

---

## Before merge with transport branch

Transport agent lands on `cursor/transport-protocol-unify` in worktree `effect-pm`.

- [ ] Rebase one branch onto the other (or merge into `rewrite/store-transport`)
- [ ] Resolve conflicts in: `package.json`, `tsup.config.ts`, `src/index.ts`, `ProcessStorage.ts`
- [ ] Combined suite green
- [ ] Reserve `/ws/telemetry` for this slice; transport uses `/ws/store`, `/ws/log`, `/ws/control`, `/ws/terminal`

---

## Cheap-model handoff (optional)

After core 6.3 implementation lands, mechanical tasks can go to a cheaper model:

- Export wiring (`package.json`, `tsup.config.ts`, `src/index.ts`) — copy `TelemetryHub` pattern
- Changeset draft text
- Handoff checkbox updates in `docs/handoffs/`

Do **not** delegate: `ProjectionSink` API, reducer typing, hydrate layer semantics, or `telemetryTransport` Protocol wiring.

---

## Stale WIP note

An older 6.3 attempt on `refactor/store-facets` was stashed in the **main worktree** (`effect-pm`) before repointing to transport. **Do not use it** — architecture diverges (root-level modules vs `src/store/runResource/` split). Stash ref: `archive: old 6.3 WIP on refactor/store-facets`.
