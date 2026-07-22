---
"hyperlink-ts": minor
---

**Breaking — rename storage facet services to `*Store`.**

| Before | After |
|--------|-------|
| `ProcessStoreQueueResource` | `QueueResourceStore` |
| `ProcessStoreRunResource` | `RunResourceStore` |
| `ProcessStoreLog` | `LogStore` |
| `ProcessStoreProcessExecution` | `ProcessExecutionStore` |
| `ProcessStoreProcessLifecycle` | `ProcessLifecycleStore` |
| `ProcessStoreProcessGroup` | `ProcessGroupStore` |

Context tags and `@nikscripts/effect-pm/store/*` subpaths are unchanged.
`ProcessStorage.QueueResource` (etc.) remain shorthand property aliases.
`ProcessStore` is still the facet builder module only.

No deprecated re-exports of old names.
