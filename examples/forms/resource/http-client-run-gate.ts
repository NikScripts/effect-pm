/**
 * @module examples/forms/resource/http-client-run-gate
 *
 * HttpClientRunGate on a fetch client. Run: `pnpm run example:http-client-run-gate`
 */

import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { Clock, Effect } from "effect";
import { HttpClientRunGate, RunResource } from "../../../src";
import { provideLayer } from "../../../src/provideLayer";

const DemoHttpRunner = RunResource.makeRunner({
  name: "examples/DemoHttpRunner",
  concurrency: 2,
});

const program = Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient;
  const runner = yield* DemoHttpRunner;
  // Same gate pattern as HttpApiResource limits — applied at HttpClient level.
  const client = HttpClientRunGate.transformClient(base, runner);

  yield* Effect.log("10 parallel GETs through the run gate…");
  const t0 = yield* Clock.currentTimeMillis;
  yield* Effect.all(
    Array.from({ length: 10 }, (_, i) =>
      client.execute(
        HttpClientRequest.get(
          `https://jsonplaceholder.typicode.com/posts/${(i % 5) + 1}`,
        ),
      ),
    ),
    { concurrency: "unbounded" },
  );
  const t1 = yield* Clock.currentTimeMillis;
  yield* Effect.log(`All done in ${t1 - t0}ms`);
});

void Effect.runPromise(
  program.pipe(
    provideLayer(DemoHttpRunner.layer),
    provideLayer(FetchHttpClient.layer),
    Effect.tap(() => Effect.logInfo("form:http-client-run-gate finished OK")),
  ),
);
