---
"hyperlink-ts": minor
---

`PolicyBuilder`: HttpApi-shaped constructables with Schema keys. Each key is a
`Context.Reference` — `defaultValue` is the Reference default (ambient
`yield* Ref`), not a second defaults system. Domain modules recreate helpers and
re-export references; no public `Family` API.

Fragments are a tagged sum (`_tag` = knob name, `value` = payload).
`succeed({ _tag, value })`; `make` accepts a product bag or `Fragment[]`
(same product config stamp). Two-arg `succeed(name, value)` removed.

`Def.fragments` / `Policy.Fragment`: value-first ctors, `$is`, `$match`,
`$fromConfig`, `$toConfig` (Data.`taggedEnum`-shaped; ctors take the payload).
