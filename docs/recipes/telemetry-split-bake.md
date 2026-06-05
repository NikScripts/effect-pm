# Recipe: Telemetry split — bake session handoff

**Goal:** Lock the full telemetry / archive / projection / state model before more
implementation. Fix vocabulary drift and replace hub-branch interim APIs (`defineEvent`,
`RunResourceHubTelemetry`) with the agreed design.

**Non-goals:** Implement slices in this session; transport work; dashboard UI.

**Owner prompt to start bake:** paste [telemetry-split-bake-prompt.md](../handoffs/telemetry-split-bake-prompt.md).

**Canonical vocabulary:** [21-state-vocabulary.md](../plans/21-state-vocabulary.md).

**Architecture (locked Jun 2026):** [architecture-split-and-transports.md](./architecture-split-and-transports.md).

**Golden telemetry tree (reference branch):** `origin/cursor/facet-telemetry-158c` —
`ProcessStore.telemetry` DSL in `runResource.ts` (restore as `Telemetry.Service`, not
on `*Store`).

**Current hub branch debt:** `src/store/RunResourceTelemetry.ts` uses `TelemetryHub.defineEvent`;
`RunResource.ts` owns telemetry counters in `Ref`; no `Telemetry.Service`, no registry,
no telemetry state module.

---

## Mise en place (repo facts)

| Area | Shipped | Wrong / missing |
| --- | --- | --- |
| `TelemetryHub` + sinks | Yes | Hub used as event definition surface |
| `ArchiveSink`, `ProjectionSink`, `BroadcastSink` | Yes | Legs wired to `defineEvent`, not tree |
| `RunResourceStore` decoupled from telemetry section | Yes | Hand-rolled codecs/wires |
| `RunResourceProjection` | Yes | — |
| `State.Scope` + scopes | Partial | RunResource kernel ignores `RunScope` |
| **`Telemetry.Service`** | **No** | Plan 20 target |
| **`Telemetry.registry`** | **No** | Recipe step 2 |
| **Telemetry state** (in-memory, telemetry-only) | **No** | Owner model — [plan 21](../plans/21-state-vocabulary.md) |
| Plan 17 tree DSL on RunResource | **No** on hub | On `facet-telemetry-158c` |
| Transport 6.4–6.6 | Merged to hub | — |
| Domain folders under `store/` | Removed | Flat PascalCase — [src-reorganization](../plans/src-reorganization.md) |

---

## Locked ingredients (do not re-litigate without owner)

1. **Isolation / siloing** — opt-in subpaths, layers, registries; combined layers explicitly named.
2. **Three modules per domain** — `Telemetry.Service`, `*Store` (archive), `*Projection` (optional); separate tags.
3. **Emit `R = TelemetryHub`** at kernel sites — never `RuntimeStorage` on emit path.
4. **Telemetry tree DSL** — plan 17 §5 (`Telemetry.namespace` / `tag` / `event` / `logWarning`); **not** `defineEvent`.
5. **Hub = router only** — validate + fan-out; definitions live on `Telemetry.Service`.
6. **Archive optional** — `ArchiveSink` leg; store facet queries only.
7. **Two in-memory state kinds** — process state (`State.Scope`) vs telemetry state (telemetry path only); see plan 21.
8. **Telemetry state never touches storage** — not projection, not durable ops.
9. **Role folders only** — `store/`, `sink/`, `transport/`; PascalCase files; no domain subfolders; no import shims.
10. **Reference implementation order** — restore RunResource telemetry from `facet-telemetry-158c` → hub bridge → Queue.

---

## Open recipe steps (bake in order)

### Step 1 — `Telemetry.Service` factory shape

**Decides:** Public class API, relationship to plan 17 DSL, exports, subpath.

**Recommended ingredients:**

```ts
// Authoring (unchanged DSL — moved off ProcessStore)
class RunResourceTelemetry extends Telemetry.Service<RunResourceTelemetry>()(
  RunResourceScope,
  Telemetry.namespace("RunResource"),
  Telemetry.tag("Run")(
    Telemetry.event("Started", RunResourceRunStarted).pipe(
      Telemetry.logWarning("...", ({ runId }) => ({ runId: String(runId) })),
    ),
    // ...
  ),
) {}

// Kernel
yield* RunResourceTelemetry.Run.Started(input) // R = TelemetryHub
```

- `Telemetry.Service` mirrors `ProcessStore.Service` curried class pattern.
- Tree builder moves from `ProcessStore.telemetry` to `Telemetry.Service` (or thin alias during migration).
- Static emit paths attached to **telemetry class**, not `*Store`.

**Alternatives:** const + `attachEmitStatics` (less symmetry); keep `ProcessStore.telemetry` name (rejected in plan 20).

**Acceptance:** Owner confirms class name, subpath (`store/RunResource` re-export vs dedicated), and that DSL is unchanged from golden branch.

---

### Step 2 — `Telemetry.registry`

**Decides:** Wire registration, sink subscription, relationship to hub init.

**Recommended ingredients:**

```ts
Telemetry.registry([RunResourceTelemetry, QueueResourceTelemetry])
// → hub knows wire ids + schemas for sink matching
// ArchiveSink / ProjectionSink derive legs from registry + codec — no hand wires
```

