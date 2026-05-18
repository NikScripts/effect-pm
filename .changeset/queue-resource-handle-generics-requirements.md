---
"@nikscripts/effect-pm": minor
---

**Breaking:** `QueueHandle`, `QueueResource.Service`, `QueueResource.Tag`, and `QueueResourceConfig` reorder type parameters so **worker/requirements channel `R` is last**. Order is **`T`**, **`E`** (worker item effect failure), **`EEnqueue`** (schema enqueue failures, usually `never` without `itemSchema`), **`R`** (ambient services).

`QueueEnqueue`-shaped enqueue helpers propagate **`R`**, and `ProcessGroup` exports **`ProcessGroupQueueEnqueueRequirements`** alongside **`ProcessGroupQueueEnqueueError`** so typed **`group.queue(Q).add(…)`** reflects enqueue-time dependencies.

Bundled-queue composition for **`ProcessGroup.Service.layer`** narrows **`Layer.Layer<Self, …, Provided>`** and uses **`Layer.merge`** for remerging queues so Context subtraction stays honest.
