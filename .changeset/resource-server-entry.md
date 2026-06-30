---
"@nikscripts/effect-pm": minor
---

**`Resource.serverEntry(tag, impl)`** — a typed `serveAllHttp` entry for a **raw** custom resource, mirroring `QueueResource.serverEntry` / `ScheduledProcess.serverEntry` / `ApiMetrics.serverEntry`. The impl is **spec-checked** against the tag's spec (`WireServiceOf<S>`), so a typo or missing method is a compile error — a hand-written `{ tag, impl }` literal is typed `Record<string, unknown>` and silently accepts them. `Resource.instance` (which is for the `serveInstances` family, not this) now points here. The bare `{ tag, impl }` literal still works.
