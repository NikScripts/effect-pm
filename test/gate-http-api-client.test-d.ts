/**
 * Licenses the reflect-built Spec cast in `Gate.HttpApiClient` — Client locals + metrics nest.
 */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Gate from "../src/Gate";
import * as Hyperlink from "../src/Hyperlink";

const ping = HttpApiEndpoint.get("ping", "/ping", {
  success: Schema.Struct({ pong: Schema.Boolean }),
});
const api = HttpApi.make("typed-http-api").add(HttpApiGroup.make("g").add(ping));

class Client extends Gate.HttpApiClient<Client>()("test/typed-http-api", api, {
  concurrency: 1,
}) {}

type Service = Hyperlink.Shape<typeof Client>;

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertExact = <_ extends true>(): void => {};

// Nest path default `"metrics"` with usage + windows (absorbed ApiMetrics).
type Nest = Service["metrics"];
assertExact<Exact<Nest["usage"] extends Hyperlink.Subscribable<infer _U> ? true : false, true>>();
assertExact<Exact<"windows" extends keyof Nest ? true : false, true>>();
assertExact<Exact<"remaining" extends keyof Nest ? true : false, true>>();

// Group endpoint is callable on the handle.
assertExact<Exact<Service["g"]["ping"] extends (...args: never) => unknown ? true : false, true>>();

// metricsKey rename is typed on the nest path.
class Renamed extends Gate.HttpApiClient<Renamed>()("test/typed-http-api-renamed", api, {
  metricsKey: "observe",
}) {}
type RenamedService = Hyperlink.Shape<typeof Renamed>;
assertExact<Exact<"observe" extends keyof RenamedService ? true : false, true>>();
// @ts-expect-error default nest key absent when renamed
type _noMetrics = RenamedService["metrics"];
