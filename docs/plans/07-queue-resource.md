# 07 — QueueResource & storage hooks (planned)

## Goal

Align queue analytics with **ProcessStore**:

- Hooks: `onEnqueued`, `onEffectComplete`, `onForkComplete`, `onEmpty`, `onMaxRetries` (names TBD; must match `01-naming-contract.md` when locked).
- Semantics: `getKey`, `skipDuplicates`, `maxRetries`, `historyLimit`, top-level + storage-level `onMaxRetries`, `fill` helper for replay.
- Record shapes: typed unions for enqueue / effect complete / fork complete (serializable into store).

## Status

Current **QueueResource** is runtime-complete; storage hook integration with **ProcessStore** is not wired.
