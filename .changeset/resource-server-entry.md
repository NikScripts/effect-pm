---
"@nikscripts/effect-pm": minor
---

**`Resource.serverEntry(tag, impl)`** — a typed `serveAllHttp` entry for a **raw** custom resource, mirroring `QueueResource.serverEntry` / `ScheduledProcess.serverEntry` / `ApiMetrics.serverEntry`. The impl is **spec-checked** against the tag's spec (`WireServiceOf<S>`), so a typo or missing method is a compile error — a hand-written `{ tag, impl }` literal is typed `Record<string, unknown>` and silently accepts them. Two impl forms: a plain **record** (`R = never`), or an **`Effect`** that builds the record at assembly and carries a requirement `R` (e.g. a pooled connection / a provided service) — `R` is surfaced into the entry so `serveAllHttp` demands and unions it instead of erasing it. `Resource.instance` (which is for the `serveInstances` family, not this) now points here. The bare `{ tag, impl }` literal still works.
