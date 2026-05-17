/**
 * @module @services/api/nwslsoccer
 *
 * NWSL public SDP HTTP API (`api-sdp.nwslsoccer.com`). **sourceId:** `nwslsoccer`.
 *
 * - {@link NwslsoccerApi} — `HttpApi` with `season`, `team`, `player` groups (Clockify-style).
 * - {@link NwslsoccerClient} — `HttpApiClient` tag; use {@link NwslsoccerClient.layerNode} on Node.
 * - `programs` — composed `Effect` helpers for common parallel fetches.
 *
 * Route reference: [ENDPOINTS.md](./ENDPOINTS.md).
 */

export { NwslsoccerApi } from "./api";
export { NwslSdpSeasonGroup } from "./season-group";
export { NwslSdpTeamGroup } from "./team-group";
export { NwslSdpPlayerGroup } from "./player-group";
export * from "./schemas";
export { NwslsoccerClient } from "./client";
export * from "./constants";
export { NwslSoccerApiBaseUrl } from "./config";
export * from "./programs";
