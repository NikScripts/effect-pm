/**
 * Team-scoped SDP routes: season stats and roster for a club.
 */
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { NWSL_SDP_FOOTBALL_PATH_PREFIX } from "./constants";
import {
  LocaleQuery,
  NwslRosterResponse,
  NwslTeamStatsResponse,
  SeasonAndLocaleQuery,
  SeasonTeamIdPath,
  TeamIdPath,
} from "./schemas";

const p = NWSL_SDP_FOOTBALL_PATH_PREFIX;

export const NwslSdpTeamGroup = HttpApiGroup.make("team")
  .add(
    HttpApiEndpoint.get("getTeamSeasonStats", `${p}/seasons/:seasonId/stats/teams/:teamId`, {
      params: SeasonTeamIdPath,
      query: LocaleQuery,
      success: NwslTeamStatsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getTeamRoster", `${p}/teams/:teamId/roster`, {
      params: TeamIdPath,
      query: SeasonAndLocaleQuery,
      success: NwslRosterResponse,
    }),
  );
