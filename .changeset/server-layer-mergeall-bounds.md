---
"@nikscripts/effect-pm": patch
---

**`httpServer` / `wsServer` / `ipcServer` align with Effect `Layer.mergeAll`** — serve-list bounds use contravariant `Layer<never, …>`; construction errors propagate via `Layer.Error` (no longer hard-erased to `never`); merge uses `Layer.mergeAll` instead of a hand-rolled `any` fold. `listen`'s serve list uses the same `ROut` bound with `R = never`.
