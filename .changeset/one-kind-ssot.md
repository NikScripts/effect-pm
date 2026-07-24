---
"hyperlink-ts": minor
---

**BREAKING — one kind per resource (SSOT). The short `"queue"`/`"process"` discriminator is gone.**

A resource's kind was stored twice: the module's stamped `kind` (`"hyperlink-ts/WorkPool"`,
`"hyperlink-ts/Daemon"`, …) and a second short discriminator (`"queue"`/`"process"`) on definitions,
the process-manager routing, and the dashboard guards. There is now a single source of truth — the
stamped `kind` — and everything derives from it.

Migration:

- `DaemonDefinition.kind` is now `"hyperlink-ts/Daemon"` (was `"process"`); the WorkPool definition's
  `kind` is `"hyperlink-ts/WorkPool"` (was `"queue"`). Compare against `Daemon.kind` / `WorkPool.kind`
  (or `Hyperlink.kindOf(tag)`), never the string `"process"`/`"queue"`.
- The dashboard's `kindOf` (in the `web` data layer) — which mapped a stamped kind to a short
  `"queue" | "process" | "api" | "hyperlink"` string — is **removed**. Use the exported guards
  `isQueueTag` / `isDaemonTag` / `isApiTag` (each now compares the stamped kind directly), or
  `Hyperlink.kindOf(tag) === <Module>.kind`.

Internal only (no public change): the `*Hyperlink`-suffixed engine files/types were renamed to match
the public kinds (`queueHyperlink`→`workPool`, `runHyperlink`→`gate`, `HttpApiHyperlink`→`HttpApiClient`,
`CustomQueueHyperlink`→`WorkPoolPriority`), and the Daemon kind's internal machinery moved off `process*`
to `daemon*` (OS-process domain vocabulary untouched). `WorkPool.kind` now lives in a leaf module
(`internal/workPoolKind`) so the light `WorkPool.Tag` path and the engine share the one value without
the Tag path pulling the engine.
