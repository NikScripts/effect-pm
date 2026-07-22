---
"hyperlink-ts": minor
---

Rename the toolkit process tag `ProcessResource` → **`ScheduledProcess`** (namespace + the
`@nikscripts/effect-pm/ProcessContract` subpath → `@nikscripts/effect-pm/ScheduledProcess`). The
surface is unchanged — it's a process with lifecycle (`start`/`stop`/`runImmediately`),
observability (`status`/`logs`/`logHistory`), and schedule control. The name now reflects what it
is: a *scheduled process*, distinct from a plain schedule. (`Process` remains the lower-level
engine.) Migration: `ProcessResource.Tag`/`layer`/`server`/`serveHttp` → `ScheduledProcess.*`.
