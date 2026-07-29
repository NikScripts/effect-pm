/**
 * @module examples/gate/http-client
 *
 * HttpClientGate on a fetch client. Run: `pnpm run example:http-client-gate`
 *
 * Docs: `docs/examples/gate/http-client.md` includes this file;
 * cut markers hide the module header and demo harness.
 */

import { runNodeProgramWithLayer } from "../shared/demo-harness";

// ---cut---
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { Clock, Effect, Layer } from "effect";
import { HttpClientGate, Gate } from "../../src";

const DemoHttpRunner = Gate.makeRunner({
  name: "examples/DemoHttpRunner",
  concurrency: 2,
});

const program = Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient;
  const runner = yield* DemoHttpRunner;
  // Same gate pattern as Gate.httpApiClient limits — applied at HttpClient level.
  const client = HttpClientGate.transformClient(base, runner);

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
// ---cut-after---

runNodeProgramWithLayer(program, mainLayer, "form:http-client-gate finished OK");
