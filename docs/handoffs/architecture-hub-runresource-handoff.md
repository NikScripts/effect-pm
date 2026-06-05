# Architecture hub + RunResource vertical slice — main agent handoff

## Branch

**Implement on:** `cursor/hub-runresource-vertical`  
**Worktree:** `/Users/nikolasstow/Coding/packages/effect-pm-alt` (tmux: `effect-pm-alt`)

**Merge into (later):** `rewrite/store-transport` after bake + pilot restore — not an implementation branch for new telemetry APIs.

---

## Stop — bake before more telemetry code

Do **not** extend `TelemetryHub.defineEvent`, `RunResourceHubTelemetry`, or kernel-owned
telemetry counters. Run the owner bake first:

| Doc | Role |
| --- | --- |
| [telemetry-split-bake-handoff.md](./telemetry-split-bake-handoff.md) | Agent prompt + context |
| [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) | Recipe steps 1–7 |
| [21-state-vocabulary.md](../plans/21-state-vocabulary.md) | Four-way state table |

**Golden tree DSL (port target):** `git show origin/cursor/facet-telemetry-158c:src/store/runResource.ts`  
Restore as **`Telemetry.Service`**, not on `*Store`, not via `defineEvent`.

---

## Read first (authoritative)

| Doc | Why |
| --- | --- |
| [telemetry-split-bake.md](../recipes/telemetry-split-bake.md) | Lock model before implementation |
| [21-state-vocabulary.md](../plans/21-state-vocabulary.md) | Process vs telemetry vs projection vs durable ops |
| [architecture-split-and-transports.md](../recipes/architecture-split-and-transports.md) | Locked architecture — steps 1–6 |
| [20-process-store-split-and-telemetry.md](../plans/20-process-store-split-and-telemetry.md) | Split rationale + migration phases |
| [19-transport-boundaries.md](../plans/19-transport-boundaries.md) | Transport ownership |
| [17-facet-telemetry-factory.md](../plans/17-facet-telemetry-factory.md) | Tree DSL (§5) — target lives on `Telemetry.Service` |
| [src-reorganization.md](../plans/src-reorganization.md) | Flat PascalCase under role folders |
| [AGENTS.md](../AGENTS.md) | Verification, Effect platform policy |
| [STORAGE.md](../STORAGE.md) | Archive facet rules |

---

## Shipped on this branch (keep)

| Area | Where |
| --- | --- |
| `TelemetryHub` + sink layers | `src/TelemetryHub.ts`, `src/sink/*` |
| Transport slices 6.4–6.6 | Merged from transport-unify |
| `RunResourceStore` — queries only | `src/store/RunResourceStore.ts` |
| Flat layout | `src/store/RunResource.ts`, `RunResourceStore.ts`, `RunResourceTelemetry.ts` |
| `RunResourceProjection` + hydrate | `src/RunResourceProjection.ts` |
| `telemetryTransport` v1 + `BroadcastSink` | transport modules + tests |
| `ArchiveSink`, `ProjectionSink` | `src/sink/*` |
| Schema-typed archive queries (pilot) | `RunResourceStore` |
| Store transport (Protocol, streaming, Ack) | `src/internal/store/storeTransport.ts`, `StoreTransportRpc.ts` |
| `State.Scope` + scopes | `src/State.ts`, `*Scope.ts` |

**Tests:** run full suite before each slice — `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`.

**Stale doc:** [store-transport-rpc-handoff.md](./store-transport-rpc-handoff.md) — store transport landed; ignore “what remains”.

**Historical layout note:** older handoffs mention `src/store/runResource/` — **removed**; flat files only.

---

## Vertical slice status

| Slice | Status | Notes |
| --- | --- | --- |
| **6.1** TelemetryHub core | **Done** | Router + wire-id sinks |
| **6.2** RunResource split + ArchiveSink | **Partial** | Store decoupled; **interim** `defineEvent` telemetry — replace after bake |
| **6.3** Projection + telemetryTransport | **Done** | Live push without store poll |
| **6.4–6.6** Transport unify | **Done** | Merged into hub branch |
| **Post-bake A** `Telemetry.Service` + tree restore | **Not started** | From `facet-telemetry-158c` |
| **Post-bake B** Hub bridge + `Telemetry.registry` | **Not started** | |
| **Post-bake C** Telemetry state + kernel cleanup | **Not started** | Remove `RunResource.ts` `stateRef` |
| **6.7** Queue migration | **Deferred** | Separate branch after RunResource pilot |

---

## Implementation debt (replace after bake)

| Item | Wrong today | Target |
| --- | --- | --- |
| `RunResourceTelemetry.ts` | `TelemetryHub.defineEvent`, flat wires | `Telemetry.Service` + plan 17 tree |
| `RunResource.ts` | Kernel `Ref` for counters | Telemetry state or emit legs only |
| Wire arrays | Hand-duplicated in store + telemetry | `Telemetry.registry` + codec derivation |
| Emit `R` at kernel | May still imply storage paths | `TelemetryHub` only |

---

## Design rules (locked)

- **Emit `R = TelemetryHub` only** at kernel sites.
- **Telemetry tree SSoT** — plan 17 DSL on **`Telemetry.Service`**; hub routes only.
- **Two in-memory state kinds** — process (`State.Scope`) vs telemetry (never storage).
- **Siloing** — opt-in layers/subpaths; combined layers explicitly named.
- **Role folders only** — `store/`, `sink/`, `transport/`; PascalCase files; no domain subfolders.
- **Functional style** — hub dispatch via `Effect` combinators.
- **No DB polling** for live UI — hydrate once, then hub-live.

---

## Out of scope (defer)

- QueueResource migration until RunResource pilot restored on tree + registry.
- Plan 17 wire-string break across all facets (after bake).
- `ProcessStorage` → `ProcessArchive` rename (slice 6.7).
- Dashboard React components.

---

## Verification (every commit slice)

```sh
pnpm run typecheck
pnpm test
pnpm run lint
pnpm run build
```

**Changeset** when public subpaths or exports change (owner approval).

---

## Suggested commits (post-bake)

1. `feat(telemetry): Telemetry.Service factory + RunResource tree from golden branch`
2. `feat(telemetry): hub emit bridge + Telemetry.registry v1`
3. `refactor(runResource): telemetry state + kernel boundary cleanup`
4. `chore: remove defineEvent / RunResourceHubTelemetry`

Push topic branch; open PR against `rewrite/store-transport` when post-bake acceptance passes.
