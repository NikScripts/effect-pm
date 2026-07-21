import * as Resource from "../src/Resource";
import { Layer, Schema } from "effect";

class Emails extends Resource.Tag<Emails>()("app/Emails", {
  add: Resource.effect(Schema.Void),
}) {}

// connect(tag, protocolHttp(port | ":port" | url))  ->  a client Layer<Self>
const a: Layer.Layer<Emails> = Resource.connect(Emails, Resource.protocolHttp(3001));
const b: Layer.Layer<Emails> = Resource.connect(Emails, Resource.protocolHttp(":3001"));
const c: Layer.Layer<Emails> = Resource.connect(
  Emails,
  Resource.protocolHttp("https://mail.internal/rpc"),
);
void a; void b; void c;
