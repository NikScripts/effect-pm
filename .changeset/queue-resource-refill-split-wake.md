---
"@nikscripts/effect-pm": patch
---

**QueueResource**: Split worker wake (`takeNext`) from refill-monitor wake so idle workers never unblock automatic `refill`; enqueue only wakes workers. Automatic refill wakes after queues drain empty following item completion or after `clear`.
