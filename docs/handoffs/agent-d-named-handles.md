# Named Hyperlink handles — status (Agent D track)

> **Naming:** read as WorkPool / Daemon / Gate / Hyperlink / hyperlink-ts (pre-rebrand names purged from this file).

**Status (2026-07-27):** **partial Eng on tip** — WorkPool + Gate Tag paths hover as named handles.  
**Agent:** D (merged / idle). **Do not** assign to dead Agent 3.  
**Design SSOT (historical bake, names updated):** [`queue-handle-convergence-decisions.md`](./queue-handle-convergence-decisions.md).  
**Docs bus:** [`agent-status.md`](./agent-status.md).

---

## Goal

`yield* MyTag` should hover as a **compact named type** (e.g. `WorkPool<EmailJob>`, `Gate<Ticket, Price>`), with the full member shape one expand away (prettify-ts / docs compiler walk). Spec remains SSOT; `.Tag` is canonical.

---

## Naming (post-rebrand — use these only)

| Old (gone) | Current |
|------------|---------|
| `QueueResource` (module / hover name) | **`WorkPool`** (`hyperlink-ts/WorkPool`) |
| `Process` / `ScheduledProcess` | **`Daemon`** |
| `RunResource` | **`Gate`** |
| `Resource` / `ResourceTag` | **`Hyperlink`** / **`HyperlinkTag`** |
| `@nikscripts/effect-pm` | **`hyperlink-ts`** |
| Named handle `QueueResource<…>` | Named handle **`WorkPool<Payload, Success?, Error?, Requirements?>`** |
| Named handle `RunResourceHandle` / similar | Named handle **`Gate<Input, Success?, Error?>`** |

**Do not** teach `QueueResource`, `RunResource`, or `Process.Tag` in new prose.

### Two handle stories (do not conflate)

| Name | Where | Meaning today |
|------|--------|----------------|
| **`WorkPool<…>`** | `src/WorkPool.ts` interface | **Contract** named handle — what `WorkPool.Tag` / `yield*` uses |
| **`QueueHandle`** | `src/internal/workPool.ts` | Still a **TEMP alias → `EngineQueueHandle`** (engine path). Comment marks M1b: should become the contract projection or stay internal-only. **Not** what Tag hovers as. |
| **`PriorityHandle`** | WorkPool priority | Still engine-shaped (`EEnqueue` param) — not on the `WorkPool<>` contract naming path yet |

---

## Shipped on tip

### WorkPool (queue)

- Interface **`WorkPool<Payload, Success = void, Error = never, Requirements = never>`** — contract member table (Subscribable `size`/`status`, nested `metrics`, no `EEnqueue` on enqueue).
- **`QueueTag`** = `HyperlinkTag<…, WorkPool<…>>` via `Svc` seam on `HyperlinkTag`.
- **`nameQueueService`** — one harness-guarded cast; soundness in `test/queue-handle.test-d.ts` (`WorkPool.WorkPool<Decoded<F>>` ⇄ `ServiceOf<queueSpec>`).
- **Hover:** `yield* Emails` → **`WorkPool<EmailJob>`** (not a `ServiceOf<…>` wall).

### Gate

- Interface **`Gate<Input, Success, Error>`** + `nameRunService` + `test/gate-handle.test-d.ts`.
- **Hover:** `yield* MyGate` → **`Gate<…>`**.

### Not named yet (fan-out)

| Toolkit | Tag hover today | Notes |
|---------|-----------------|--------|
| **Daemon** | Expanded `ServiceOf` / un-named Svc | `Daemon` engine interface exists; Tag path has **no** `nameDaemonService`-style seam yet |
| **Store / ApiMetrics / …** | — | Never started |
| **WorkPool.priority** | Engine `PriorityHandle` | Still `EEnqueue`-era engine shape |

---

## Follow-ups (accurate residual)

1. **M2 — unify typed `WorkPool.Service` with `WorkPool.Tag`**  
   Typed `.Service` should build through the same contract `layer` / handle as `.Tag` so both yield **`WorkPool<…>`** by construction. Engine-only / untyped `.Service` stays a separate path. Surface deltas historically included `size` Effect vs Subscribable, metrics nesting, `logs`.

2. **`WorkPool` M1b cleanup**  
   Public/internal `WorkPool` still aliases **engine** handle. Either retire the name to `EngineQueueHandle` only, or make `WorkPool` mean the contract (today that name is **`WorkPool`** — prefer not to resurrect `WorkPool` as the author-facing hover).

3. **Per-Tag success/error carriers**  
   Keep handle `Success`/`Error` tied to Tag wire / effect carriers so hovers show real failure/success types.

4. **Elide trailing defaults**  
   Money case: `WorkPool<EmailJob>` not `WorkPool<EmailJob, void, never, never>`.

5. **Prettify asymmetry (entry.item)**  
   Nested entry `item` vs `add` payload prettify — still the shallow-`PrettifyPayload` fork from the bake (deepen vs mirror).

6. **M4–M6 engine SSOT** (later)  
   Derive engine handle from spec; push Subscribable/metrics natives; optional drift cleanup.

7. **Fan-out**  
   Daemon Tag naming → then Store / ApiMetrics / priority as needed. Pattern: named interface + `Svc` on `HyperlinkTag` + `.test-d.ts` bidirectional guard + one factory cast.

---

## Hard constraints (still apply)

- No drive-by `as` casts — structural equality + `.test-d.ts` guard (the one `name*Service` cast is licensed by that guard).
- Additive / structural identity for named handles vs `ServiceOf<spec>`.
- Spec is SSOT; `.Tag` is canonical.

---

## References

- Implementation: `src/WorkPool.ts` (`WorkPool` interface, `QueueTag`, `nameQueueService`), `src/Gate.ts` (`Gate`, `nameRunService`), `src/internal/workPool.ts` (`QueueHandle` TEMP → engine).
- Tests: `test/queue-handle.test-d.ts`, `test/gate-handle.test-d.ts`.
- Bake history (names refreshed 2026-07-27): [`queue-handle-convergence-decisions.md`](./queue-handle-convergence-decisions.md).
