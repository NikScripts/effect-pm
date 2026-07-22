---
"hyperlink-ts": minor
---

**Host status — every served host auto-exposes its status + logs.** New `@nikscripts/effect-pm/HostStatus`: a reserved, hostless resource (`status` stream, `statusNow`, `ping`, `logs` stream, `logHistory`) that `Resource.serveAllHttp` now serves automatically alongside your resources — the host author wires nothing. Query any host by pointing a transport at its `/rpc`: `HostStatus.clientHttp(url)` (or any `RpcClient.Protocol` for `Resource.client(HostStatus.Tag)`). Status reports `{ up, startedAt, uptimeMillis, resourceCount }`; logs/history come from the runtime-wide `HostLogs` relay when provided (empty otherwise). This is the server foundation for the dashboard's hosts view.
