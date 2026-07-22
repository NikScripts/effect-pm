---
"hyperlink-ts": minor
---

Ship **`@nikscripts/effect-pm/cli`** — build a run-and-exit CLI from your resource `Tag`s, the CLI counterpart to `@nikscripts/effect-pm/web`. `makeResourceCli(resources, rootName)` turns a `{ commandName: tag }` record into an `effect/unstable/cli` command tree: each resource is a subcommand namespace, each contract query/mutate method a verb with flags derived from its payload schema and help from `methodMeta` (streams are skipped — use their one-shot peers); a `<root> ls` lists the resources. `resourcesByName(tags)` names a tag list by the shortest unique slash-suffix (`@acme/Mail` → `Mail`; only collisions lengthen). Location-transparent — provide a local layer or a `Resource.client` transport, same tree. Light: only depends on `effect`'s built-in cli. (Promoted from the examples; the `pm` example now consumes it.)
