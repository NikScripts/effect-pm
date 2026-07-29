---
"hyperlink-ts": minor
---

`Hyperlink.withHandoff("workPoolRelease")` now transfers pending WorkPool entries to a Directory peer (`release` → peer `enqueue`, exclude self by dial) during `Node.shutdown`. Soft-fails re-queue locally when no peer or enqueue fails. Replacement addressing stays same `nodeKey` + new dial (no automated A/B launcher).
