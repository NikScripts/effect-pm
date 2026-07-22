---
"hyperlink-ts": minor
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

**Positional and config-object forms both remain valid** for QueueResource, RunResource, and
Process — this release renames the slots, not the calling convention.

**CustomQueueResource** always requires a **config object** for lane options (`levelCount`,
`namedLevels`, …); wire schemas inside use the same renamed slots (`payload`, `success`, `error`).

---

### RunResource

- Gates are **not callable** — use **`handle.run(input)`** or **`Tag.run` / `Service.run`**.
- **`RunResource.Tag`** is a **`Resource.Tag`** with wire schemas; **`serve` / `serveRemote`**
  mirror Queue/Process.
- Wire slots renamed: `inputSchema` → **`payload`**, `successSchema` → **`success`**,
  `errorSchema` → **`error`** (all **optional** — default `Void` / `Void` / `Never`; positional or object).
- **Unit gates** accept a **bare `Effect`** or `() => Effect` on `layer` / `Service` (not only thunk form).
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
// handle — before / after
yield* gate(input)        // before
yield* gate.run(input)    // after

// tag — positional (slot rename; success/error optional)
Tag()(key, inputSchema, successSchema?, errorSchema?)   // before
Tag()(key, payload, success?, error?)                   // after

// tag — config object (slot rename; all wire slots optional)
Tag()(key, { inputSchema, successSchema?, errorSchema? })   // before
Tag()(key, { payload?, success?, error? })                  // after

// unit gate — bare effect (Service / layer)
class Tick extends RunResource.Service<Tick>()("@app/Tick", {
  effect: Effect.sleep("1 second"),
})
```

---

### Process

- Wire slots renamed: `resultSchema` → **`success`**, `errorSchema` → **`error`**. **No
  `payload`** on Process tags — the tick body lives in layer config.
- **Positional or config-object** for `success` / `error` on **`Process.Tag`**.
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
// positional — still valid
class P extends Process.Tag<P>()("app/P", ResultSchema)              // before (result slot)
class P extends Process.Tag<P>()("app/P", SuccessSchema)             // after (success slot)
class P extends Process.Tag<P>()("app/P", SuccessSchema, ErrSchema)  // after (+ error)

// config object — still valid
class P extends Process.Tag<P>()("app/P", { success: SuccessSchema, error?: ErrSchema })

// removed
class P extends Process.Tag<P>()("app/P").pipe(Process.result(ResultSchema))
```

---

### QueueResource + CustomQueueResource

**QueueResource** — positional and config-object both valid; 2nd positional arg is **`payload`**
(was `itemSchema`):

```ts
class Jobs extends QueueResource.Tag<Jobs>()("@app/Jobs", JobSchema)                    // still valid
class Jobs extends QueueResource.Tag<Jobs>()("@app/Jobs", { payload: JobSchema })        // still valid
class Jobs extends QueueResource.Tag<Jobs>()("@app/Jobs", JobSchema, Summary, WorkerErr) // positional success/error
class Jobs extends QueueResource.Tag<Jobs>()("@app/Jobs", { payload: JobSchema, success: Summary, error: WorkerErr })
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
