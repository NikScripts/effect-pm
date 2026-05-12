/**
 * @module examples/http-client-run-gate
 *
 * ## Gate a raw **`HttpClient`** pipeline (not HttpApi-specific)
 *
 * Shows the same pattern as wrapping **`HttpApiClient.make(..., { transformClient })`**, but at the
 * lower **`HttpClient`** level using **`HttpClientRunGate.transformClient`**.
 *
 * ### Mental model
 *
 * 1. Build a **`RunResource.makeRunner`** — reusable throttle + concurrency “runner”.
 * 2. Acquire the platform client (`yield* HttpClient.HttpClient` with `FetchHttpClient.layer` provided).
 * 3. **`HttpClientRunGate.transformClient(base, runner)`** returns a client whose `execute` path is gated.
 *
 * ### Run
 *
 * ```bash
 * pnpm run example:http-client-run-gate
 * ```
 *
 * ### Pattern snippet (copy into your app)
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
import { Clock, Effect } from "effect";
import { HttpClientRunGate, RunResource } from "../src";
import { provideLayer } from "../src/provideLayer.js";

const DemoHttpRunner = RunResource.makeRunner({
  name: "examples/DemoHttpRunner",
  concurrency: 2,
});

const program = Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient;
  const runner = yield* DemoHttpRunner;
  const client = HttpClientRunGate.transformClient(base, runner);

  yield* Effect.log("10 parallel GETs through the run gate…");
  const t0 = yield* Clock.currentTimeMillis;
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
  const t1 = yield* Clock.currentTimeMillis;
  yield* Effect.log(`All done in ${t1 - t0}ms`);
});

void Effect.runPromise(
  program.pipe(
    provideLayer(DemoHttpRunner.layer),
    provideLayer(FetchHttpClient.layer),
    Effect.tap(() => Effect.logInfo("example:http-client-run-gate finished OK")),
  ),
);
