---
"@nikscripts/effect-pm": minor
---

**Queue lane take algorithm** — pluggable scheduling on `QueueResource` without changing the public enqueue API.

- `levelCount` and `takeAlgorithm` on `QueueResource` / `Service.configure` (`"priority"` default)
- Built-in `"weighted"` and `"strict-descending"`; custom pick via `CustomTakeAlgorithm`
- Numeric `LaneStore` seam + `buildQueueEngine` extension point for `CustomQueueResource`
- Default bundle unchanged: scheduled algorithms load via dynamic import only when configured
