---
"@nikscripts/effect-pm": minor
---

**RunResource handle, RPC, and store persistence (BREAKING).**

- Gates are no longer callable — use **`handle.run(input)`** or **`Tag.run` / `Service.run`** shortcuts.
- **`RunResource.Tag`** is a **`Resource.Tag`** with wire schemas (`runGateStatus`, `runSpec`); **`serve` / `serveRemote`** mirror Queue/Process.
- **`RunResource.store(tag)`** registers built-in run fact + state-history shapes on an app **`Store.Service`**.
- The engine persists to **`RunResource.store`** / **`Store.layerDefaultMemory`** only — **`RunResourceStore`** facet removed.
- Observable toolkit handles expose **`Subscribable`** views (`status`, `waiting`, `inFlight`, …).
- **`RunResource.Service`** takes a single config object (schemas + `effect` + `concurrency`); **`RunResource.Tag`** accepts a schema triplet or config object.
- Removed deprecated **`RunGate`** type alias and **`@nikscripts/effect-pm/store/RunResource`** subpath.

Migration:

```ts
// before
yield* gate(input)
yield* gate(undefined)

// after
yield* gate.run(input)
yield* gate.run()
yield* MyGate.run(input)
```

```ts
// before — ProcessStorage facet reads
import { RunResourceStore } from "@nikscripts/effect-pm/store/RunResource";
yield* RunResourceStore.recordRunStarted(fact);

// after — Store bridge
import * as RunResource from "@nikscripts/effect-pm/RunResource";
import * as Store from "@nikscripts/effect-pm/Store";

const registration = RunResource.store(MyGate);
const store = yield* Store.at(scopeKey, registration.contract);
yield* store.record(fact);
```
