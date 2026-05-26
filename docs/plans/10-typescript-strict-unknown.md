# 10 — Re-enable **`anyUnknownInErrorContext`**

Flip **`@effect/language-service`** **`anyUnknownInErrorContext`** to **`error`**
once queue + **`ProcessGroup`** boundaries no longer coerce **`unknown`/loose Context**
paths.

Keeps **`serviceNotAsClass`** off.

Pressure points historically: **`ProcessGroup` queue tuple `R` plumbing**,
**`Context.Key`** boundaries — prefer **named public types**, not silent casts.
