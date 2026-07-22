---
"hyperlink-ts": patch
---

**Soft fail-loud** — toolkit layers die at build when Soft captured an AppStore missing the engine registration.

- Process / Queue / CustomQueue / Run probe via `Store.resolveOrDie` at layer build.
- Clearer die message (register `*.store(Tag)` on the AppStore, or omit Soft override).
- Guards: Node-logs-only Soft → `Layer.build` fails (no silent empty journals).
