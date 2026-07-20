---
"@nikscripts/effect-pm": patch
---

**Shared dial Layer per Node class** — derived `Node.connect(AddressedNode)` and `Resource.client(Tag, AddressedNode)` auto-connect now share one WeakMap-memoized Layer (`internal/nodeConnect`), so MemoMap opens a single transport when multiple clients target the same Node. Derived `connect` no longer pretends an `UnaddressedNode` error channel. Path `{ kind }` narrowed to `"IpcSocket"` only.
