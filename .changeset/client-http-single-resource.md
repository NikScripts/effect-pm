---
"@nikscripts/effect-pm": minor
---

Add `Resource.clientHttp(tag, target)` — the single-resource client mirror of `httpServer(serve)`. It bundles `client(tag)` with a batteries-included HTTP transport (Fetch + ndjson) into one client `Layer`. The `target` is a **port** (`3009` or `":3009"` → `http://localhost:3009/rpc`) for a runtime on the same machine, or a full **url** for one across the network; an unparseable target fails loudly.

```ts
Effect.provide(program, Resource.clientHttp(Emails, 3001))                        // same machine
Effect.provide(program, Resource.clientHttp(Emails, "https://mail.internal/rpc")) // anywhere
```
