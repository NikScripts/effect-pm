---
"hyperlink-ts": minor
---

`Gate.HttpApiClient` Hyperlink Tag + app-owned `Gate.httpApiClientLayer` — local HttpApi routes with a `metrics` nest (limiter fields + absorbed usage `usage`/`windows`). Sibling `ApiMetrics` is deprecated; prefer the nest. Legacy `httpApiClient` / `httpApiClientService` / `httpApiClientLayerEffect` remain for migration. `httpApiClientLayer` now means the Tag layer (was `layerEffect`).
