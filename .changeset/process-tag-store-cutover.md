---
"@nikscripts/effect-pm": minor
---

**Process tag wire schemas, store engine tap, and layer store requirement (BREAKING).**

- **`Process.Tag`** positional wire slots are **`success`** and **`error`** (config object overload). No `payload` on Process tags.
- **Removed `Process.result(Schema)`** — use `Process.Tag()(key, success)` or `{ success, error? }` on the tag factory instead.
- **`successSym`** replaces `resultSchemaSym` (`Symbol.for("@nikscripts/effect-pm/Process/success")`) — external symbol readers must update.
- **`Process.layer` / `serve` / `serveRemote`** include a **baked-in default in-memory store**. Override with an app **`Store.Service`** via `Layer.provideMerge` at the root when you need durable or registered storage.
- Toolkit engine writes terminal runs to **`Process.store(tag)`** only.
- **Removed `ProcessExecutionStore`** facet and `@nikscripts/effect-pm/store/ProcessExecution` subpath — use **`Process.store(tag)`** for execution history.

Migration:

```ts
// tag — value-returning process
class Prices extends Process.Tag<Prices>()("app/Prices", PriceSchema, FetchErr) {}

// app root — optional override when you register Process.store(tag)
import { Layer } from "effect";
import * as Store from "@nikscripts/effect-pm/Store";

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(Prices),
) {}

Layer.provideMerge(
  AppStore.layerMemory,
  Process.layer(Prices, { effect: poll }),
);
```
