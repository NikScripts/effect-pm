---
"@nikscripts/effect-pm": patch
---

**`InvalidHttpTarget` uses the Layer/Effect error channel** — no sync `throw` (same precedent as `UnaddressedNode`).

- `resolveHttpTarget` is pure `Result`; `Resource.clientHttp` fails the Layer with `InvalidHttpTarget`.
- A positional `Node.Tag(name, badString)` stamps the error and stays unaddressed; derived `connect` fails with `InvalidHttpTarget`.
- Catch via `Exit` / `CatchTag`, not `try/catch` around the factory call.
