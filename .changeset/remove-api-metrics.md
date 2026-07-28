---
"hyperlink-ts": major
---

Remove the deprecated sibling `ApiMetrics` module and `hyperlink-ts/ApiMetrics` export subpath. Outbound API usage + rate-limit observation lives on `Gate.HttpApiClient`'s `metrics` nest (`usage` / `windows` / `remaining` / `resetAfter` / `exceeded`). Dashboard and TUI API widgets now surface the limiter nest fields alongside usage.
