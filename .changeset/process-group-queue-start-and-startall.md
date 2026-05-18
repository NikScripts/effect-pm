---
"@nikscripts/effect-pm": minor
---

**ProcessGroup `startAll`** now runs **`QueueHandle.start`** for every registered queue **before** starting processes (pairs with **`QueueResource` `autoStart: false`**).

Adds **`TypedProcessGroup.startAll`**, **`TypedQueueControls.start`**, contract capability **`start`** on queues, **`POST /queues/:id/start`** on **ControlService**, and **`RemoteQueueControls.start`** / **`POST …/start`** on **ProcessManager**. Multi-group CLI exposes **`queue-start <target>`** (distinct from **`start`** for processes).
