---
"@nikscripts/effect-pm": minor
---

**RunResource handle, RPC, and store persistence (BREAKING).**

- Gates are no longer callable — use **`handle.run(input)`** or **`Tag.run` / `Service.run`** shortcuts.
- **`RunResource.Tag`** is a **`Resource.Tag`** with wire schemas (`runGateStatus`, `runSpec`); **`serve` / `serveRemote`** mirror Queue/Process.
- **`RunResource.store(tag)`** registers built-in run fact + state-history shapes on an app **`Store.Service`**.
- The engine automatically persists to **`RunResourceStore`** (ProcessStorage path) and **`RunResource.store`** when those layers are composed.
- Observable toolkit handles expose **`Subscribable`** views (`status`, `waiting`, `inFlight`, …).
- **`RunResource.Service`** takes a single config object (schemas + `effect` + `concurrency`); **`RunResource.Tag`** accepts a schema triplet or config object.
- Removed deprecated **`RunGate`** type alias.

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
