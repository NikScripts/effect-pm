/**
 * @module examples/forms/resource/gate-http-api-client
 *
 * Gate.httpApiClientService + ApiMetrics — class client and observability tag.
 * Run: `pnpm run example:gate-http-api-client`
 */

import { FetchHttpClient } from "effect/unstable/http";
import { Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as ApiMetrics from "../../../src/ApiMetrics";
import * as Gate from "../../../src/Gate";
import { runNodeProgramOrExit } from "../../shared/demo-harness";

const DemoClientId = "examples/jsonplaceholder/DemoApiClient" as const;

const Post = Schema.Struct({
  userId: Schema.Number,
  id: Schema.Number,
  title: Schema.String,
  body: Schema.String,
});

const DemoApi = HttpApi.make("jsonplaceholder-demo").add(
  HttpApiGroup.make("posts").add(
    HttpApiEndpoint.get("getPost", "/posts/:id", {
      params: { id: Schema.String },
      success: Post,
    }),
  ),
);

class DemoApiClient extends Gate.httpApiClientService<DemoApiClient>()(
  DemoClientId,
  DemoApi,
  {
    baseUrl: "https://jsonplaceholder.typicode.com",
    transformClient: Gate.acceptJson,
    concurrency: 2,
  },
) {}

class DemoApiMetrics extends ApiMetrics.Tag<DemoApiMetrics>()(DemoClientId) {}

const program = Effect.gen(function* () {
  const client = yield* DemoApiClient;
  const post = yield* client.posts.getPost({ params: { id: "1" } });
  const metrics = yield* DemoApiMetrics;
  const snap = yield* metrics.usage.get;
  yield* Effect.log(`post ${post.id}: ${post.title}`);
  yield* Effect.log(`usage requests=${snap.requestsTotal} inFlight=${snap.inFlight}`);
});

runNodeProgramOrExit(
  // `.layer` is scoped (the client's concurrency semaphore), so discharge Scope at the effect
  // with `Effect.scoped` — the same pattern the tests use — and turn request errors into defects
  // for this demo, leaving a fully-provided `Effect<void, never, never>`.
  program.pipe(
    Effect.provide(
      Layer.mergeAll(
        DemoApiClient.layer.pipe(Layer.provide(FetchHttpClient.layer)),
        ApiMetrics.layer(DemoApiMetrics),
      ),
    ),
    Effect.scoped,
    Effect.orDie,
  ),
  "Gate.httpApiClient + ApiMetrics demo complete",
);
