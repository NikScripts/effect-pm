/**
 * `HttpApiResource.make` — typed `HttpApiClient` as a `Context.Service` + `layer`
 *
 * Same as `Resource.makeHttpApiClient` (umbrella alias).
 *
 * Run: `npm run example:http-api-resource`
 *
 * The returned value is a **tag** with a **`.layer`**:
 * - `yield* MyApi` → `HttpApiClient` for your `HttpApi`
 * - `Effect.provide(MyApi.layer)` supplies that client (still requires platform `HttpClient`, e.g. `FetchHttpClient.layer`)
 *
 * Optional **`limits`** apply the same run gate as `RunResource` (concurrency + optional throttle) on the
 * full request effect via `HttpClient.transform` (see `HttpClientRunGate`).
 */

import { FetchHttpClient } from "effect/unstable/http";
import { Effect, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { HttpApiResource } from "../src";

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
    })
  )
);

/** Tag + layer: provide `DemoApi.layer` and `FetchHttpClient.layer` (or any `HttpClient`). */
const DemoApiClient = HttpApiResource.make(DemoApi, {
  name: "examples/jsonplaceholder/DemoApiClient",
  client: {
    baseUrl: "https://jsonplaceholder.typicode.com",
    transformClient: HttpApiResource.acceptJson,
  },
  limits: { concurrency: 2 },
});

const program = Effect.gen(function* () {
  const client = yield* DemoApiClient;
  const post = yield* client.posts.getPost({ params: { id: "1" } });
  yield* Effect.log(`Post #${post.id}: ${post.title.slice(0, 60)}…`);
});

Effect.runPromise(
  program.pipe(
    Effect.provide(DemoApiClient.layer),
    Effect.provide(FetchHttpClient.layer)
  )
).then(
  () => console.log("example:http-api-resource finished OK"),
  (e) => {
    console.error(e);
    process.exitCode = 1;
  }
);
