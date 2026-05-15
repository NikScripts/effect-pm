/**
 * Composed {@link Effect} programs — parallel batches callers use often. Require {@link NwslsoccerClient}.
 */
import { Effect } from "effect";
import { NWSL_SDP_DEFAULT_LOCALE } from "./constants";
import { NwslsoccerClient } from "./client";
import {
  LocaleQuery,
  SeasonAndLocaleQuery,
  SeasonIdPath,
  SeasonMatchIdPath,
  SeasonTeamIdPath,
  TeamIdPath,
} from "./schemas";

/** Schedule + team list for a season (two GETs in parallel). */
export const fetchSeasonScheduleAndTeams = (seasonId: string) =>
  Effect.gen(function* () {
    const client = yield* NwslsoccerClient;
    const params = new SeasonIdPath({ seasonId });
    const query = new LocaleQuery({ locale: NWSL_SDP_DEFAULT_LOCALE });
    return yield* Effect.all(
      [client.season.getSeasonMatches({ params, query }), client.season.getSeasonTeams({ params, query })],
      { concurrency: "unbounded" },
    );
  });

/** Match facts + preview (two GETs in parallel). */
export const fetchMatchDetailBundle = (seasonId: string, matchId: string) =>
  Effect.gen(function* () {
    const client = yield* NwslsoccerClient;
    const params = new SeasonMatchIdPath({ seasonId, matchId });
    const query = new LocaleQuery({ locale: NWSL_SDP_DEFAULT_LOCALE });
    return yield* Effect.all(
      [client.season.getMatchFacts({ params, query }), client.season.getMatchPreview({ params, query })],
      { concurrency: "unbounded" },
    );
  });

/** Team season stats + roster (two GETs in parallel). */
export const fetchTeamSeasonBundle = (seasonId: string, teamId: string) =>
  Effect.gen(function* () {
    const client = yield* NwslsoccerClient;
    return yield* Effect.all(
      [
        client.team.getTeamSeasonStats({
          params: new SeasonTeamIdPath({ seasonId, teamId }),
          query: new LocaleQuery({ locale: NWSL_SDP_DEFAULT_LOCALE }),
        }),
        client.team.getTeamRoster({
          params: new TeamIdPath({ teamId }),
          query: new SeasonAndLocaleQuery({ locale: NWSL_SDP_DEFAULT_LOCALE, seasonId }),
        }),
      ],
      { concurrency: "unbounded" },
    );
  });
