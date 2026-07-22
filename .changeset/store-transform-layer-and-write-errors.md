---
"hyperlink-ts": minor
---

**`Store` transform layer + categorized `StoreWriteError` (breaking).** The store now separates a
genuine journal/IO **write** failure from an encode bug, and turns a contract into a set of ready-to-record
**effects** you refine with generic transforms.

Added:

- **`StoreWriteError`** (`@public`) — a catchable `Data.TaggedError` the storage layer returns on a
  journal/IO **write** failure. The append path maps its write failure here; the **encode** step stays
  `Effect.orDie` (a schema mismatch is a bug → defect); reads keep `StoreJournalDecodeError`. The error
  *carries* the category — no method needs marking.
- **`Store.effects(scope, contract)`** — a pure object of effects shaped like the handle (nested tree +
  custom methods) where **`Storage` rides on every method's requirement**. No eager resolve, no memo
  cell. Write methods honestly carry `StoreWriteError` in `E`; reads carry `never`.
- **`Store.mapEffects(effects, transform)`** — the generic combinator: apply a transform to every store
  method's returned `Effect` (e.g. `withSpan` / `retry` / `timed`), re-nest, re-brand. Type-preserving
  transforms pass through unchanged; type-changing ones flow per method.
- **`Store.catchWriteErrors(effects)`** — one-liner over `mapEffects`: log + swallow `StoreWriteError`
  on writes (narrowing it out of `E`), leaving defects and read/other errors untouched.

Breaking:

- **`append` is now `Effect<void, StoreWriteError>`** (was a cast-to-`never` lie). Write callers see the
  honest error; narrow it with `Store.catchWriteErrors`.
- **Removed `withStorage` / `withDefault`** — use `resolve` / `resolveOrDie` (no deprecated aliases).
- **Removed the hand-rolled `swallowWriteErrors`** (write-path metadata) in favor of the generic
  `mapEffects` / `catchWriteErrors` pair.

See `docs/guides/store.md`, `docs/guides/store-backing.md`, and `docs/guides/store-migration.md`.
</content>
