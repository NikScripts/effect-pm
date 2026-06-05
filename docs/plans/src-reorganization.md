# src/ reorganization plan

## Guiding rules

1. **Root = newcomer-facing.** If someone just starting out would reach for it directly, it lives at `src/`. If not, it belongs in a role folder.
2. **Role folders only.** Folders are suffixes like `store/`, `transport/`, `sink/`, `state/`, `storage/`. **No domain subfolders** (no `store/runResource/`, no `store/QueueResource/`).
3. **PascalCase public files** inside role folders; filename matches the primary export.
4. **Split big files** into sibling PascalCase modules in the same role folder — not nested directories.
5. **No legacy.** When a symbol moves, update every import. No shims.

**Subpath contract:** `@nikscripts/effect-pm/store/RunResource` → entry `src/store/RunResource.ts`; supporting modules `RunResourceStore.ts`, `RunResourceTelemetry.ts`, etc.

---

## Root `src/` — stays

Newcomer-facing modules, exported as top-level subpaths.

```
Process.ts
ProcessGroup.ts
ProcessManager.ts
ProcessSchedule.ts
Resource.ts
ResourceConfigure.ts
RunResource.ts
QueueResource.ts
HttpApiResource.ts
Logs.ts
Transport.ts
Terminal.ts
Polling.ts
Query.ts
CommandAuth.ts
TelemetryHub.ts
State.ts
LogEntry.ts
LogContext.ts
RunResourceProjection.ts

— public transport facades (newcomer entry points) —
storeTransport.ts
logTransport.ts
controlTransport.ts
telemetryTransport.ts
```

---

## `src/state/` — new

All `State.Scope` instantiations.

```
ProcessScope.ts
ProcessGroupScope.ts
ProcessLifecycleScope.ts
RunResourceScope.ts
QueueResourceScope.ts
LogScope.ts
```

---

## `src/transport/` — new

RPC contract definitions. Public facades at root delegate to these.

```
LogTransportRpc.ts
ControlTransportRpc.ts
ControlTransportHttp.ts
ControlProtocol.ts
TerminalRpc.ts
StoreTransportRpc.ts
StoreMessage.ts
```

---

## `src/store/` — expand existing

PascalCase facet modules flat under `store/` (no domain folders).

```
ProcessStore.ts             ← move from root
ProcessStoreEvent.ts        ← move from root
RuntimeEmitContext.ts       ← move from root

— RunResource (done) —
RunResource.ts              ← subpath entry + compose namespace
RunResourceStore.ts         ← archive facet class + queries
RunResourceTelemetry.ts     ← hub telemetry SSoT

— migrate (camelCase → PascalCase siblings) —
queueResource.ts            → QueueResource.ts + QueueResourceStore.ts + …
log.ts                      → Log.ts + LogStore.ts (or split)
processExecution.ts
processGroup.ts
processLifecycle.ts
queueResourceTelemetry.ts   → fold into QueueResourceTelemetry.ts
```

---

## `src/sink/` — canonical

Move root duplicates into `sink/` and delete root copies (update all imports in same change).

```
ArchiveSink.ts
BroadcastSink.ts
ProjectionSink.ts
```

---

## `src/storage/` — expand

```
ProcessStorage.ts           ← move from root
RuntimeStorage.ts           ← move from root

prisma.ts
redis/
sqlite/
```

---

## Unchanged

```
src/internal/
src/bin/
src/react/
src/ops-ui/
src/prisma/
src/index.ts
src/cli.ts
```

---

## Deferred

- `telemetry/` folder until a second top-level telemetry module exists.
- `ProcessStorage` → `ProcessArchive` rename (slice 6.7).
- Inner split of `RunResourceStore.ts` (~900 LOC) into Types/Queries siblings if still too large.
