# Hub agent — architecture vertical (RunResource pilot + follow-up)

**Worktree:** `/Users/nikolasstow/Coding/packages/effect-pm-alt`  
**Branch:** `cursor/hub-runresource-vertical`  
**Tmux session:** `effect-pm-alt`

Verify before every commit:

```sh
pwd && git branch --show-current   # must be cursor/hub-runresource-vertical
```

---

## Shipped on this branch

| Slice | Deliverable |
| --- | --- |
| 6.1 | `TelemetryHub` — emit with `R = TelemetryHub` only |
| 6.2 | RunResource telemetry/store **split**; `ArchiveSink` persist leg |
| 6.3 | `RunResourceProjection`, `ProjectionSink`, `BroadcastSink`, `telemetryTransport` |
| 6.4–6.6 | Transport unify merged (`storeTransport`, `logTransport`, `controlTransport`, `terminalTransport`) |
| Layout | Flat PascalCase under `src/store/` — **no domain subfolders** (`RunResource.ts`, `RunResourceStore.ts`, `RunResourceTelemetry.ts`) |

---

## Telemetry vs storage (RunResource — the target pattern)

**Separated at runtime.** Not a single coupled facet anymore.

| Concern | Module | Requires in `R` |
| --- | --- | --- |
| Emit | `RunResourceTelemetry.ts` → hub via `defineEvent` / `emit` | `TelemetryHub` only |
| Persist (optional) | `ArchiveSink.layerForStore(RunResourceStore, archiveLegs)` | `RuntimeStorage` at **compose** |
| Query | `RunResourceStore` | `RuntimeStorage` + store layer |
| Live read | `RunResourceProjection` | hub sink at compose; optional hydrate from archive |

Worker (`src/RunResource.ts`) calls `RunResourceHubTelemetry.Run.started` / `State.changed` — **never** `RunResourceStore` for writes.

**Other facets (Queue, Log, ProcessExecution, …) are still legacy:** telemetry tree passed into `ProcessStore.Service(..., TelemetrySection, query)` and emits go through the store spine.

---

## Hub-owned paths (do not overlap)

- `src/TelemetryHub.ts`, `src/sink/*`
- `src/store/RunResource*.ts`, `src/RunResourceProjection.ts`
- `src/telemetryTransport.ts`
- Hub follow-up: `ProcessStorage` → `ProcessArchive` rename, inner split of `RunResourceStore.ts`

---

## Parallel agent (Queue migration)

**Other worktree:** `effect-pm-alt-transport` on `cursor/queue-telemetry-hub-migration`  
See [`../effect-pm-alt-transport/AGENT-PROMPT.md`](../effect-pm-alt-transport/AGENT-PROMPT.md)

Do **not** edit `queueResource.ts` on this branch while queue agent is active (or coordinate merge order).

---

## Integration (merge only)

**Worktree:** `effect-pm` on `rewrite/store-transport` — no feature work.  
Hub is ahead; merge when owner approves. **Changeset required** before release merge.

---

## Read first

1. [`docs/handoffs/WORKTREE-SETUP.md`](./docs/handoffs/WORKTREE-SETUP.md)
2. [`docs/plans/src-reorganization.md`](./docs/plans/src-reorganization.md)
3. [`docs/recipes/architecture-split-and-transports.md`](./docs/recipes/architecture-split-and-transports.md)
4. [`docs/plans/20-process-store-split-and-telemetry.md`](./docs/plans/20-process-store-split-and-telemetry.md)

---

## Verification

```sh
pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build
```
