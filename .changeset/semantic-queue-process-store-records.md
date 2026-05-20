---
"@nikscripts/effect-pm": minor
---

Add semantic `ProcessStore.QueueResource` helpers for queue entry, lifecycle, and dedupe-key records, and wire `QueueResource` to write indexed runtime records through `ProcessStore` when it is available.

Move the default in-memory `ProcessStore` backing store onto `RuntimeStorage`, with legacy analytics reads projected from normalized records.
