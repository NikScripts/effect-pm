---
"@nikscripts/effect-pm": patch
---

HttpApiResource endpoint usage metrics: `httpapi_endpoint_requests_total` (with `outcome`), `httpapi_endpoint_errors_total` (with `error` tag), `httpapi_endpoint_duration_ms`, and `{group}.{endpoint}` client spans. `layerEffect` accepts optional `api` for the same instrumentation on custom builders.
