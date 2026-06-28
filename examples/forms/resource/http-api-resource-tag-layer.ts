/**
 * @module examples/forms/resource/http-api-resource-tag-layer
 *
 * HttpApiResource.make — tag + layer. Run: `pnpm run example:http-api-resource`
 */

import { FetchHttpClient } from "effect/unstable/http";
import { Effect, Layer, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { HttpApiResource } from "../../../src";
import { runNodeProgramWithLayer } from "../../shared/demo-harness";

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

// Tag + layer: provide DemoApiClient.layer and FetchHttpClient.layer at the root.
const DemoApiClient = HttpApiResource.make(DemoApi, {
  name: "examples/jsonplaceholder/DemoApiClient",
  baseUrl: "https://jsonplaceholder.typicode.com",
  transformClient: HttpApiResource.acceptJson,
  concurrency: 2, // throttle + concurrency on every request effect
});

const program = Effect.gen(function* () {
  const client = yield* DemoApiClient;
  const post = yield* client.posts.getPost({ params: { id: "1" } });
  yield* Effect.log(`Post #${post.id}: ${post.title.slice(0, 60)}…`);
});

const mainLayer = DemoApiClient.layer.pipe(Layer.provide(FetchHttpClient.layer));

runNodeProgramWithLayer(program, mainLayer, "form:http-api-resource-tag-layer finished OK");
