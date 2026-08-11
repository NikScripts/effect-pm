---
"hyperlink-ts": minor
---

Made-node listen binds the NodePolicy **listen** set (not the advertise scalar).
Directory advertise still uses the advertise set (one row; only dials in that set
advertise). Add `Node.withPolicy` (process-local overlays on **one** `Node.make` —
never a second make with the same key), `NodePolicy.active`, `Node.forward` /
`forwardAll`, and `Node.activate(node, label)` for Proxy Prefer → live labeled
backend (dream β).
