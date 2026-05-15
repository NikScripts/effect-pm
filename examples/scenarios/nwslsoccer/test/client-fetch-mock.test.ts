/**
 * Integration tests: stub `globalThis.fetch` and run {@link NwslsoccerClient.layerFetch}.
 * (`layerNode` uses Node's HTTP client, not `fetch`, so mocks must use this layer.)
 * Kept in one file so Vitest workers do not clobber `fetch`.
 */
import { ConfigProvider, Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NwslsoccerClient } from "../client";
import { NWSL_SDP_DEFAULT_LOCALE } from "../constants";
import {
  LocaleQuery,
  PlayerIdPath,
  SeasonAndLocaleQuery,
  SeasonIdPath,
  SeasonMatchIdPath,
  SeasonTeamIdPath,
  TeamIdPath,
} from "../schemas";
import { provideLayer } from "../../../../src/provideLayer";
import {
  fetchMatchDetailBundle,
  fetchSeasonScheduleAndTeams,
  fetchTeamSeasonBundle,
} from "../programs";
import matchFactsMin from "./fixtures/match-facts.min.json";
import matchPreviewMin from "./fixtures/match-preview.min.json";
import matchesMin from "./fixtures/matches.min.json";
import playerProfileMin from "./fixtures/player-profile.min.json";
import rosterMin from "./fixtures/roster.min.json";
import teamStatsMin from "./fixtures/team-stats.min.json";
import teamsMin from "./fixtures/teams.min.json";
import { createNwslSdpFetchMock } from "./nwslsdp-fetch-mock";

const MOCK_BASE = "http://nwsl-mock.test";

const fixtures = {
  matches: matchesMin,
  teams: teamsMin,
  matchFacts: matchFactsMin,
  matchPreview: matchPreviewMin,
  teamStats: teamStatsMin,
  roster: rosterMin,
  playerProfile: playerProfileMin,
};

beforeAll(() => {
  vi.stubGlobal("fetch", createNwslSdpFetchMock(fixtures));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const run = <A, E>(
  effect: Effect.Effect<A, E, NwslsoccerClient>,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      provideLayer(NwslsoccerClient.layerFetch),
      provideLayer(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ NWSL_SOCCER_API_BASE_URL: MOCK_BASE }),
        ),
      ),
    ),
  );

describe("NwslsoccerClient (fetch mock + layerFetch)", () => {
  const seasonId = "nwsl::Football_Season::test";
  const matchId = "nwsl::Football_Match::m1";
  const teamId = "nwsl::Football_Team::t1";
  const playerId = "nwsl::Football_Player::p1";
  const localeQ = new LocaleQuery({ locale: NWSL_SDP_DEFAULT_LOCALE });

  it("getSeasonMatches", async () => {
    const res = await run(
      Effect.gen(function* () {
        const client = yield* NwslsoccerClient;
        return yield* client.season.getSeasonMatches({
          params: new SeasonIdPath({ seasonId }),
          query: localeQ,
        });
      }),
    );
    expect(res.matches[0]!.matchId).toBe(matchId);
  });

  it("getSeasonTeams", async () => {
    const res = await run(
      Effect.gen(function* () {
        const client = yield* NwslsoccerClient;
        return yield* client.season.getSeasonTeams({
          params: new SeasonIdPath({ seasonId }),
          query: localeQ,
        });
      }),
    );
    expect(res.teams[0]!.teamId).toBe(teamId);
  });

  it("getMatchFacts", async () => {
    const res = await run(
      Effect.gen(function* () {
        const client = yield* NwslsoccerClient;
        return yield* client.season.getMatchFacts({
          params: new SeasonMatchIdPath({ seasonId, matchId }),
          query: localeQ,
        });
      }),
    );
    expect(res.matchId).toBe(matchId);
  });

  it("getMatchPreview", async () => {
    const res = await run(
      Effect.gen(function* () {
        const client = yield* NwslsoccerClient;
        return yield* client.season.getMatchPreview({
          params: new SeasonMatchIdPath({ seasonId, matchId }),
          query: localeQ,
        });
      }),
    );
    expect(res.phase).toBe("PRE_MATCH");
  });

  it("getTeamSeasonStats", async () => {
    const res = await run(
      Effect.gen(function* () {
        const client = yield* NwslsoccerClient;
        return yield* client.team.getTeamSeasonStats({
          params: new SeasonTeamIdPath({ seasonId, teamId }),
          query: localeQ,
        });
      }),
    );
    expect(res.team.stats?.[0]?.statsLabel).toBe("Goals");
  });

  it("getTeamRoster", async () => {
    const res = await run(
      Effect.gen(function* () {
        const client = yield* NwslsoccerClient;
        return yield* client.team.getTeamRoster({
          params: new TeamIdPath({ teamId }),
          query: new SeasonAndLocaleQuery({ locale: NWSL_SDP_DEFAULT_LOCALE, seasonId }),
        });
      }),
    );
    expect(res.team.officialName).toBe("Test FC");
  });

  it("getPlayerProfile", async () => {
    const res = await run(
      Effect.gen(function* () {
        const client = yield* NwslsoccerClient;
        return yield* client.player.getPlayerProfile({
          params: new PlayerIdPath({ playerId }),
          query: new SeasonAndLocaleQuery({ locale: NWSL_SDP_DEFAULT_LOCALE, seasonId }),
        });
      }),
    );
    expect(res.nationality).toBe("USA");
  });
});

describe("nwslsoccer programs (fetch mock + layerFetch)", () => {
  const seasonId = "nwsl::Football_Season::test";
  const matchId = "nwsl::Football_Match::m1";
  const teamId = "nwsl::Football_Team::t1";

  it("fetchSeasonScheduleAndTeams", async () => {
    const [matches, teams] = await run(fetchSeasonScheduleAndTeams(seasonId));
    expect(matches.matches[0]!.matchId).toBe(matchId);
    expect(teams.teams[0]!.teamId).toBe(teamId);
  });

  it("fetchMatchDetailBundle", async () => {
    const [facts, preview] = await run(fetchMatchDetailBundle(seasonId, matchId));
    expect(facts.matchId).toBe(matchId);
    expect(preview.matchId).toBe(matchId);
  });

  it("fetchTeamSeasonBundle", async () => {
    const [stats, roster] = await run(fetchTeamSeasonBundle(seasonId, teamId));
    expect(stats.team.teamId).toBe(teamId);
    expect(roster.players).toHaveLength(1);
  });
});
