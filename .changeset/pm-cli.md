---
"hyperlink-ts": patch
---

Examples: a unified **`pm`** entrypoint that drives the same `Fleet` tags two ways — no subcommand launches the styled Ink dashboard; a subcommand runs a single command and exits (`pm Mail statusNow`, `pm Mail pause`, `pm KeyRotation start`, `pm ls`), over http via the shared data layer. Resource command names are the tag's display name, lengthened to the shortest unique slash-suffix only when two collide.

Hardens the `makeResourceCli` example builder: an `ls` subcommand, stream/local methods filtered out by a precise contract guard (only wire query/mutate verbs become commands), and defensive flag derivation that skips `optionalKey`/date/duration fields and whole-`Schema` payloads instead of throwing.
