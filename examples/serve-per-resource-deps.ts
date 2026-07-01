/**
 * @module examples/serve-per-resource-deps
 *
 * Dogfoods `Resource.serve` / `Resource.httpServer`: two resources that need **different implementations
 * of the same dependency tag**, served on one `/rpc`, isolated. `Matches` gets a "plain" `ImportHandlers`;
 * `Import` gets a "hooked" one — proven by each reading back its own label, plus `/health` listing both.
 *
 * Run: `npx tsx examples/serve-per-resource-deps.ts`
 */
import { Console, Context, Duration, Effect, Layer, Schema } from "effect";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as Resource from "../src/Resource";

const PORT = 7790;

// one dependency tag, two mutually-exclusive implementations
class ImportHandlers extends Context.Service<ImportHandlers, { readonly label: string }>()(
  "@nikscripts/effect-pm/examples/serve-per-resource-deps/ImportHandlers",
) {}
const plainHandlers = Layer.succeed(ImportHandlers, { label: "plain" });
const hookedHandlers = Layer.succeed(ImportHandlers, { label: "hooked" });

class Matches extends Resource.Tag<Matches>()("example/Matches", {
  handler: Resource.query(Schema.String),
}) {}
class Import extends Resource.Tag<Import>()("example/Import", {
  handler: Resource.query(Schema.String),
}) {}

// same impl body for both — it just reports which ImportHandlers it was given
const impl = { handler: Effect.map(ImportHandlers, (handlers) => handlers.label) };

// httpServer([...serve layers], options) — bundles the provideMerge + registry
const Host = Resource.httpServer(
  [
    Resource.serve(Matches, impl).pipe(Layer.provide(plainHandlers)), // plain
    Resource.serve(Import, impl).pipe(Layer.provide(hookedHandlers)), // hooked — isolated
  ],
  { health: { path: "/health" } },
).pipe(Layer.provide(NodeHttpServer.layer(() => createServer(), { port: PORT })));

const base = `http://127.0.0.1:${PORT}`;
const clientTransport = RpcClient.layerProtocolHttp({ url: `${base}/rpc` }).pipe(
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(FetchHttpClient.layer),
);

const program = Effect.gen(function* () {
  yield* Effect.forkScoped(Effect.never.pipe(Effect.provide(Host)));
  yield* Effect.sleep(Duration.millis(400)); // let the server bind

  yield* Effect.gen(function* () {
    const matches = yield* Matches;
    const importer = yield* Import;
    yield* Console.log(`Matches.handler = ${yield* matches.handler}  (expect "plain")`);
    yield* Console.log(`Import.handler  = ${yield* importer.handler}  (expect "hooked")`);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Resource.client(Matches).pipe(Layer.provide(clientTransport)),
        Resource.client(Import).pipe(Layer.provide(clientTransport)),
      ),
    ),
    Effect.scoped,
  );

  const health = yield* Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.get(`${base}/health`);
    return yield* response.json;
  }).pipe(Effect.provide(FetchHttpClient.layer), Effect.orDie);
  const body = health as {
    readonly status: string;
    readonly resources: ReadonlyArray<{ readonly key: string }>;
  };
  yield* Console.log(
    `/health: ${body.status} — resources: ${body.resources.map((r) => r.key).join(", ")}`,
  );
}).pipe(Effect.scoped);

NodeRuntime.runMain(program);
