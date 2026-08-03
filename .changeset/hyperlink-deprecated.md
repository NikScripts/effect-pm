---
"hyperlink-ts": minor
---

Add `Hyperlink.deprecated` — retire a Spec method from the typed Handle while keeping it on the wire / `contractHash` (and requiring a serve impl) for skew. Prefer `.pipe(Hyperlink.deprecated)`; data-first dual also works. Guide: `docs/guides/deprecated.md`.
