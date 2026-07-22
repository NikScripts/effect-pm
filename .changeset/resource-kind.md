---
"hyperlink-ts": minor
---

**Tags now carry their contract kind.** Each contract's `.Tag` factory stamps a canonical `kind` id on the tag (e.g. `@nikscripts/effect-pm/QueueResource`), read with **`Resource.kindOf(tag)`** — so consumers (notably the web/TUI dashboards) can classify a tag by what it *is*, instead of sniffing its spec members (which mis-classified `ApiMetrics` as a process and broke custom-queue / process-schedule tags).

- New: `Resource.kindOf(tag)` (accepts `unknown`; returns the kind id or `undefined` for a bare `Resource.Tag`) and the internal `kindSym`; `makeTag` / `tagFor` accept a `kind` option.
- Each contract exports its `kind`: `QueueResource.kind`, `ScheduledProcess.kind`, `ApiMetrics.kind`, `CustomQueueResource.kind`, `ProcessScheduleResource.kind`.
- `@nikscripts/effect-pm/web` `kindOf` now prefers the stamped kind, falling back to spec-sniffing only for un-stamped tags.
