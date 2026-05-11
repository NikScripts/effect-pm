/**
 * @module examples/http-api-resource
 *
 * ## Typed **HttpApi** client as an Effect **service**
 *
 * `HttpApiResource.make` wraps `HttpApiClient.make` so you get:
 *
 * - A **Context.Tag** you can `yield*` inside `Effect.gen`
 * - A **`.layer`** that builds the client when provided
 * - Optional **`limits`** — same throttle + concurrency gate as `RunResource`, applied to the
 *   **entire per-request** effect via `HttpClient.transform` (see `HttpClientRunGate` in `src/`)
 *
 * Umbrella alias: **`Resource.makeHttpApiClient`** (same implementation).
 *
 * ### Run
 *
 * ```bash
 * pnpm run example:http-api-resource
 * ```
 *
 * ### Dependencies you must still provide
 *
 * - **`FetchHttpClient.layer`** (or any `HttpClient` implementation) — the HttpApi client sits on top
 *   of the platform HTTP stack.
 *
 * ### Public API surface touched
 *
 * - `src/HttpApiResource.ts` — factory
 * - `src/HttpClientRunGate.ts` — gating helper used when `limits` is set
 */

import { FetchHttpClient } from "effect/unstable/http";
import { Effect, Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { HttpApiResource } from "../src";
import { provideLayer } from "../src/provideLayer.js";

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

void Effect.runPromise(
  program.pipe(
    provideLayer(DemoApiClient.layer),
    provideLayer(FetchHttpClient.layer),
    Effect.tap(() => Effect.logInfo("example:http-api-resource finished OK")),
  ),
);
