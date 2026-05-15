---
"@nikscripts/effect-pm": minor
---

Add typed process group declarations and contracts. Processes and queues can now be registered as canonical class services, `ProcessGroup.make(id, entries)` builds a typed group from a single entries tuple, `ProcessGroup.Service` provides an injectable group, and `ControlService` exposes schema-validated group contracts at `GET /contract`.

Also fixes `ProcessStore` execution ordering consistency and keyed queue `clear()` dedup cleanup.
