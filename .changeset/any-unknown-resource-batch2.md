---
"@nikscripts/effect-pm": patch
---

Clear `anyUnknownInErrorContext` hits in Resource serve/client boundaries (batch 2): `mapEffects`/`provideContext`/`serveRemote`/`clientLayer` use contained `as any` at RpcServer and Layer merge seams; Process, Store, Run, Queue, CustomQueue, and Lookup catch-all impls aligned.
