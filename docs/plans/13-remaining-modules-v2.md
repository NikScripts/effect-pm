# 13 — Remaining Modules: modernization roadmap

**Status:** Plan

---

## Module inventory

| Module | Lines | Urgency | Blocked? |
|--------|------:|---------|----------|
| `HttpClientRunGate.ts` | 46 | ✅ Done | No — already clean |
| `Polling.ts` | 245 | Low | No |
| `ProcessSchedule.ts` | 224 | Medium | No (plan 10 adds features) |
| `Process.ts` | 951 | High | ProcessStore hard-requirement |
| `ProcessGroup.ts` | 916 | High | ProcessStore hard-requirement |
| `ControlService.ts` | 548 | Medium | Depends on ProcessGroup interface |

---

## 1. HttpClientRunGate (NO WORK NEEDED)

Already clean: 46 lines, no `Date.now()`, no old patterns, full TSDoc, pipe-friendly.
Only actionable item: already exported and documented in `RESOURCE-API.md`.

---

## 2. Polling.ts (small, incremental)

### Current state

- Already uses class pattern: `class PollingTag extends Context.Service<...>()(...) {}`
- Clean internal architecture (wakeable sleep via Deferred)
- Uses `Effect.gen` appropriately for branching
- Uses `Effect.sleep` / `Duration` correctly

### Changes needed

| Issue | Fix |
|-------|-----|
| Internal `Date.now()` usage (if any) | Replace with `Clock.currentTimeMillis` |
| `strictBooleanExpressions` | Explicit `!== undefined` checks |
| Pipeline opportunities | Some simple allocations could be `pipe(map)` |
| TSDoc coverage | Add `@example` blocks on presets |

### New features from plan 09

- The current presets (`spaced`, `accelerating`, `acceleratingScoped`) are shipped and stable
- No structural changes planned — just polish

### Effort: Small (cleanup pass, no rewrite)

---

## 3. ProcessSchedule.ts (medium, plan 10 features)

### Current state

- Already uses class pattern: `class ProcessScheduleTag extends Context.Service<...>()(...) {}`
- In-memory schedule store (Ref + Deferred change signal)
- Entries are `{ id, startAt: Date, stopAt: Option<Date> }`

### Changes from plan 10

Plan 10 expands the `ProcessScheduleService` interface with:

```typescript
// New methods (plan 10):
get(id: string): Effect<Option<ProcessScheduleEntry>>
has(id: string): Effect<boolean>
upsert(entry: ProcessScheduleEntry): Effect<void>
remove(id: string): Effect<void>
removeMany(ids: ReadonlyArray<string>): Effect<void>
reconcile(entries: ReadonlyArray<ProcessScheduleEntry>): Effect<{ added; removed; updated }>
```

### Changes needed

| Issue | Fix |
|-------|-----|
| `Date` in entry type | Consider epoch millis or Effect DateTime (future) |
| `strictBooleanExpressions` | Explicit checks |
| Plan 10 features | Add `get`/`has`/`upsert`/`remove`/`reconcile` |
| TSDoc | Document each method with examples |

### Effort: Medium (new features + polish)

---

## 4. Process.ts (large, core module)

### Current state

- 951 lines, complex supervisor architecture
- **ProcessStore is a HARD requirement** (`R | ProcessStore` on every process effect)
- Uses `Clock` correctly for timing
- Uses `MutableRef` for running instance tracking
- Trigger driver → spawn instances → inner poll loop → tracked execution

### Changes needed

| Issue | Priority | Fix |
|-------|----------|-----|
| **ProcessStore hard requirement** | High | `Effect.serviceOption(ProcessStore)` — analytics optional |
| `strictBooleanExpressions` | Medium | Explicit checks |
| Pipeline composition | Low | Where linear flows exist |
| `Effect.fn` for key operations | Medium | `spawnInstance`, `trackedProgram`, `reconcileSchedules` |
| TSDoc | Medium | Document supervisor loop, instance lifecycle |
| `new Date()` usage | Medium | Replace with Clock → DateTime (if ProcessStore updates) |

### Effect v4 opportunities

| Feature | Benefit |
|---------|---------|
| `FiberSet` / `FiberMap` | Replace manual `Map<string, Fiber>` for running instances |
| `SubscriptionRef` | Replace `Ref + Deferred` pattern for schedule change signaling |
| `Effect.fn("Process.spawnInstance")` | Named traces for debugging |
| `Effect.annotateLogs` | `process.name`, `process.entry`, `process.instance` |

