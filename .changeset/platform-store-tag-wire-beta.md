---
"@nikscripts/effect-pm": minor
---

**Platform store bridge + tag wire schemas (BREAKING).**

Consolidates store cutover and RPC-aligned tag config on `integration/storage`. No `@deprecated`
shims — update callsites, imports, and symbol readers in one pass.

---

### Tag wire vocabulary (all toolkits)

Public tag / service / wire-config **slot names** now match **`Resource`** RPC names:

| Role | New name | Retired |
|------|----------|---------|
| Request / input / item | **`payload`** | `inputSchema`, `itemSchema`, … |
| Success / return | **`success`** | `successSchema`, `resultSchema`, … |
| Failure channel | **`error`** | `errorSchema` (name kept, meaning aligned) |

**RunResource** supports **positional and config-object** wire schemas (slot rename only).
**QueueResource**, **Process**, and **CustomQueueResource** use **config-object** wire schemas
(`CustomQueueResource` also requires lane fields in that object).

---

### RunResource

- Gates are **not callable** — unit: **`yield* handle.run`**; parameterized: **`yield* handle.run(x)`**
  or static **`Tag.run` / `Service.run`** (same contract).
- **`RunResource.Tag`** is a **`Resource.Tag`** with wire schemas; **`serve` / `serveRemote`**
  mirror Queue/Process.
- Wire slots renamed: `inputSchema` → **`payload`**, `successSchema` → **`success`**,
  `errorSchema` → **`error`** (success/error optional; **omit `payload` for unit gates**).
- **Unit gates** — no payload slot on the contract (like Process `start` / `pause`):
  **`run` is an `Effect` property** → `yield* gate.run` (not `gate.run()`).
- **Parameterized gates** — declare **`payload`** → **`run` is `(input) => Effect`** →
  `yield* gate.run(x)`.
- **Tag arity:** `Tag(key)` / `Tag(key, success)` unit; `Tag(key, payload, success[, error])`
  parameterized; config object `{ payload?, success?, error? }` — unit `(success, error)` pairs
  use the object form when both schemas are explicit.
- **Unit gates** accept a **bare `Effect`** or `() => Effect` on `layer` / `Service`.
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
// unit gate — omit payload; run is Effect
class Tick extends RunResource.Service<Tick>()("@app/Tick", {
  effect: Effect.sleep("1 second"),
})
const tick = yield* Tick
yield* tick.run

// parameterized gate — declare payload; run is a function
const prices = yield* refresh.run(request)
```

---

### Process

- Wire slots renamed: `resultSchema` → **`success`**, `errorSchema` → **`error`**. **No
  `payload`** on Process tags — the tick body lives in layer config.
- **Config object** for `success` / `error` on **`Process.Tag`** (no `payload` on process tags).
- **Removed `Process.result(Schema)`** — declare `success` on the tag instead.
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
class P extends Process.Tag<P>()("app/P", { success: SuccessSchema })
class P extends Process.Tag<P>()("app/P", { success: SuccessSchema, error: ErrSchema })

// removed
class P extends Process.Tag<P>()("app/P").pipe(Process.result(ResultSchema))
```

---

### QueueResource + CustomQueueResource

**QueueResource** — **config object** for wire schemas (`payload` required); slot rename only:

```ts
class Jobs extends QueueResource.Tag<Jobs>()("@app/Jobs", { payload: JobSchema })
class Jobs extends QueueResource.Tag<Jobs>()("@app/Jobs", {
  payload: JobSchema,
  success: SummarySchema,
  error: WorkerErr,
})
```

**CustomQueueResource** — **config object required** for `levelCount` / `namedLevels`; wire slots
renamed inside:

```ts
class Jobs extends CustomQueueResource.Tag<Jobs>()("@app/Jobs", {
  payload: JobSchema,       // was itemSchema
  levelCount: 4,
  namedLevels: { batch: 3 },
  success?: SummarySchema,
  error?: WorkerErr,
})
```

- Engine persists full **`QueueEvent<T>`** lifecycle via **`QueueResource.store(tag)`** /
  **`CustomQueueResource.store(tag)`** on the Store bridge — not facet rows.
- **Removed `QueueResourceStore`** facet and **`@nikscripts/effect-pm/store/QueueResource`**
  subpath.
- Persisted queue **`entry.item`** domain field unchanged; tag wire slot is **`payload`**.

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

class Prices extends Process.Tag<Prices>()("app/Prices", { success: PriceSchema }) {}

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
