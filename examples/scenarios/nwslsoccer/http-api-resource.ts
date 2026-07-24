/**
 * NWSL SDP client via {@link Gate.httpApiClient} (same API as {@link NwslsoccerClient}, plus optional `limits`).
 *
 * Compare `client.ts`: that uses `Context.Tag` + `HttpApiClient.make`. Here the factory returns a
 * **tag + `layer`** from this package — concurrency / throttle apply on the transport like
 * `Gate` + `HttpClientGate`.
 *
 * Run (from repo root):
 *   `npm run example:nwsl-http-api-resource`
 *
 * Requires this `examples/nwslsoccer` tree (same as the hand-rolled client). Uses
 * `NWSL_SOCCER_API_BASE_URL` (optional; default `https://api-sdp.nwslsoccer.com`) and optional
 * `NWSL_SDP_SEASON_ID` (see `test/client.live.test.ts` for a default season id).
 *
 * This script uses `responseMode: "response-only"` and parses JSON by hand so it keeps working if
 * the live API drifts ahead of the checked-in `NwslMatchesResponse` schema. For decoded domain
 * types, omit `responseMode` once schemas match the API.
 */

import { FetchHttpClient } from "effect/unstable/http";
import { ConfigProvider, Effect, Layer } from "effect";
import { Gate } from "../../../src";
import { NwslsoccerApi } from "./api";
import { NWSL_SDP_DEFAULT_LOCALE } from "./constants";
import { NwslSoccerApiBaseUrl } from "./config";
import { LocaleQuery, SeasonIdPath } from "./schemas";

const DEFAULT_SEASON =
  process.env.NWSL_SDP_SEASON_ID ??
  "nwsl::Football_Season::0b6761e4701749f593690c0f338da74c";

const program = Effect.gen(function* () {
  const baseUrl = yield* NwslSoccerApiBaseUrl;
  const NwslTag = Gate.httpApiClient(NwslsoccerApi, {
    name: "examples/nwslsoccer/NwslHttpApiClient",
    client: {
      baseUrl,
      transformClient: Gate.acceptJson,
    },
    limits: { concurrency: 2 },
  });
  yield* Effect.gen(function* () {
    const client = yield* NwslTag;
    const res = yield* client.season.getSeasonMatches({
      params: new SeasonIdPath({ seasonId: DEFAULT_SEASON }),
      query: new LocaleQuery({ locale: NWSL_SDP_DEFAULT_LOCALE }),
      responseMode: "response-only",
    });
    const text = yield* res.text;
    const parsed = JSON.parse(text) as {
      readonly competition?: { readonly seasonId?: string };
      readonly matches?: readonly unknown[];
    };
    yield* Effect.log(
      `HTTP ${res.status} — season ${parsed.competition?.seasonId ?? "?"}: ${
        Array.isArray(parsed.matches) ? parsed.matches.length : "?"
      } matches`,
    );
  }).pipe(Effect.provide(Layer.mergeAll(NwslTag.layer, FetchHttpClient.layer)));
}).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv())));

Effect.runPromise(program).then(
  () => console.log("example:nwsl-http-api-resource finished OK"),
  (e) => {
    console.error(e);
    process.exitCode = 1;
  },
);
