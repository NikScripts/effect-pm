---
"@nikscripts/effect-pm": minor
---

**Platform store bridge + tag wire schemas (BREAKING).**

Consolidates store cutover and RPC-aligned tag config on `integration/storage`. No `@deprecated`
shims — update callsites, imports, and symbol readers in one pass.

---

### Tag wire vocabulary (all toolkits)

Public tag / service / wire-config fields now match **`Resource`** RPC names:

| Role | New name | Retired |
|------|----------|---------|
| Request / input / item | **`payload`** | `inputSchema`, `itemSchema`, … |
| Success / return | **`success`** | `successSchema`, `resultSchema`, … |
| Failure channel | **`error`** | `errorSchema` (name kept, meaning aligned) |

**Config-object `Tag` only** for Queue, CustomQueue, RunResource, and Process (no positional
schema arity).

---

### RunResource

- Gates are **not callable** — use **`handle.run(input)`** or **`Tag.run` / `Service.run`**.
- **`RunResource.Tag`** is a **`Resource.Tag`** with wire schemas; **`serve` / `serveRemote`**
  mirror Queue/Process.
- Tag config: `{ payload, success, error? }` (was `inputSchema` / `successSchema` / `errorSchema`).
- **`RunResource.store(tag)`** registers built-in run fact + state-history shapes on an app
  **`Store.Service`**.
- **`RunResource.layer` / `serve` / `Service.layer`** merge **`Store.layerDefaultMemory`**
  automatically (override with `Layer.provideMerge(AppStore.layerMemory)`).
- Engine persists to **`RunResource.store`** only — **`RunResourceStore`** facet and
  **`@nikscripts/effect-pm/store/RunResource`** subpath **removed**.
- Completed facts persist **`success`** when stamped; failures use **`_tag: "Failed"`** with typed
  **`error`** (or string fallback per store-core §5).
- Store fact rows use PascalCase **`_tag`** (`Started`, `Completed`, `Failed`).
- Observable handles expose **`Subscribable`** views (`status`, `waiting`, `inFlight`, …).
- Removed deprecated **`RunGate`** type alias.

```ts
// before
yield* gate(input)
Tag()(key, inputSchema, successSchema, errorSchema?)

// after
yield* gate.run(input)
Tag()(key, { payload, success, error? })
```

---

### Process

- **`Process.Tag`** wire slots: **`success`** and **`error`** (config-object overload). **No
  `payload`** — the tick body lives in layer config.
- **Removed `Process.result(Schema)`** — stamp `success` on the tag instead.
- **Symbol rename:** `@nikscripts/effect-pm/Process/success` replaces `resultSchemaSym` /
  `@nikscripts/effect-pm/Process/resultSchema`. Update external symbol readers.
- **Removed `ProcessExecutionStore`** facet, **`@nikscripts/effect-pm/store/ProcessExecution`**
  subpath, and `ProcessStorage.ProcessExecution` alias.
- Use **`Process.store(tag)`** on an app **`Store.Service`** — built-in contract with
  `record` / `events` / `hasPriorExecutions`.
- Wire rows: PascalCase `_tag` (`Started`, `Completed`, `Failed`, `Interrupted`), optional
  **`success`**, **`error`** on failures.

| Entry | Auto-append execution events? |
|-------|-------------------------------|
| **`Process.layer` / `serve` / `serveRemote`** | **Yes** — default in-memory store merged |
| **`Process.make`** | **No** — supervisor only |

```ts
// before
class P extends Process.Tag<P>()("app/P", ResultSchema)
  .pipe(Process.result(ResultSchema))

// after
class P extends Process.Tag<P>()("app/P", { success: ResultSchema, error?: ErrSchema })
```

---

### QueueResource + CustomQueueResource

- **Config-object `Tag` only:** `{ payload, success?, error?, … }` (was positional `itemSchema`).
- **`CustomQueueResource.Tag`:** `{ payload, levelCount, namedLevels?, success?, error? }`.
- Engine persists full **`QueueEvent<T>`** lifecycle via **`QueueResource.store(tag)`** /
  **`CustomQueueResource.store(tag)`** on the Store bridge — not facet rows.
- **Removed `QueueResourceStore`** facet and **`@nikscripts/effect-pm/store/QueueResource`**
  subpath.
- Persisted queue **`entry.item`** domain field unchanged; tag config uses **`payload`**.

```ts
// before
class Jobs extends QueueResource.Tag<Jobs>()("@app/Jobs", JobSchema)

// after
class Jobs extends QueueResource.Tag<Jobs>()("@app/Jobs", { payload: JobSchema })
```

---

### Store bridge (golden model)

- **`Store.Service`**, **`Store.at`**, **`Tag.store(tag)`**, declared **`Storage`** dependency,
  **`Store.layerDefaultMemory`** — all four toolkits materialize engine stores through the bridge.
- **Legacy execution facets deleted** from engine paths: `QueueResourceStore`,
  `ProcessExecutionStore`, `RunResourceStore`.
- **RuntimeStorage facets remaining:** `LogStore`, `ProcessLifecycleStore` only
  (`@nikscripts/effect-pm/store/Log`, `store/ProcessLifecycle`).

```ts
import * as Store from "@nikscripts/effect-pm/Store";
import * as Process from "@nikscripts/effect-pm/Process";

class Prices extends Process.Tag<Prices>()("app/Prices", PriceSchema) {}

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(Prices),
) {}

const live = Layer.provideMerge(
  AppStore.layerMemory,
  Process.layer(Prices, { effect: poll, polling }),
);

const store = yield* Prices.store;
const events = yield* store.events({ limit: 50 });
```

---

### Removed subpaths (do not import)

| Subpath | Replacement |
|---------|-------------|
| `@nikscripts/effect-pm/store/QueueResource` | `QueueResource.store(tag)` |
| `@nikscripts/effect-pm/store/ProcessExecution` | `Process.store(tag)` |
| `@nikscripts/effect-pm/store/RunResource` | `RunResource.store(tag)` |
