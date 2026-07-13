/**
 * Node-only serving helpers — the `NodeHttpServer` side of the toolkit. Kept off the browser-safe
 * core (it imports `@effect/platform-node`); import it from `@nikscripts/effect-pm/node`.
 *
 * @module node
 */
import { Layer } from "effect";
import { NodeHttpServer } from "@effect/platform-node";
// `NodeHttpServer.layer` requires a node `http.Server` (LazyArg<Http.Server>) — every variant does,
// and no Effect-service form exists. This module is node-only, so the primitive is isolated here.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer } from "node:http";
import * as Resource from "./Resource";

/**
 * The local mirror of {@link Resource.clientHttp}. Serve one resource on a local `port` and get a
 * bound server `Layer` in one call — {@link Resource.httpServer}`(serve)` plus a Node HTTP server on
 * that port. Pairs with `Resource.clientHttp(tag, port)` for two runtimes on the same machine.
 *
 * ```ts
 * Effect.provide(worker, localServer(QueueResource.serve(Emails, { effect: sendEmail }), 3001));
 * ```
 *
 * @public
 */
export const localServer = <A, E, R>(serve: Layer.Layer<A, E, R>, port: number) =>
  Resource.httpServer(serve).pipe(
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port })),
  );
