/**
 * @module examples/forms/resource/http-api-resource-service-layer
 *
 * HttpApiResource.Service + ApiMetrics — class client and observability tag.
 * Run: `pnpm run example:http-api-resource`
 */

import { FetchHttpClient } from "effect/unstable/http";
import { Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { ApiMetrics } from "../../../src/ApiMetrics";
import { HttpApiResource } from "../../../src/HttpApiResource";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

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

class DemoApiClient extends HttpApiResource.Service<DemoApiClient>()(
  DemoClientId,
  DemoApi,
  {
    baseUrl: "https://jsonplaceholder.typicode.com",
    transformClient: HttpApiResource.acceptJson,
    concurrency: 2,
  },
) {}

class DemoApiMetrics extends ApiMetrics.Tag<DemoApiMetrics>(DemoClientId)() {}

const program = Effect.gen(function* () {
  const client = yield* DemoApiClient;
  const post = yield* client.posts.getPost({ path: { id: "1" } });
  const metrics = yield* DemoApiMetrics;
  const snap = yield* metrics.usageNow;
  yield* Effect.log(`post ${post.id}: ${post.title}`);
  yield* Effect.log(`usage requests=${snap.requestsTotal} inFlight=${snap.inFlight}`);
});

runNodeProgramWithLayer(
  program,
  Layer.mergeAll(
    DemoApiClient.layer.pipe(Layer.provide(FetchHttpClient.layer)),
    ApiMetrics.layer(DemoApiMetrics),
  ),
);
