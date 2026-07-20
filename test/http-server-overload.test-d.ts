import { Layer } from "effect";
import type { HttpServer } from "effect/unstable/http";
import { expectTypeOf } from "vitest";
import * as Node from "../src/Node";

// A single serve layer is accepted directly …
declare const serve: Layer.Layer<"Emails", never, "Dep">;
Node.httpServer(serve);
Node.httpServer(serve, { path: "/rpc" });

// … and the array form still works.
Node.httpServer([serve]);
Node.httpServer([serve, serve]);

// R is preserved (caller still provides Dep + HttpServer).
const httpOne = Node.httpServer(serve);
expectTypeOf(httpOne).toEqualTypeOf<
  Layer.Layer<"Emails", never, "Dep" | HttpServer.HttpServer>
>();

// E propagates from the serve layer (no longer hard-erased to `never`).
declare const fallible: Layer.Layer<"X", "Boom", never>;
const httpFallible = Node.httpServer(fallible);
const wsFallible = Node.wsServer(fallible);
const ipcFallible = Node.ipcServer(fallible, { path: "/tmp/x.sock" });
expectTypeOf(httpFallible).toEqualTypeOf<
  Layer.Layer<"X", "Boom", HttpServer.HttpServer>
>();
expectTypeOf(wsFallible).toEqualTypeOf<
  Layer.Layer<"X", "Boom", HttpServer.HttpServer>
>();
expectTypeOf(ipcFallible).toEqualTypeOf<Layer.Layer<"X", "Boom", never>>();
