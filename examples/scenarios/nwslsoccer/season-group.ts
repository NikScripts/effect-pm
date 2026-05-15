/**
 * Season-scoped SDP routes: schedule, team list, per-match enrichment.
 */
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { NWSL_SDP_FOOTBALL_PATH_PREFIX } from "./constants";
import {
  LocaleQuery,
  NwslMatchFactsResponse,
  NwslMatchPreviewResponse,
  NwslMatchesResponse,
  NwslTeamsResponse,
  SeasonIdPath,
  SeasonMatchIdPath,
} from "./schemas";

const p = NWSL_SDP_FOOTBALL_PATH_PREFIX;

export const NwslSdpSeasonGroup = HttpApiGroup.make("season")
  .add(
    HttpApiEndpoint.get("getSeasonMatches", `${p}/seasons/:seasonId/matches`, {
      params: SeasonIdPath,
      query: LocaleQuery,
      success: NwslMatchesResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getSeasonTeams", `${p}/seasons/:seasonId/teams`, {
      params: SeasonIdPath,
      query: LocaleQuery,
      success: NwslTeamsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getMatchFacts", `${p}/seasons/:seasonId/match/:matchId/matchfacts`, {
      params: SeasonMatchIdPath,
      query: LocaleQuery,
      success: NwslMatchFactsResponse,
    }),
  )
  .add(
    HttpApiEndpoint.get("getMatchPreview", `${p}/seasons/:seasonId/match/:matchId/matchPreview`, {
      params: SeasonMatchIdPath,
      query: LocaleQuery,
      success: NwslMatchPreviewResponse,
    }),
  );
