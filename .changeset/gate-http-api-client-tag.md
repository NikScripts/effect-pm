---
"hyperlink-ts": minor
---

`Gate.HttpApiClient` Hyperlink Tag + app-owned `Gate.httpApiClientLayer` — local HttpApi routes with a `metrics` nest (limiter fields + absorbed usage `usage`/`windows`). Opt-in `adaptive: true | { key? }` (requires `rateLimit`) wires Effect `adaptiveConsume` / `adaptiveFeedback` on upstream 429 + Retry-After. Sibling `ApiMetrics` is deprecated; prefer the nest. Legacy `httpApiClient` / `httpApiClientService` / `httpApiClientLayerEffect` remain for migration. `httpApiClientLayer` now means the Tag layer (was `layerEffect`).
