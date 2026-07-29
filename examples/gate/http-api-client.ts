/**
 * @module examples/gate/http-api-client
 *
 * Gate.HttpApiClient Tag + nest metrics (usage absorbed; no sibling ApiMetrics).
 * Run: `pnpm run example:gate-http-api-client`
 *
 * Docs: `docs/examples/gate/http-api-client.md` includes this file;
 * cut markers hide the module header and demo harness.
 */

import { runNodeProgramOrExit } from "../shared/demo-harness";

// ---cut---
import { FetchHttpClient } from "effect/unstable/http";
import { Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Gate from "../../src/Gate";

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

class DemoApiClient extends Gate.HttpApiClient<DemoApiClient>()(
  DemoClientId,
  DemoApi,
  { concurrency: 2 },
) {
  static readonly layer = Gate.httpApiClientLayer(DemoApiClient, {
    baseUrl: "https://jsonplaceholder.typicode.com",
    transformClient: Gate.acceptJson,
  });
}

const program = Effect.gen(function* () {
  const client = yield* DemoApiClient;
  const post = yield* client.posts.getPost({ params: { id: "1" } });
  const snap = yield* client.metrics.usage.get;
  yield* Effect.log(`post ${post.id}: ${post.title}`);
  yield* Effect.log(`usage requests=${snap.requestsTotal} inFlight=${snap.inFlight}`);
});
// ---cut-after---

runNodeProgramOrExit(
  program.pipe(
    Effect.provide(DemoApiClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
    Effect.scoped,
    Effect.orDie,
  ),
  "Gate.HttpApiClient demo complete",
);
