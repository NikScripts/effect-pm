---
"hyperlink-ts": minor
---

`PolicyBuilder`: HttpApi-shaped constructables with Schema keys. Each key is a
`Context.Reference` — `defaultValue` is the Reference default (ambient
`yield* Ref`), not a second defaults system. Domain modules recreate helpers and
re-export references; no public `Family` API.