### Architectural decisions

1. **ProcessStore optional** — `Effect.serviceOption(ProcessStore)`. When absent:
   - Execution tracking becomes no-op
   - `getStatus` returns partial data (no historical executions)
   - Lifecycle events not recorded

2. **FiberMap for instances** — each entry key maps to a running fiber. `FiberMap` handles cleanup on scope close.

3. **SubscriptionRef for schedule** — schedule changes propagate reactively (no polling for changes).

### Effort: Large (careful refactor, preserve semantics)

---

## 5. ProcessGroup.ts (large, orchestration)

### Current state

- 916 lines, owns process lifecycle + queue access + control API
- **ProcessStore is a HARD requirement** (`ProcessGroupDependencies = ProcessStore`)
- Manages: process map, status map, start times, scopes, fibers
- Exposes `serve()` (ControlService) and `awaitShutdown()`

### Changes needed

| Issue | Priority | Fix |
|-------|----------|-----|
| **ProcessStore hard requirement** | High | `Effect.serviceOption` (same as Process) |
| Queue interface references | Done | Already migrated to `QueueHandle` effectful props |
| `strictBooleanExpressions` | Medium | Throughout |
| Pipeline composition | Low | Linear control flows |
| `Effect.fn` | Medium | `startProcess`, `stopProcess`, `restartProcess` |
| TSDoc | Medium | Document each control method |

### Effect v4 opportunities

| Feature | Benefit |
|---------|---------|
| `FiberMap` | Replace `Ref<Map<string, Fiber>>` for process fibers |
| `Effect.fn` | Named spans on `startProcess`, `stopProcess`, `restartProcess` |
| `Effect.annotateLogs` | `group.process` annotation on all process operations |

### Effort: Large (careful refactor, preserve semantics)

---

## 6. ControlService.ts (medium, modernization)

### Current state

- 548 lines, uses raw `node:http` (violates `nodeBuiltinImport`)
- JSON request/response without Schema validation (manual parsing)
- Binds to 127.0.0.1 only

### Target architecture

Migrate to **Effect's HttpServer** from `@effect/platform-node`:

| Current | Target |
|---------|--------|
| `node:http` | `@effect/platform-node` HttpServer |
| Manual JSON parsing | Schema-validated request/response |
| Custom route matching | Effect HttpRouter |
| No middleware | Built-in error handling, logging, CORS |
| No streaming | SSE for `watch`, `logs --follow` (future) |

### New commands (from earlier discussion)

- `clear <name>` — drain queue (already wired)
- `history <name>` — ProcessStore query
- `errors <name>` — filtered failures
- `health` — structured health check
- `config <name>` — view current config

### Effort: Medium-Large (transport rewrite, same logic)

---

## 7. Recommended order

### Phase A: Quick wins (no blockers)

1. **Polling.ts** — cleanup pass (LSP fixes, TSDoc, pipeline)
2. **ProcessSchedule.ts** — plan 10 features + cleanup

### Phase B: ProcessStore optional (unlocks everything)

3. **Process.ts** — `serviceOption(ProcessStore)`, FiberMap, Effect.fn
4. **ProcessGroup.ts** — same treatment, FiberMap for process fibers

### Phase C: Infrastructure modernization

5. **ControlService.ts** — migrate to Effect HttpServer, Schema validation

### Phase D: Future (separate planning)

6. **ProcessManager** — multi-group coordination via Effect RPC
7. **CLI v2** — Unix socket transport, richer commands

---

## 8. Effect v4 features to leverage

| Feature | Where | Benefit |
|---------|-------|---------|
| `FiberMap` | Process (instance tracking), ProcessGroup (process fibers) | Auto-cleanup, keyed fiber management |
| `SubscriptionRef` | ProcessSchedule (reactive changes) | No polling for schedule mutations |
| `Effect.fn` | Process supervisor, ProcessGroup controls | Named traces |
| `Effect.annotateLogs` | Everywhere | Structured log context |
| `Latch` | Already used in QueueResource | Could also gate Process pause |
| `DateTime` | ProcessSchedule entries (replace Date) | Effect-native time values |
| Effect HttpServer | ControlService | Type-safe routes, middleware, SSE |
| Effect Schema | ControlService requests/responses | Validation, OpenAPI |
| Effect RPC | ProcessManager ↔ ProcessGroup | Type-safe cross-process communication |
