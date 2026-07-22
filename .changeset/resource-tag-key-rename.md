---
"hyperlink-ts": minor
---

Rename resource/service tag identity from `id` to `key` across the toolkit: tag factories take `key` as the first argument, tags expose Effect's `.key` (not a custom `.id`), `ResourceInstance` and `DuplicateResourceKey` use `key`, UI bindings (`ResourceUI.key`) follow the same naming, and multi-instance RPC routing uses the HTTP `key` header for instance dispatch.
