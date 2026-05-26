# 06 — Runtime listeners, history, mutable config

Extends **`STORAGE.md`** semantics — **never** resurrect **`ProcessStore`**
monolith methods or public generic **`RuntimeFact`** umbrellas.

Goals:

1. Stable **history vocabulary** where domains need more than append-only facts.
2. **Listener/stream hooks** layered **beside** facets, not leaking into
   **`RuntimeStorage`** adapters.
3. **Mutable runtime config** only where owning module defines clear lifecycle +
   facet-backed persistence.

Candidates: richer **`ProcessSchedule`/Polling** narration, **`HttpApiResource`**
redacted summaries, tighter **`QueueResource`** wire parity with **`04-queue-analytics.md`**.
