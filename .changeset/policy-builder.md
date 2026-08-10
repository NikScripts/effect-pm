---
"hyperlink-ts": minor
---

`PolicyBuilder` is Schema-first and HttpApi-shaped: declare keys with
`.key(name, schema, { defaultValue, toRuntime? })`, `class extends` the family, then
recreate module helpers (`sticky`, …) and re-export `Family.references`. Eng’d `Policy`
uses that split; public fragment / `make` / `provide` DX unchanged.
