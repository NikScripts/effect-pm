---
"@nikscripts/effect-pm": minor
---

Add `HttpApiResource.layerEffect` for applying effect-pm transport limits to an existing `Context.Service` HTTP API client effect.

Also export the helper from the package root, expose it on `Resource`, and add a runnable example showing how to preserve a singleton gated client across `layerCapture` / `layer` resource variants.