- Registration at module init or explicit registry layer (bake choice).
- Sinks opt in by wire id (recipe step 2 locked).
- Archive registry stays separate (`ProcessStore.registry` → archive facets only).

**Acceptance:** Document minimal v1 API; owner signs off on one global registry vs per-compose registration.

---

### Step 3 — Telemetry state API

**Decides:** Service tag, lifetime, who updates, interaction with emit legs.

**Recommended ingredients:**

```ts
// In-memory only; provided by RunResourceTelemetry.layer (or TelemetryState.layer scoped to domain)
interface RunResourceTelemetryState {
  readonly incrementEmit: (wire: string) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<Readonly<Record<string, number>>>
}

// Updated only inside emit pipeline / metrics leg — kernel cannot yield* TelemetryState
```

- Lifetime: same as worker / gate instance (or telemetry compose scope).
- `prepare` / `metrics` pipe legs (plan 17 phase 2) read/write telemetry state before hub emit.
- Never serialized to `RuntimeStorage`.

**Alternatives:** Ref inside hub (rejected — not siloed per domain); reuse projection (rejected).

**Acceptance:** Owner confirms fields, lifetime, and that process code never imports telemetry state.

---

### Step 4 — Hub emit bridge (internal)

**Decides:** How tree statics reach `TelemetryHub.emit` without spine in emit `R`.

**Recommended flow:**

```text
RunResourceTelemetry.Run.Started(input)
  → materialize from Telemetry.Schema + process scope
  → read/update telemetry state (optional leg)
  → TelemetryHub.emit({ wire, schema, payload })
  → sinks (archive / projection / broadcast / logs)
```

- Persist sink uses `ArchiveSink` + spine — **not** inline in emit `R`.
- `Telemetry.logWarning` applies to archive persist failures on sink path.

**Acceptance:** Sequence diagram signed off; test plan: emit with hub only; emit + archive sink; no store in emit R.

---

### Step 5 — RunResource kernel boundary

**Decides:** What stays in process vs telemetry for gate counters.

**Recommended:**

- Process: `Semaphore`, `RunScope.run` with `runId`, user effect.
- Telemetry: counters (`waiting`, `inFlight`, …) move to **telemetry state** or emit-side reducer; `State.Changed` still emitted via tree.
- Delete kernel-owned `stateRef` once telemetry state exists.

**Acceptance:** Owner confirms which RunResource counters are telemetry-only vs required for gating (gating uses semaphore only).

---

### Step 6 — Layer matrix (siloed vs combined)

**Decides:** Default exports for apps; naming.

| Layer | Requires | Provides |
| --- | --- | --- |
| `TelemetryHub.layer` | — | emit |
| `RunResourceTelemetry.layer` | hub | tree statics + telemetry state |
| `RunResourceStore.layerRuntimeStorage` | `RuntimeStorage` | queries |
| `ArchiveSink.layerForStore(...)` | storage + hub | persist leg |
| `RunResourceProjection.layerLive` | hub | live read |
| `RunResourceCompose.layerPersist` | **explicit merge** | convenience |

**Acceptance:** Table approved; no monolithic layer pulls all facets + transports without explicit name.

---

### Step 7 — Migration & delete list

**Decides:** What dies on hub branch when bake closes.

**Delete / replace:**

- `TelemetryHub.defineEvent` usage in facet modules
- `RunResourceHubTelemetry` namespace
- Hand-duplicated wire const arrays in `RunResourceStore` / `RunResourceTelemetry`
- Kernel `Ref` counters (after telemetry state)
- Docs referencing `store/runResource/` folders, transport-only parallel agent as primary path

**Keep:**

- `TelemetryHub`, sink modules, projection pilot, transport merge, flat `store/RunResource*.ts`

**Acceptance:** Owner approves delete list; changeset note for breaking emit surface.

---

## Rejected substitutions (record during bake)

| Proposal | Reason |
| --- | --- |
| `defineEvent` as SSoT | Bypasses plan 17 DSL; caused hub drift |
| Durable `ProcessStore.state` as “telemetry state” | Wrong vocabulary — ops storage |
| Domain folders under `store/` | Owner: role folders only |
| Telemetry counters in kernel `Ref` | Violates telemetry-only boundary |

---

## After bake — implementation handoff

1. Update [21-state-vocabulary.md](../plans/21-state-vocabulary.md) with locked step outcomes.
2. Slice A: `Telemetry.Service` + restore RunResource tree from `facet-telemetry-158c`.
3. Slice B: hub bridge + registry v1.
4. Slice C: telemetry state v1 + RunResource kernel cleanup.
5. Slice D: Queue migration on separate branch/worktree.

**Verification (every slice):** `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`.

**Changeset:** required before merge to integration branch (owner approval).

---

## Bake session checklist

- [ ] Step 1 — `Telemetry.Service` shape locked
- [ ] Step 2 — registry API locked
- [ ] Step 3 — telemetry state API locked
- [ ] Step 4 — hub bridge flow locked
- [ ] Step 5 — RunResource kernel boundary locked
- [ ] Step 6 — layer matrix locked
- [ ] Step 7 — delete list approved
- [ ] Plan 21 updated with bake outcomes
- [ ] Owner sign-off on vocabulary table (four state words)
