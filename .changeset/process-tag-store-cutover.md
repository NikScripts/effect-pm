---
"@nikscripts/effect-pm": minor
---

**Process tag wire schemas, store engine tap, and layer store requirement (BREAKING).**

- **`Process.Tag`** positional wire slots are **`success`** and **`error`** (config object overload). No `payload` on Process tags.
- **Removed `Process.result(Schema)`** — use `Process.Tag()(key, success)` or `{ success, error? }` on the tag factory instead.
- **`successSym`** replaces `resultSchemaSym` (`Symbol.for("@nikscripts/effect-pm/Process/success")`) — external symbol readers must update.
- **`Process.layer` / `serve` / `serveRemote`** now require **`StoreScopeBridgeTag`** in the layer environment. Provide **`layerDefaultMemory`** or an app **`Store.Service.layerMemory`** at the **root** via `Layer.provide` (do not bake into the resource layer).
- Toolkit engine writes terminal runs to **`Process.store(tag)`** only — legacy **`ProcessExecutionStore`** is not written by the engine.

Migration:

```ts
// tag — value-returning process
class Prices extends Process.Tag<Prices>()("app/Prices", PriceSchema, FetchErr) {}

// app root — Process.layer requires StoreScopeBridgeTag
import * as Store from "@nikscripts/effect-pm/Store";

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(Prices),
) {}

Process.layer(Prices, { effect: poll }).pipe(Layer.provide(AppStore.layerMemory));
```
