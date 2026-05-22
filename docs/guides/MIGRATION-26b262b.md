# Migration guide: `26b262b` → current `main`

This document helps you upgrade code written against commit **`26b262b`** (`test: document process-enqueued refill trigger`, 2026-05-20) to the current package API on **`main`** (HEAD at time of writing: **`eabac3e`** — ProcessManager-first guides + positional queue factories).

**Scope:** application and library code that imports `@nikscripts/effect-pm`. It is not a line-by-line changelog; it focuses on **breaking or behavioral changes** you must touch when upgrading.

**Companion docs (current API, no legacy catalog):**

| Topic | Guide |
| --- | --- |
| Processes | [process.md](./process.md) |
| Queues | [queue-resource.md](./queue-resource.md) |
| Groups | [process-group.md](./process-group.md) |
| Operators | [process-manager.md](./process-manager.md) |
| HTTP server | [control-plane.md](./control-plane.md) |

For a branch-merge narrative aimed at `feature/runtime-foundation`, see [`docs/MERGE-runtime-foundation-vs-main.md`](../MERGE-runtime-foundation-vs-main.md). That file predates some `main` fixes; **this guide and the guides above supersede it** where they disagree (for example **`POST /control` is still the ProcessManager transport** alongside REST).

---

## Summary

Between **`26b262b`** and **`main`** (~45 commits), the runtime foundation landed on `main`:

1. **Process** — positional `make` / `Service`; removed `providePolling` / `provideSchedule`; stricter layer validation.
2. **Polling** — removed `acceleratingScoped` (and related legacy exports).
3. **QueueResource** — removed `persist` / `refill` / `onEmpty`; unified lifecycle hooks; positional `Service` / `layer` / `make`; `releaseEncoded` and pending release controls.
4. **ProcessGroup** — optional **third argument** for ProcessManager endpoint config (`configItems`).
5. **ProcessManager** — `LocalRuntime`, `Endpoint.module`, `group-start` / `group-stop`, richer CLI; endpoint config on the group instead of only ad hoc `Endpoint()(group, { baseUrl })`.
6. **Storage** — `RuntimeStorage` contract, SQLite adapter, ProcessStore backed by semantic runtime records and query APIs.
7. **Control** — protocol **envelopes** on `POST /control` (REST routes unchanged in role).
8. **Toolchain** — Effect `^4.0.0-beta.65` → `^4.0.0-beta.69`.

Publish a **changeset** (semver minor/major as you treat breaking API) when you release this range to npm.

---

## Upgrade checklist

Use this as a PR checklist after bumping the package.

