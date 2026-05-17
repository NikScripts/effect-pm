/**
 * @module nwslsoccer/client
 *
 * {@link NwslsoccerClient} — typed {@link HttpApiClient} for {@link NwslsoccerApi}.
 *
 * - **`Live`** — needs `HttpClient` (e.g. {@link NodeHttpClient.layer} or {@link FetchHttpClient.layer}) + default `ConfigProvider`.
 * - **`layerNode`** — merges `Live` with {@link NodeHttpClient.layer} for one-shot Node scripts/tests.
 * - **`layerFetch`** — merges `Live` with {@link FetchHttpClient.layer} (uses `globalThis.fetch`; use with `vi.stubGlobal` in tests).
 *
 * Base URL: {@link NwslSoccerApiBaseUrl} (`NWSL_SOCCER_API_BASE_URL`, default `https://api-sdp.nwslsoccer.com`).
 */
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { NodeHttpClient } from "@effect/platform-node";
import { Context, Effect, Layer } from "effect";
import { acceptJson } from "../../../src";
import { NwslsoccerApi } from "./api";
import { NwslSoccerApiBaseUrl } from "./config";

const _make = Effect.gen(function* () {
  const baseUrl = yield* NwslSoccerApiBaseUrl;
  return yield* HttpApiClient.make(NwslsoccerApi, {
    baseUrl,
    transformClient: acceptJson,
  });
});

type NwslClientShape = Effect.Success<typeof _make>;

const NwslsoccerClientTag = Context.Service<
  NwslClientShape & { _brand: "app/NwslsoccerClient" },
  NwslClientShape
>("app/NwslsoccerClient");

const Live = Layer.effect(NwslsoccerClientTag, _make);

/** Tag + layers (Effect v4 `Context.Service`; same `yield*` / `.layer` usage as before). */
export const NwslsoccerClient = Object.assign(NwslsoccerClientTag, {
  Live,
  /** Client + Node HTTP stack (`node:http` / undici); still provide `ConfigProvider` (defaults apply). */
  layerNode: Layer.provideMerge(Live, NodeHttpClient.layerFetch),
  /** Client + `globalThis.fetch` (e.g. Vitest `vi.stubGlobal("fetch", …)`). */
  layerFetch: Layer.provideMerge(Live, FetchHttpClient.layer),
});
