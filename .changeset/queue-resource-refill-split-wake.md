---
"@nikscripts/effect-pm": patch
---

**QueueResource**: Split worker wake (`takeNext`) from drain-monitor wake so idle workers never unblock `onDrained`; enqueue only wakes workers. The `onDrained` lifecycle hook wakes after queues drain empty following item completion or after `clear`.
