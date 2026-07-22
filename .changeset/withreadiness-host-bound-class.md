---
"hyperlink-ts": patch
---

**`Resource.withReadiness` data-first now accepts a host-bound *class*** (a `typeof X` constructor), via inferred overloads (host-bound first, then hostless) — the same way `client`/`layer` accept a class — with the host preserved in the return. (beta.14 accepted host-bound tag *values*; a fully-defined class didn't typecheck.) The implementation keeps resource group types fully precise (`RpcGroupOf<S>`) — no `groupSym` erasure, no cast.
