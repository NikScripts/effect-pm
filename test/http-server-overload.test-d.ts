import * as Resource from "../src/Resource";
import { Layer } from "effect";

// A single serve layer is accepted directly (new overload) …
declare const serve: Layer.Layer<"Emails", never, "Dep">;
Resource.httpServer(serve);
Resource.httpServer(serve, { path: "/rpc" });

// … and the array form still works.
Resource.httpServer([serve]);
Resource.httpServer([serve, serve]);
