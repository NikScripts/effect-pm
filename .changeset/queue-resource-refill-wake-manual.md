---
"@nikscripts/effect-pm": patch
---

**QueueResource**: Replace **`config.refill`** and **`QueueHandle.refill`** with queue-bound lifecycle hooks. Use **`onStart(queue)`** for bootstrap work and **`onDrained(queue)`** after queues drain empty once activity has awakened the drain monitor. Cold-start idle workers do not trigger **`onDrained`**.
