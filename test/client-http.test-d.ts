import * as Resource from "../src/Resource";
import { localServer } from "../src/node";
import { Layer, Schema } from "effect";

class Emails extends Resource.Tag<Emails>()("app/Emails", {
  add: Resource.effect(Schema.Void),
}) {}

// clientHttp: port | ":port" | url  ->  a client Layer<Self>
const a: Layer.Layer<Emails> = Resource.clientHttp(Emails, 3001);
const b: Layer.Layer<Emails> = Resource.clientHttp(Emails, ":3001");
const c: Layer.Layer<Emails> = Resource.clientHttp(Emails, "https://mail.internal/rpc");
void a; void b; void c;

// localServer (node): a serve layer + port  ->  a bound server Layer
declare const serve: Layer.Layer<Emails, never, never>;
void localServer(serve, 3001);
