/**
 * @module examples/forms/resource/http-client-gate
 *
 * HttpClientRunGate on a fetch client. Run: `pnpm run example:http-client-gate`
 */

import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { Clock, Effect, Layer } from "effect";
import { HttpClientRunGate, Gate } from "../../../src";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

const DemoHttpRunner = Gate.makeRunner({
  name: "examples/DemoHttpRunner",
  concurrency: 2,
});

const program = Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient;
  const runner = yield* DemoHttpRunner;
  // Same gate pattern as Gate.httpApiClient limits — applied at HttpClient level.
  const client = HttpClientRunGate.transformClient(base, runner);

  yield* Effect.log("10 parallel GETs through the gate…");
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

const mainLayer = Layer.mergeAll(DemoHttpRunner.layer, FetchHttpClient.layer);

runNodeProgramWithLayer(program, mainLayer, "form:http-client-gate finished OK");
