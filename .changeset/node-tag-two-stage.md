---
"@nikscripts/effect-pm": minor
---

`Node.Tag` and `Node.Lookup` are now two-stage, matching `Resource.Tag` / `Context.Service`
(breaking): `class X extends Node.Tag<X>()("name", target) {}` — note the `()`. Address
narrowing by target shape is unchanged; the overload ladder simply moved inside the curried
factory. This also removes the last `missingEffectContext` false positives (overloaded generic
factories returning ServiceClass values relate each overload's own `Self`).
