---
"@nikscripts/effect-pm": minor
---

**`MissingClientProtocol`:** nodeless `Resource.client(tag)` / `clientInstances` fail with a tagged remediation error when ambient `RpcClient.Protocol` is absent (replaces Effect’s opaque “Service not found” die). Layer types unchanged (`E` stays `never`; `R` still requires Protocol).
