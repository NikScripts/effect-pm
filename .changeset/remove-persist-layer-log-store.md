---
"hyperlink-ts": minor
---

**Remove interim log sink:** delete `Logs.persistLayer`, `@nikscripts/effect-pm/store/Log` (`LogStore`), and `storeFollower`. Durable logs are only registration followers (`Node.logs` / toolkit `*.store` on `Store.Service` → `handle.log.append` / `log.read`). `Logs.byNode` / `byResource` / `NodeStatus.logs.query` read Storage only.
