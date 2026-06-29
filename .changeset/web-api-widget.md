---
"@nikscripts/effect-pm": minor
---

`@nikscripts/effect-pm/web`: **API-resource dashboard widget** for `ApiMetrics` taps. A new read-only per-type widget — `ApiCard` (a reusable iOS-style **`PagedCard`**: page 1 throughput sparkline + error-rate health badge, page 2 busiest-endpoint bars), `ApiStats`, `ApiMetricChart` (throughput / errors / in-flight), and `ApiEndpointTable` (per-endpoint requests / errors / avg-ms). The dashboard classifies `ApiMetrics` leaves via the new stamped kind (`Resource.kindOf`), renders an `ApiDetail` (stats + chart + endpoints, no controls/logs), and exposes `apiBundle` / `useApiBundle`. The `resource-web` example gains a mocked `ScoresApi` leaf.
