---
"@nikscripts/effect-pm": minor
---

Add the public `State` scope factory for telemetry state.

- `State.Scope<Self>()` creates root scope services with `Leaf`, `State`, `Schema.Leaf`, `Schema.State`, `layer`, `provide`, and `run`
- `Scope.withLeaf<Self>()` creates child scopes that provide only the current leaf and assemble nested state from parent scope services
