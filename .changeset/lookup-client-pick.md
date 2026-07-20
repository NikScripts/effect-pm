---
"@nikscripts/effect-pm": minor
---

**D4 — `lookupClient(Tag, { pick })`** opt-in soft pick when N>1 directory rows.

- Bare `lookupClient(Tag)` stays fail-closed (`LookupClientError` on 0 / >1).
- `{ pick: "first" }` or sync `(rows) => DirectoryEntry` dials one replica.
- Identity resolve ignores `pick`; `client(Tag)` remains set-of-one.
