---
"@nikscripts/effect-pm": minor
---

Add the `@nikscripts/effect-pm/node` subpath with `localServer(serve, port)` — the local mirror of `Resource.clientHttp`. It serves one resource on a local port (`httpServer(serve)` + a Node HTTP server), so two runtimes on the same machine read symmetric:

```ts
import { localServer } from "@nikscripts/effect-pm/node"
const worker = localServer(QueueResource.serve(Emails, { effect: sendEmail }), 3001) // serve on 3001
Effect.provide(enqueue, Resource.clientHttp(Emails, 3001))                            // connect to 3001
```

Node-only (imports `@effect/platform-node`), kept off the browser-safe core.
