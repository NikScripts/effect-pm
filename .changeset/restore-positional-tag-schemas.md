---
"@nikscripts/effect-pm": patch
---

Restore positional wire-schema overloads on `QueueResource.Tag`, `Process.Tag`, and `RunResource.Tag`.

`Tag()(key, payload, success?, error?)` works again alongside the config-object form. `CustomQueueResource.Tag` stays config-object only (lane options require it).
