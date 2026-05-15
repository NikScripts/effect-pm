/**
 * Player-scoped SDP routes.
 */
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { NWSL_SDP_FOOTBALL_PATH_PREFIX } from "./constants";
import { NwslPlayerProfileResponse, PlayerIdPath, SeasonAndLocaleQuery } from "./schemas";

const p = NWSL_SDP_FOOTBALL_PATH_PREFIX;

export const NwslSdpPlayerGroup = HttpApiGroup.make("player").add(
  HttpApiEndpoint.get("getPlayerProfile", `${p}/players/:playerId/profile`, {
    params: PlayerIdPath,
    query: SeasonAndLocaleQuery,
    success: NwslPlayerProfileResponse,
  }),
);
