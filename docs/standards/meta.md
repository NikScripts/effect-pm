{#meta title="Authoring A Standards Chapter" appliesTo=standards}
# Authoring A Standards Chapter

{.note}
**Draft template.** The authoring format may still change — treat as a working draft, not a locked spec.

This is the format for the standards corpus. Each chapter is one `.md` file in
`docs/standards/`, authored in **Djot**. The doc server (`pnpm run docs:serve`)
renders it and derives the rule manifest automatically — add a file, refresh, it
appears in the nav.

## The shape

A chapter has a **page block** on its first line, then one `##` **section per
rule**, each preceded by its own attribute line:

```
{#module-layout title="Module layout" appliesTo=src}
# Module layout

Intro prose — plain Djot.

{#public-barrel .must appliesTo=src}
## Public surface goes through the barrel

The rule, stated as an imperative. Show good/bad with a fenced block:

``` ts
// ✅ good
import { Queue } from "@nikscripts/effect-pm"
// ❌ bad — reaches past the barrel
import { Queue } from "@nikscripts/effect-pm/internal/QueueImpl"
```
```

- **Page block** `{#chapter-id title="…" appliesTo=…}` sits above the `# H1`.
- **Rule** = an `##` section with `{#rule-id .severity appliesTo=…}` on the line
  directly above it. `severity` is one of `must`, `should`, `may`.
- **Callout**: `{.note}` on the line above a paragraph.

## Rules for ids

{#dotless-ids .must appliesTo=standards}
## Rule ids must be dotless

The build composes the qualified id as `chapter-id.rule-id`, so a `.` inside an
id breaks parsing. Use hyphens: `public-barrel`, not `public.barrel`.

{#attr-own-line .must appliesTo=standards}
## Attribute blocks go on their own line

`{#id .must}` must be on the line *above* the `##` heading, never inline on the
heading text — inline attributes are ignored.

{.note}
You never edit a manifest — it's derived from these `{#id .severity}` blocks at
build time, so it can't drift from the prose. Agent C audits against it.
