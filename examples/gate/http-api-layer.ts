/**
 * @module examples/gate/http-api-layer
 *
 * Gate.httpApiClientLayer on an existing client Layer. Run: `pnpm run example:gate-http-api-layer-effect`
 *
 * Docs: `docs/examples/gate/http-api-layer.md` includes this file;
 * cut markers hide the module header and demo harness.
 */

import { runNodeProgramWithLayer } from "../shared/demo-harness";

// ---cut---
import { Context, Effect, Layer, Ref, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { HttpClientError } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import { acceptJson, Gate } from "../../src";

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
    }),
  ),
);

// Sidecar service — proves layerCapture wiring; swap for real decode telemetry in apps.
class DecodeCapture extends Context.Service<
  DecodeCapture,
  {
    readonly record: (label: string) => Effect.Effect<void>;
    readonly count: () => Effect.Effect<number>;
  }
>()("hyperlink-ts/examples/gate-http-api-layer-effect/DecodeCapture") {}

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
  }),
);

const _make = Effect.gen(function* () {
  const client = yield* HttpApiClient.make(DemoApi, {
    baseUrl: "https://example.test",
    transformClient: acceptJson,
  });
  return client;
});

export class DemoApiClient extends Context.Service<DemoApiClient>()(
  "hyperlink-ts/examples/gate-http-api-layer-effect/DemoApiClient",
  {
    make: _make,
  },
) {
  private static readonly serviceLayer = Layer.effect(DemoApiClient, _make);

  static readonly layerCapture = DemoApiClient.serviceLayer;

  static readonly layer = Layer.provideMerge(
    DemoApiClient.layerCapture,
    DecodeCaptureNoop,
  );

  // Brown-field path: wrap existing _make with hyperlink-ts transport limits.
  static readonly resourceLayerCapture = Gate.httpApiClientLayerEffect(
    DemoApiClient,
    _make,
    { concurrency: 2 },
  );

  static readonly resourceLayer = Layer.provideMerge(
    DemoApiClient.resourceLayerCapture,
    DecodeCaptureNoop,
  );
}

// In-memory HttpClient so the demo runs without network.
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
            },
          ),
        ),
      );
    }),
  (request) => Effect.succeed(request),
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
    { concurrency: "unbounded" },
  );

  const decoded = yield* capture.count();
  yield* Effect.log(
    `Fetched ${posts.length} posts via shared gated client; captured ${decoded} decodes`,
  );
});

const mainLayer = Layer.provideMerge(
  Layer.provide(DemoApiClient.resourceLayerCapture, Layer.succeed(HttpClient.HttpClient, fakeHttpClient)),
  DecodeCaptureLive,
);
// ---cut-after---

runNodeProgramWithLayer(program, mainLayer, "form:gate-http-api-layer-effect finished OK");
