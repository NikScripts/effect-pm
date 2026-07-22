---
"hyperlink-ts": patch
---

**`Resource.httpServer` + `Resource.provide` — shared majority + isolated outlier.** Documented and regression-tested: put `Resource.provide(shared, [serve…])` next to an isolated `serve.pipe(Layer.provide(private))` in the same `httpServer([...])` list — one `/rpc`, no second port. The retired `serveAllHttp` rewrite cliff is this composition.
