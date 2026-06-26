---
"@nikscripts/effect-pm": minor
---

Add **`Resource.serveAllHttp`** — serve many resources on **one** HTTP `RpcServer`/port (the
multi-resource counterpart to `serveHttp`). Each resource's procedures are group-id-prefixed, so
they coexist on the one `/rpc` endpoint without collision; clients reach each via `Resource.client`
over a single `connectHttp(Host)` transport. This is how a whole group (e.g. a deployable league)
runs behind one port.

Plus **`QueueResource.serverEntry`** / **`ScheduledProcess.serverEntry`** — produce the
`ServeEntry` (tag + lazily-built engine impl, carrying its worker requirement `R`) so queues and
processes compose into one `serveAllHttp` call. Exposes the `ServeEntry` type from the barrel.
