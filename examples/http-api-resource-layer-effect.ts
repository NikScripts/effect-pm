/**
 * `HttpApiResource.layerEffect` with an existing `Context.Service` client.
 *
 * This mirrors an app setup where:
 * - `layerCapture` requires an extra capture service
 * - `layer` provides a noop capture implementation
 * - `resourceLayerCapture` applies effect-pm limits to the same client effect
 * - `resourceLayer` derives from `resourceLayerCapture` so the gate stays singleton
 *
 * Run:
 *   `npm run example:http-api-resource-layer-effect`
 */

import { Context, Effect, Layer, Ref, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { HttpClientError } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import { acceptJson, HttpApiResource } from "../src";

const Post = Schema.Struct({
  userId: Schema.Number,
  id: Schema.Number,
  title: Schema.String,
  body: Schema.String,
});

const DemoApi = HttpApi.make("layer-effect-demo").add(
  HttpApiGroup.make("posts").add(
    HttpApiEndpoint.get("getPost", "/posts/:id", {
      params: { id: Schema.String },
      success: Post,
    })
  )
);

class DecodeCapture extends Context.Service<
  DecodeCapture,
  {
    readonly record: (label: string) => Effect.Effect<void>;
    readonly count: () => Effect.Effect<number>;
  }
>()("examples/DecodeCapture") {}

const DecodeCaptureNoop = Layer.succeed(DecodeCapture, {
  record: (_label: string) => Effect.void,
  count: () => Effect.succeed(0),
});

const DecodeCaptureLive = Layer.effect(
  DecodeCapture,
  Effect.gen(function* () {
    const seen = yield* Ref.make<Array<string>>([]);
    return {
      record: (label: string) => Ref.update(seen, (items) => [...items, label]),
      count: () => Ref.get(seen).pipe(Effect.map((items) => items.length)),
    };
  })
);

const _make = Effect.gen(function* () {
  const capture = yield* DecodeCapture;
  return yield* HttpApiClient.make(DemoApi, {
    baseUrl: "https://example.test",
    transformClient: acceptJson,
    transformResponse: (effect) =>
      effect.pipe(Effect.tap(() => capture.record("decoded response"))),
  });
});

export class DemoApiClient extends Context.Service<DemoApiClient>()(
  "examples/DemoApiClient",
  {
    make: _make,
  }
) {
  private static readonly serviceLayer = Layer.effect(DemoApiClient, _make);

  /** Existing client only; capture dependency must be provided separately. */
  static readonly layerCapture = DemoApiClient.serviceLayer;

  /** Existing client + noop capture. */
  static readonly layer = Layer.provideMerge(
    DemoApiClient.layerCapture,
    DecodeCaptureNoop
  );

  /**
   * Existing client + effect-pm transport gate.
   *
   * Important: derive `resourceLayer` from this layer so both variants share the
   * same gated client instance and one singleton throttle / concurrency gate.
   */
  static readonly resourceLayerCapture = HttpApiResource.layerEffect(
    DemoApiClient,
    _make,
    {
      limits: { concurrency: 2 },
    }
  );

  /** Gated client + noop capture. */
  static readonly resourceLayer = Layer.provideMerge(
    DemoApiClient.resourceLayerCapture,
    DecodeCaptureNoop
  );
}

const fakeHttpClient = HttpClient.makeWith<
  never,
  never,
  HttpClientError.HttpClientError,
  never
>(
  (reqEff) =>
    Effect.flatMap(reqEff, (req) => {
      const url = new URL(req.url);
      const id = Number(url.pathname.split("/").at(-1) ?? "1");
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          req,
          new Response(
            JSON.stringify({
              userId: 99,
              id,
              title: `Post ${id}`,
              body: `Body ${id}`,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        )
      );
    }),
  (request) => Effect.succeed(request)
);

const program = Effect.gen(function* () {
  const client = yield* DemoApiClient;
  const capture = yield* DecodeCapture;

  const posts = yield* Effect.all(
    [
      client.posts.getPost({ params: { id: "1" } }),
      client.posts.getPost({ params: { id: "2" } }),
      client.posts.getPost({ params: { id: "3" } }),
    ],
    { concurrency: "unbounded" }
  );

  const decoded = yield* capture.count();
  yield* Effect.log(
    `Fetched ${posts.length} posts via shared gated client; captured ${decoded} decodes`
  );
});

Effect.runPromise(
  program.pipe(
    Effect.provide(DemoApiClient.resourceLayerCapture),
    Effect.provide(DecodeCaptureLive),
    Effect.provide(Layer.succeed(HttpClient.HttpClient, fakeHttpClient))
  )
).then(
  () => console.log("example:http-api-resource-layer-effect finished OK"),
  (e) => {
    console.error(e);
    process.exitCode = 1;
  }
);
