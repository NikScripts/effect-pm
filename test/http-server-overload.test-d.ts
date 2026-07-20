import { Layer } from "effect";
import * as Node from "../src/Node";

// A single serve layer is accepted directly (new overload) …
declare const serve: Layer.Layer<"Emails", never, "Dep">;
Node.httpServer(serve);
Node.httpServer(serve, { path: "/rpc" });

// … and the array form still works.
Node.httpServer([serve]);
Node.httpServer([serve, serve]);