- [ ] Replace **`Process.providePolling` / `provideSchedule`** with positional layers or config fields on **`Process.make`** / **`Process.Service`**.
- [ ] Replace **`Polling.acceleratingScoped`** with **`Polling.accelerating`**.
- [ ] Remove queue **`persist`**, **`refill`**, **`onEmpty`**, and **`handle.refill()`**; map to **`onDrained`**, **`onStart`**, and/or **`onEnqueued`** (see [Queue hooks](#queueresource-hooks-and-refill-removal)).
- [ ] Rename queue hooks: **`onEnqueue`** → **`onEnqueued`**, **`onComplete`** → **`onCompleted`**; add **`onExit`** / per-stage hooks where you need finer lifecycle.
- [ ] Optionally adopt **`QueueResource.Service(id, effect, options?)`** instead of `(id, { effect, … })` only.
- [ ] Add **`ProcessGroup.Service(..., configItems?)`** (or `make` third arg) if you use **`ProcessManager.cli`** with **`group-start`** / **`--target`**.
- [ ] Introduce **`ProcessManager.LocalRuntime`** + **`Endpoint.module`** for module launch, or keep **`Endpoint.http`** for fixed URLs.
- [ ] Wire **`RuntimeStorage`** / **`ProcessStore`** if you relied on in-memory-only analytics or new query surfaces.
- [ ] Run **`ProcessManager.cli`** `verify` after deploy; fix contract drift.
- [ ] Re-run **`pnpm check`** / tests; fix **`ProcessMakeInvalidLayerArgument`** at compile time where positional args are wrong.

---

## Process

### What stayed the same at `26b262b`

- Process id is the **first argument** to **`Process.make(id, config)`** — there is no `name` field on **`ProcessMakeOptions`** (internal config still carries `name` equal to `id`).
- Default schedule when both **`schedule`** and **`scheduleLayer`** are omitted is already **`ProcessSchedule.alwaysArmed`**.
- **`Process.Service`** exists; only the **config-object** overload existed on the service factory.

### What changed

#### Positional `Process.make` / `Process.Service`

**Before (`26b262b`):**

```typescript
const p = Process.make("@app/Worker", {
  effect: Effect.logInfo("tick"),
  polling: Polling.spaced(Duration.seconds(5)),
  schedule: ProcessSchedule.empty,
});

class Worker extends Process.Service<Worker>()("@app/Worker", {
  effect: Effect.logInfo("tick"),
  polling: Polling.spaced(Duration.seconds(5)),
}) {}
```

**After (current):**

```typescript
const p = Process.make(
  "@app/Worker",
  Effect.logInfo("tick"),
  Polling.spaced(Duration.seconds(5)),
  ProcessSchedule.empty,
);

class Worker extends Process.Service<Worker>()(
  "@app/Worker",
  Effect.logInfo("tick"),
  Polling.spaced(Duration.seconds(5)),
  ProcessSchedule.empty,
) {}
```

Polling and schedule layers may appear in **either order** as the third and fourth arguments. Schedule **initializers** `(controls) => Effect` still require the **config object** form.

Invalid third/fourth arguments throw **`ProcessMakeInvalidLayerArgument`** (fail at construction time, not at `group.start`).

#### Removed `providePolling` / `provideSchedule`

**Before:**

```typescript
const base = Process.make("@app/Worker", { effect: Effect.void });
const withPoll = Process.providePolling(base, Polling.spaced(Duration.seconds(1)));
```

**After:** inline layers on `make` / `Service`, or use the config object:

```typescript
Process.make("@app/Worker", {
  effect: Effect.void,
  polling: Polling.spaced(Duration.seconds(1)),
});
```

There is no post-hoc attachment API on the **`Process`** export object anymore.

---

## Polling

**Before:** `Polling.acceleratingScoped` (deprecated alias around internal refs).

**After:** use **`Polling.accelerating`** only. `acceleratingScoped` and `acceleratingWithRefs` are **removed** from the public **`Polling`** object.

---

## QueueResource

### Positional factories (optional migration)

At **`26b262b`**, **`QueueResource.Service`** only accepted **`(id, config)`** with **`effect` inside the config.

**After:** preferred shape is **`(id, effect, options?)`** where **`options`** is config **without** `effect` (and without `name` — id is the name).

```typescript
// Before
class Q extends QueueResource.Service<Q, Item>()("@app/Q", {
  effect: (item) => work(item),
  concurrency: 4,
}) {}

// After (equivalent)
class Q extends QueueResource.Service<Q, Item>()(
  "@app/Q",
  (item) => work(item),
  { concurrency: 4 },
) {}
```

Same overload pattern applies to **`QueueResource.layer(tag, effect, options?)`** and **`QueueResource.make(effect, options?)`**.

### Hooks and refill removal

At **`26b262b`** the queue config and handle still supported **refill-oriented** APIs:

| Removed / renamed | Replacement |
| --- | --- |
| **`persist`** on enqueue | Use normal enqueue + your own storage, or **ProcessStore** / **RuntimeStorage** records |
| **`refill`** config + **`handle.refill()`** | **`onDrained`** (empty after work or **`clear`**, not cold-start idle) and/or **`onEnqueued`** |
| **`onEmpty`** (`Effect` hook) | **`onDrained`** with event + controls |
| **`onEnqueue`** | **`onEnqueued`** (batch + controls) |
| **`onComplete(item, exit, elapsed)`** | **`onCompleted`** (`{ entry, elapsed }` + controls) |

Current lifecycle hooks (all optional, receive **controls** for re-enqueue / pause / etc.):

- **`onStart`**, **`onStarted`**, **`onExit`**, **`onCompleted`**, **`onFailed`**
- **`onRetryScheduled`**, **`onRetryExhausted`**
- **`onDrained`**, **`onCleared`**, **`onReleased`**, **`onDeadLettered`**, **`onDropped`**

Hook failures are logged; they no longer fail the worker silently without a trace (see `3133cc1`).

**Example — refill → drain hook:**

```typescript
// Before (26b262b)
QueueResource.make({
  name: "@app/Inbox",
  effect: process,
  refill: (handle) =>
    handle.add(loadMoreFromDb()).pipe(
      Effect.tap(() => Effect.logInfo("refilled")),
    ),
});

// After
QueueResource.make({
  name: "@app/Inbox",
  effect: process,
  onDrained: ({ queueId }, handle) =>
    loadMoreFromDb().pipe(
      Effect.flatMap((items) => handle.add(items)),
      Effect.tap(() => Effect.logInfo("refilled after drain", queueId)),
    ),
});
```

### Release encoding

**`QueueHandle.releaseEncoded`** (and pending release controls on the control plane) accept schema-backed payloads for operator **`release`** actions. If you only used in-process **`release`**, behavior is unchanged; HTTP/CLI callers can use encoded releases when the group contract exposes them.

### Requirements inference

Queue **`Service`** / **`layer`** **R** type parameters are inferred from optional hook and **`effect`** requirements in config (`d77d061`). After hook renames, fix types where inference widens or narrows.

---

## ProcessGroup

### Typed entries (unchanged recommendation)

**`ProcessGroup.Service(id, entries)`** and **`ProcessGroup.make(id, entries)`** were already the typed path at **`26b262b`**.

Legacy **`ProcessGroup.make({ queues, processes })`** still exists internally but is **not** the documented product path; prefer **`[MyProcess, MyQueue] as const`**.

### Endpoint config (new third argument)

**Before:** remote URLs lived in **`ProcessManager.ConnectionRegistry`** and/or per-endpoint services:

```typescript
class BillingRemote extends ProcessManager.Endpoint<BillingRemote>()(
  BillingGroup,
  { baseUrl: "http://127.0.0.1:3001" },
) {}
```

**After:** declare endpoints on the **group** (bundled into CLI catalog and **`--target`**):

```typescript
export class BillingGroup extends ProcessGroup.Service<BillingGroup>()(
  "@app/Billing",
  [SyncProcess, InvoiceQueue] as const,
  [
    Endpoint.local(
      Endpoint.module(
        () => import("./billing-runtime.js"),
        (mod) => mod.BillingRuntime,
      ),
    ).default,
    Endpoint.production(
      Endpoint.http({
        transport: ProcessManager.Transport.http({
          baseUrl: "http://prod.example:3001",
        }),
      }),
    ),
  ],
) {}
```

**`ProcessManager.Config.layer`** still overrides selection when you need environment-specific wiring without editing the group class.

**`remoteLayer`** on **`ProcessGroup`** (HTTP client to a remote contract) is unchanged in role; see [process-group.md](./process-group.md).

---

## ProcessManager and control plane

### CLI and commands

At **`26b262b`**, **`ProcessManager.cli`** existed with **`connect`** and **`ConnectionRegistry`**, but there was no **`group-start`**, **`LocalRuntime`**, or **`Endpoint.module`**.

**After:**

| Capability | Notes |
| --- | --- |
| **`groups`**, **`ls`**, **`verify`**, **`status`** | Endpoint status includes **Configured / Pending / Online / Offline / ContractDrift** |
| **`group-start` / `group-stop`** | Launches **module** endpoints (child process + control URL under `.effect-pm/run/groups`) |
| **`--target <label>`** | Selects non-default item from group **`configItems`** |
| **`start` / `stop` / `restart` / `now`**, queue controls | Canonical ids or unique suffix aliases |

**`createCli` / `runCli`** remain exported for **single-group, fixed-port** local tools; operator docs center on **`ProcessManager.cli`** for multi-group catalogs. See [process-manager.md](./process-manager.md).

### `LocalRuntime` + `Endpoint.module`

Export a descriptor from your runtime entry module:

```typescript
export const BillingRuntime = ProcessManager.LocalRuntime(BillingGroup, {
  layer: /* group + processes + queues + store */,
  control: ControlService.layerHttp(BillingGroup, { port: 3001 }),
});
```

**`Endpoint.module(() => import("…"), select)`** must return that descriptor. Reference fixture: `test/fixtures/process-manager-module-definition.ts`.

### HTTP: REST + `/control`

**Unchanged assumption:** control server binds **`127.0.0.1`** only.

| Path | Client |
| --- | --- |
| REST (`GET /contract`, `POST /processes/:id/start`, …) | Direct HTTP, scripts |
| **`POST /control`** | **ProcessManager** (envelope **`ControlProtocolRequest`**) |

REST handlers and **`/control`** share the same protocol router. See [control-plane.md](./control-plane.md) — do not assume **`POST /control` was removed** (older merge notes were wrong).

---

## ProcessStore and RuntimeStorage

At **`26b262b`** there was **no** `src/RuntimeStorage.ts`; ProcessStore already emitted some **runtime.fact** events, but the **storage adapter boundary**, **SQLite adapter**, **semantic queue/process records**, and **query options** (`QueryOpts`, fact/history queries) landed after that commit.

**Migration steps:**

1. If you only used **`ProcessStore.layer`** in memory — no change required; you gain richer records automatically when store is provided.
2. For durable analytics / audit — provide **`RuntimeStorage`** (file or SQLite adapter under `src/storage/sqlite/`) and compose **`ProcessStore`** as documented in package exports.
3. Handle **`ProcessStore` write errors** surfaced to callers (`3cb585e`) where you previously ignored silent drops.

---

## Effect version

| | `26b262b` | Current `main` |
| --- | --- | --- |
| **peer** | `effect ^4.0.0-beta.65` | `effect ^4.0.0-beta.69` |

Align your app’s Effect version with the peer range before upgrading effect-pm.

---

## ProcessGroup legacy `make({ queues, processes })`

Still present for backward compatibility. If you use it at **`26b262b`**, you can keep it short term, but you should migrate to:

```typescript
ProcessGroup.Service<MyGroup>()("@app/MyGroup", [QueueA, ProcessB] as const);
```

Typed **`group.start`**, **`group.queue("…")`**, contract generation, and ProcessManager **`verify`** all assume **service entries**, not bare **`Process.make`** handles in a bag.

---

## Suggested upgrade order

1. Bump **Effect**, then **@nikscripts/effect-pm**.
2. Fix **compile errors** (Process positional layers, removed Polling/Process helpers, queue hook renames).
3. Run unit/integration tests; fix **refill** / **onEmpty** behavior with **`onDrained`** semantics (cold start no longer triggers refill).
4. Add **group endpoint config** + **`LocalRuntime`** if you use the CLI operator workflow.
5. Run **`ProcessManager.cli verify`** against staging endpoints.
6. Add **changeset** and release notes pointing to this file.

---

## Commit map (high level)

| Area | Representative commits (after `26b262b`) |
| --- | --- |
| Runtime storage / SQLite | `daf28a5` … `22a9861`, `1c4ff15` |
| Queue hooks / refill removal | `0535cdf`, `c7a6f54`, `3133cc1` |
| Queue release encoding | `425b636`, `9fcc360` |
| Control protocol envelopes | `2a3bdcc` |
| PM endpoint config + module launch | `587cd7b` … `85142ce` |
| Positional Process API | `7c0c37b`, `ec1546a` |
| Positional Queue API + guides | `3aaa978`, `eabac3e` |

To regenerate the exact file list:

```bash
git diff 26b262b..HEAD --stat
git log 26b262b..HEAD --oneline
```
