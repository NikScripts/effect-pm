---
"@nikscripts/effect-pm": minor
---

**Remove `ProcessExecutionStore` facet (BREAKING).**

Process execution history is **`Process.store(tag)`** only (`RunCompleted` / `RunFailed` on the built-in store contract). The legacy `ProcessExecutionStore` facet, `@nikscripts/effect-pm/store/ProcessExecution` subpath, and `ProcessStorage.ProcessExecution` alias are deleted.

Migration:

```ts
import * as Store from "@nikscripts/effect-pm/Store";

class AppStore extends Store.Service<AppStore>("@app/Store")(
  Process.store(MyProcess),
) {}

const store = yield* MyProcess.store;
const events = yield* store.events({ limit: 50 });
```
