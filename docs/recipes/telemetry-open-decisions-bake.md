# Telemetry open decisions — bake

**Branch:** `cursor/telemetry-redesign-bake-faed`  
**Goal:** Lock remaining owner decisions while implementation agent ships agreed API (Steps 0–8).  
**SSoT after bake:** append locked items to [telemetry-requirements.md](./telemetry-requirements.md) change log.

**Non-goals:** Re-open locked API shape; implement factory code; resolve deferred CHKs 05–09, 13.

---

## Mise en place

| Fact | Source |
| --- | --- |
| `RunResourceStateSchema` lives in debt `store/RunResourceTelemetry.ts` | Used by Store, Projection, kernel, barrel — **not telemetry-only** |
| `STATE_CHANGE_REASONS` / wire reason literals | Same debt file; Store decode validates against them |
| Event input schemas (`RunResourceRunStartedInputSchema`, …) | Debt file today → move to Tag/schemas in Step 2 |
| Hidden telemetry fields (`gateConcurrency`, `pending*`, `stateChangeSeq`) | **Docs only** — names in requirements examples, not in code yet |
| Log legs | Old `internal/store/telemetry.ts` has `logWarning` + identity `annotateLogs` stub |
| Wiring examples | Requirements use bare **`Wiring.sections`**; handoff lists namespace as open |
| Implementer order | Step 0–3 can proceed without D5 if schema extracted early; **Step 8 delete blocked until D5 locked** |

---

## Locked ingredients

- **`RunResourceIdentity`** — exports **`TypeTag`** + **`TypeId` only**; no separate `Kind` / `"RunResource"` literal at author sites.
- **Import alias** — `import { TypeTag as RunResourceTag } from "…/RunResourceIdentity"` (or `RunResourceTypeTag` if avoiding collision with telemetry `RunResourceTag` class).
- **Root scope** — `State.Scope(RunResourceTag, fields)(RunResourceTag)`; wire namespace derived from `TypeTag` inside factories, not a second exported string.
- **`concurrency` on `RunResourceScope`** — process scope field, not telemetry extend (discussion; not implemented).
- **`Telemetry.extend` two-arg** — returns `{ scope, schema, … }`; snapshot derived from scope + extend + implicit `observedAt` (discussion; not implemented).

---

## Open recipe steps

1. **D5 — `RunResourceStateSchema` home**
2. **Wiring namespace export**
3. **Log legs v1 surface**
4. **`Telemetry.state.from` typing model**

---

## Rejected substitutions

- Derive snapshot schema from `Telemetry.extend` at runtime only (no standalone schema for Store/Projection)
- Keep schema in debt file through Step 8
- String-key `Telemetry.state.from("gateConcurrency")`
