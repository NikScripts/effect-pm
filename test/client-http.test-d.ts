import * as Resource from "../src/Resource";
import { Layer, Schema } from "effect";

// clientHttp: a served resource tag + url -> a ready client Layer<Self>, in one call.
class Emails extends Resource.Tag<Emails>()("app/Emails", {
  add: Resource.effect(Schema.Void),
}) {}

const layer: Layer.Layer<Emails> = Resource.clientHttp(Emails, { url: "http://x/rpc" });
void layer;
