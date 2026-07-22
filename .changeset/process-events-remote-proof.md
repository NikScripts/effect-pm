---
"hyperlink-ts": patch
---

**Process.events remote proof + Completed.success coverage.**

HTTP/`Resource.client` tests for live `events` (Started→Completed, stamped Failed, stamped Completed.success). Local assert for Completed.success. Document why Process keeps `Effect.runSync(PubSub.sliding)` for the sync `make` API.
