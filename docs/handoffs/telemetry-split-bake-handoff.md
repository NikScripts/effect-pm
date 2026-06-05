# Handoff: Telemetry split bake session

**Type:** owner bake (not implementation)  
**Recipe:** [telemetry-split-bake.md](../recipes/telemetry-split-bake.md)  
**Vocabulary:** [21-state-vocabulary.md](../plans/21-state-vocabulary.md)  
**Skill:** `.cursor/skills/bake-me/SKILL.md` — one recipe step at a time; lock ingredients in the recipe file.

---

## Owner — start a bake session

Paste into a new chat (hub worktree or any):

```text
Bake the telemetry split using docs/recipes/telemetry-split-bake.md.

Rules:
- One open step at a time (steps 1–7 in order).
- Each step: recommended ingredients, code picture, alternatives, acceptance check.
- Wait for my confirmation before locking and moving on.
- Record locked outcomes under "Locked ingredients" in the recipe file.
- Do not implement code unless I explicitly ask after all steps are locked.

Context you must not get wrong:
- Process state = State.Scope (kernel only).
- Telemetry state = in-memory, telemetry path only, never RuntimeStorage.
- Durable ProcessStore.state = ops storage (plan 13), NOT telemetry state.
- Telemetry tree = plan 17 DSL on Telemetry.Service, NOT TelemetryHub.defineEvent.
- Golden tree: git show origin/cursor/facet-telemetry-158c:src/store/runResource.ts
- Hub branch debt: RunResourceTelemetry.ts defineEvent + RunResource.ts kernel Ref counters.
```

**Success criteria:** all seven checklist items at the bottom of the recipe are checked; plan 21 updated if vocabulary changed; owner sign-off on the four-way state table.

---

## Prompt for bake agent (same session)

```text
Run the telemetry split bake from docs/recipes/telemetry-split-bake.md.

Do not implement code in this session unless the owner explicitly asks after all
steps are locked.

For each open recipe step (1–7):
- present recommended ingredients + code picture + alternatives
- wait for owner confirmation
- record locked outcome in the recipe file under "Locked ingredients"

When bake completes:
- update docs/plans/21-state-vocabulary.md with any owner revisions
- mark checklist at bottom of telemetry-split-bake.md
```

---

## Context the bake must not get wrong

1. **Process state** = `State.Scope` — kernel uses it.
2. **Telemetry state** = in-memory, telemetry path only, never `RuntimeStorage`, not projection.
3. **Durable ops state** = plan 13 / `ProcessStore.state` — not telemetry state.
4. **Telemetry tree** = plan 17 DSL on **`Telemetry.Service`** — not `defineEvent` on hub.
5. **TelemetryHub** = router + optional sinks — siloed layers.
6. **Golden tree reference:** `git show origin/cursor/facet-telemetry-158c:src/store/runResource.ts`
7. **Hub branch debt:** `src/store/RunResourceTelemetry.ts` interim API — replace, don't extend.
8. **Layout:** role folders only (`store/`, `sink/`, `transport/`); flat PascalCase files.

---

## Open steps summary (bake in order)

| Step | Decides |
| --- | --- |
| 1 | `Telemetry.Service` factory shape + subpath |
| 2 | `Telemetry.registry` — global vs per-compose |
| 3 | Telemetry state API — tag, lifetime, who updates |
| 4 | Hub emit bridge — tree statics → `TelemetryHub.emit` without spine in `R` |
| 5 | RunResource kernel boundary — semaphore vs counters |
| 6 | Layer matrix — siloed vs combined naming |
| 7 | Delete list + migration order |

Full detail, code pictures, and alternatives: [telemetry-split-bake.md](../recipes/telemetry-split-bake.md).

---

## After bake — implementation order

1. `Telemetry.Service` factory + restore RunResource tree from golden branch  
2. Hub emit bridge + `Telemetry.registry` v1  
3. Telemetry state v1 + RunResource kernel cleanup  
4. Queue migration (`cursor/queue-telemetry-hub-migration`, separate worktree)

**Verification (every slice):** `pnpm run typecheck && pnpm test && pnpm run lint && pnpm run build`  
**Changeset:** required before merge to `rewrite/store-transport`.

---

## Docs aligned for this bake (Jun 2026)

| Doc | Role |
| --- | --- |
| [21-state-vocabulary.md](../plans/21-state-vocabulary.md) | Canonical four-way table |
| [20-process-store-split-and-telemetry.md](../plans/20-process-store-split-and-telemetry.md) | Split ADR + debt notes |
| [18-resource-state-scope.md](../plans/18-resource-state-scope.md) | Process state / scopes |
| [17-facet-telemetry-factory.md](../plans/17-facet-telemetry-factory.md) | Tree DSL §5 |
| [architecture-split-and-transports.md](../recipes/architecture-split-and-transports.md) | Locked architecture |
| [architecture-hub-runresource-handoff.md](./architecture-hub-runresource-handoff.md) | Post-bake hub agent |
| [WORKTREE-SETUP.md](./WORKTREE-SETUP.md) | Parallel agents |
| [STORAGE.md](../STORAGE.md), [AGENTS.md](../AGENTS.md), [AGENT-PROMPT.md](../../AGENT-PROMPT.md) | Entry points |
