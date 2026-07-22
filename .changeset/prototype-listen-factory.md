---
"hyperlink-ts": minor
---

**`Node.Prototype.listen(serves)`** — curried dynamic-instance spawn.

- `Proto.listen([serve…])` → `(suffix?: string) => Layer` (sugar over `Resource.listen(instance(suffix), serves)`).
- Returns Layer only; minted Node is `ListenNode` after `Layer.build`.
- `instance()` stays public; named clones keep `Resource.listen(East, serves)`.
