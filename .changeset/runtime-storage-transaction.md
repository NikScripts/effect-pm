---
"@nikscripts/effect-pm": minor
---

**`RuntimeStorage.transaction`** — atomic read/write scopes on memory, SQLite, and Prisma adapters.

- New `RuntimeStorageService.transaction(effect)` runs `effect` with a transactional
  `RuntimeStorage` in context; commits on success, rolls back on failure.
- Conformance tests cover commit and rollback semantics.
