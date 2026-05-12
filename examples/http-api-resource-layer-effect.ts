/**
 * @module examples/http-api-resource-layer-effect
 *
 * ## Advanced **`HttpApiResource.layerEffect`** composition
 *
 * Some codebases already expose an **`HttpApiClient` as a `Context.Service`** with a custom
 * `Layer` (logging, tracing, base URL, etc.). **`HttpApiResource.layerEffect`** lets you wrap
 * that existing construction path and still attach **effect-pm limits** (throttle + concurrency)
 * without duplicating client wiring.
 *
 * ### What this example models
 *
 * - **`DecodeCapture`** — a tiny sidecar service used only to prove `layerCapture` wiring.
 * - **`layer`** — provides a noop capture (production might record decode metadata).
 * - **`resourceLayerCapture`** — `HttpApiResource.layerEffect` merges limits into the captured client effect.
 * - **`resourceLayer`** — derived so the run gate stays a **singleton** per process shape you choose.
 *
 * ### Run
 *
 * ```bash
 * pnpm run example:http-api-resource-layer-effect
 * ```
 *
 * ### When to use which factory
 *
 * | Factory | Use when |
 * |---------|----------|
 * | `HttpApiResource.make` | Green-field: you want tag + `.layer` from an `HttpApi` definition. |
 * | `HttpApiResource.layerEffect` | Brown-field: you already have a `Layer` that builds `HttpApiClient`. |
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
import { provideLayer } from "../src/provideLayer.js";

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
>()("@nikscripts/effect-pm/examples/http-api-resource-layer-effect/DecodeCapture") {}

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
  const client = yield* HttpApiClient.make(DemoApi, {
    baseUrl: "https://example.test",
    transformClient: acceptJson,
  });
  return client;
});

export class DemoApiClient extends Context.Service<DemoApiClient>()(
  "@nikscripts/effect-pm/examples/http-api-resource-layer-effect/DemoApiClient",
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
      concurrency: 2,
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

void Effect.runPromise(
  program.pipe(
    provideLayer(DemoApiClient.resourceLayerCapture),
    provideLayer(DecodeCaptureLive),
    provideLayer(Layer.succeed(HttpClient.HttpClient, fakeHttpClient)),
    Effect.tap(() =>
      Effect.logInfo("example:http-api-resource-layer-effect finished OK"),
    ),
  ),
);
