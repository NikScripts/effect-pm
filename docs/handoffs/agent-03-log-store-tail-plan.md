# Agent 3 — Log store tail (durable follower) plan

**Branch:** `cursor/logs-store-followers-906e` (from `integration`).  
**Status:** plan for owner review — implement after accept.  
**Context:** `store-read-0` (RQB `where`) is already on `integration`. This slice is **log storage**.

**Not this slice:** renaming `persistLayer` / deleting `LogStore` (revisit after); level pipes; remote RPC; named handles.

---

## What “log tailing layer” means here

Not a new public Logs API. It means:

> When a **store registration**’s layer builds, the platform forks a scoped fiber that **tails `LogRelay`**, filters for that registration’s scope, and **`log.append`s** matching lines into that registration’s store.

Live tails (`Logs.stream`, `NodeStatus.logs`, `Resource.logs().stream`) already exist. This is the **durable** tail attached to Store.

```
Logs.layer  →  LogRelay (bus)
                    │
                    ├─ live consumers (unchanged)
                    │
                    └─ per store registration (NEW)
                         scopeKey + match + level + memo
                         → handle.log.append(entry)
```

---

## Public surface (what apps write)

```ts
class AppStore extends Store.Service<AppStore>()("@app/Store")([
  Resource.store(WnbaNode),              // node registration — match all / atRoot
  // or sugar: WnbaNode.logs
  QueueResource.store(BoxScoreQueue),    // resource — LogEntry.hasKey(tag.key)
  Process.store(LiveScorePoller),
]) {}

const stack = Resource.httpServer([/* … */]).pipe(
  Layer.provide(Logs.layer),             // capture + bus only
  Layer.provide(AppStore.layerMemory),   // registrations build → each starts a durable tail
);
```

On each registration handle:

```ts
const poller = yield* AppStore.at(LiveScorePoller);
yield* poller.log.append(entry);                    // what the tail calls
const rows = yield* poller.log.read({
  limit: 50,
  where: { level: { in: ["Warn", "Error"] } },      // store-read-0
});
```

No app-facing `followRelayLayer`. Internals stay under `src/internal/logs/` (today’s `storeFollower.ts` seed).

---

## Internal design

### Seed today

`Logs.persistLayer` → `internal/logs/storeFollower.ts`: subscribe to `relay.stream`, batch 64/250ms, `LogStore.recordBatch(node, …)`. Hard-wired to the interim `LogStore` class; no match, no level, no memo.

### Generalize that seed (private)

One internal factory used by store layer build (and optionally later by `persistLayer` as a blunt “all lines” helper):

| Input | Role |
|-------|------|
| `scopeKey` | Registration key (node key or `tag.key`) — memo namespace |
| `match` | Predicate on `LogEntry` — node: all; resource: `LogEntry.hasKey(scopeKey)` |
| `storeLevel` | From registration `Store.logLevel*` until Resource level pipes exist |
| `append` | Closure over that handle’s `log.append` |

Pipeline per registration:

1. Subscribe to `LogRelay.stream` (scoped fiber).  
2. Drop if below `storeLevel`.  
3. Drop if `!match(entry)`.  
4. Memo `(scopeKey, lineId)` — same line never appended twice for that scope.  
5. Batch → `log.append`.

`persistLayer` **left alone** this slice (owner: revisit when done). Examples can keep using it until we migrate.

### `lineId`

Prefer stamp once at capture on the relay (annotation). Fallback: hash of date+level+message+lineage. Memo keys off it.

### Implicit `log` shape

Every toolkit / node store registration gains:

```ts
{ log: Store.shape(LogEntrySchema) }
```

Same baked-in read payload as every other shape (`limit` / `where` / …).

### When the tail starts

On `Store.Service.layer` / `layerMemory` (and equivalent materialize paths): after each registration handle exists, merge a scoped Layer that forks that registration’s tail. Requires `LogRelay` in the environment; if absent, **skip** the durable tail (no second capture logger).

---

## Slice order (this branch)

| Commit focus | Delivers |
|--------------|----------|
| **1** | Implicit `log` shape on `*.store(tag)` (+ node store registration API sketch) |
| **2** | Internal durable-tail factory generalized from `storeFollower.ts` |
| **3** | Wire tails from store layer build; memo + match + level |
| **4** | Tests (`test/logs-follower.test.ts`); docs touch; changeset |

`persistLayer` / `LogStore` stay available until a later revisit.

---

## Tests

1. Resource registration: only lines with `hasKey(tag.key)` land in `log.read`.  
2. Node registration: all lines land.  
3. Memo: same `lineId` twice → one append.  
4. Level: `Store.logLevelWarn` drops Info.  
5. No `LogRelay` → store layer still builds; no durable tail (no crash).

---

## Open (need owner before / during impl)

1. **Both node + resource tails on:** two buckets (copies OK) vs one writer per line?  
2. **`lineId`:** relay-assigned vs hash?  
3. **Node registration API sketch for v1:** ship `Resource.store(Node)` first, `Node.logs` sugar in same PR or follow-up?

---

## Verify

```bash
pnpm typecheck && pnpm test && pnpm lint
```
