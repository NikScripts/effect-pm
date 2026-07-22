---
"hyperlink-ts": minor
---

**Promote `Store.Storage` and `Store.layerDefaultMemory` to the public API.**

Third-party and custom toolkit engines declare **`Store.Storage`** as a layer dependency and resolve
handles with **`Store.withDefault`** (always-on, materializes scopes) or **`Store.withStorage`**
(fails when the scope is not registered).

- **`Store.StorageApi`** — type the bridge surface for custom implementations.
- **`Store.layerDefaultMemory`** — merge into toolkit layers so engines never use `Effect.serviceOption` on storage.

Replaces the retired internal name **`StoreScopeBridgeTag`**.

```ts
import * as Store from "@nikscripts/effect-pm/Store";
import { Effect, Layer } from "effect";

const program = Effect.gen(function* () {
  const store = yield* Store.withDefault(scopeKey, myContract);
  yield* store.record(row);
});

const layer = myResourceLayer.pipe(Layer.provideMerge(Store.layerDefaultMemory));
```
