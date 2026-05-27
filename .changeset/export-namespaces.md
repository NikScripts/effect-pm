---
"@nikscripts/effect-pm": minor
---

Organize public exports into namespace objects while keeping short root import aliases.

Add `Query`, `ResourceConfigure`, `DisarmedIdleSleep`, and `Cli` namespaces (and additional domain namespaces in follow-up commits) so APIs are easier to browse. Root exports such as `And`, `configureLayer`, `createCli`, and `Endpoint` remain available as the same bindings as their namespace members.
