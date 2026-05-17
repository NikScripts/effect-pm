/**
 * Opt-in live call to NWSL SDP (network). Run:
 *   NWSL_SDP_LIVE=1 pnpm --filter @services/api test:run
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { NWSL_SDP_DEFAULT_LOCALE } from "../constants";
import { NwslsoccerClient } from "../client";
import { LocaleQuery, SeasonIdPath } from "../schemas";

const DEFAULT_SEASON = "nwsl::Football_Season::0b6761e4701749f593690c0f338da74c";

describe.skipIf(!process.env.NWSL_SDP_LIVE)("NWSL SDP live (NWSL_SDP_LIVE=1)", () => {
  it("getSeasonMatches returns competition and matches", async () => {
    const seasonId = process.env.NWSL_SDP_SEASON_ID ?? DEFAULT_SEASON;

    const res = await Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* NwslsoccerClient;
        return yield* client.season.getSeasonMatches({
          params: new SeasonIdPath({ seasonId }),
          query: new LocaleQuery({ locale: NWSL_SDP_DEFAULT_LOCALE }),
        });
      }).pipe(Effect.provide(NwslsoccerClient.layerNode)),
    );

    expect(res.competition.seasonId).toBeTruthy();
    expect(Array.isArray(res.matches)).toBe(true);
    expect(res.matches.length).toBeGreaterThan(0);
  });
});
