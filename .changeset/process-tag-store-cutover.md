---
"@nikscripts/effect-pm": minor
---

**Process tag wire schemas and execution store (BREAKING).**

### Tag API

- **`Process.Tag`** positional wire slots are **`success`** and **`error`** (config-object overload). Process tags have **no `payload`** — the tick body lives in layer config.
- **Removed `Process.result(Schema)`** — stamp `success` on the tag instead:
  - `Process.Tag()(key, successSchema)`
  - `Process.Tag()(key, successSchema, errorSchema)`
  - `Process.Tag()(key, { success, error?, description? })`
- **Symbol rename:** `successSym` is `@nikscripts/effect-pm/Process/success` (replaces `resultSchemaSym`). External symbol readers must update.

### Execution history

- **Removed `ProcessExecutionStore`** facet, `@nikscripts/effect-pm/store/ProcessExecution` subpath, and `ProcessStorage.ProcessExecution` alias.
- Use **`Process.store(tag)`** on an app **`Store.Service`** — built-in contract with `record` / `events` / `hasPriorExecutions`.
- **Wire rows** use PascalCase `_tag` (`RunCompleted`, `RunFailed`, `RunInterrupted`), optional **`success`** (when the tag stamps `success`), and **`error`** on failures (typed when the tag stamps `error`; otherwise `string`).

### Toolkit layers vs `Process.make`

| Entry | Auto-append execution events? |
|-------|-------------------------------|
| **`Process.layer` / `serve` / `serveRemote`** | **Yes** — default in-memory store merged into the layer |
| **`Process.make`** | **No** — supervisor only; use `layer` or call `store.record` yourself |

Override durable or registered storage at the app root:

```ts
import { Layer } from "effect";
import * as Store from "@nikscripts/effect-pm/Store";
import * as Process from "@nikscripts/effect-pm/Process";

const Price = Schema.Struct({ symbol: Schema.String, usd: Schema.Number });

class Prices extends Process.Tag<Prices>()("app/Prices", Price) {}

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(Prices),
) {}

const live = Layer.provideMerge(
  AppStore.layerMemory, // or AppStore.layer({ filename: "data.sqlite" })
  Process.layer(Prices, { effect: poll, polling }),
);

// query
const store = yield* Prices.store;
const events = yield* store.events({ limit: 50 });
```

### Store bridge (engine authors)

- **`Store.Storage`**, **`Store.layerDefaultMemory`**, **`Store.withDefault`**, and **`Store.withStorage`** are public. Replaces the internal `StoreScopeBridgeTag` name.
