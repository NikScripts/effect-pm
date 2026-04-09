/**
 * HttpClient + RunResource (same idea as gating HttpApiClient)
 *
 * Run: `npm run example:http-client-run-gate`
 *
 * `HttpApiClient.make` accepts `transformClient`. After you `yield* YourRunner` inside
 * the same `Effect.gen` that builds the client, pipe the platform client:
 *
 * ```typescript
 * const _make = Effect.gen(function* () {
 *   const baseUrl = yield* NwslSoccerApiBaseUrl;
 *   const runner = yield* NwslHttpRunner;
 *   return yield* HttpApiClient.make(NwslsoccerApi, {
 *     baseUrl,
 *     transformClient: (client) =>
 *       client.pipe(
 *         HttpClient.mapRequest(HttpClientRequest.setHeader("Accept", "application/json")),
 *         HttpClientRunGate.withRunner(runner),
 *       ),
 *   });
 * });
 *
 * static readonly layer = Layer.provideMerge(
 *   Layer.effect(NwslsoccerClient, _make),
 *   NwslHttpRunner.layer,
 * );
 * ```
 */

import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { Duration, Effect } from "effect";
import { HttpClientRunGate, RunResource } from "../src";

const DemoHttpRunner = RunResource.makeRunner({
  name: "examples/DemoHttpRunner",
  limits: {
    throttle: { limit: 8, duration: Duration.seconds(1) },
    concurrency: 2,
  },
});

const program = Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient;
  const runner = yield* DemoHttpRunner;
  const client = HttpClientRunGate.transformClient(base, runner);

  yield* Effect.log("10 parallel GETs through the run gate…");
  const t0 = Date.now();
  yield* Effect.all(
    Array.from({ length: 10 }, (_, i) =>
      client.execute(
        HttpClientRequest.get(
          `https://jsonplaceholder.typicode.com/posts/${(i % 5) + 1}`
        )
      )
    ),
    { concurrency: "unbounded" }
  );
  yield* Effect.log(`All done in ${Date.now() - t0}ms`);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(DemoHttpRunner.layer),
    Effect.provide(FetchHttpClient.layer),
  )
).then(
  () => console.log("example:http-client-run-gate finished OK"),
  (e) => {
    console.error(e);
    process.exitCode = 1;
  }
);
