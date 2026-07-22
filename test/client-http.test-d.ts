import * as Hyperlink from "../src/Hyperlink";
import { Layer, Schema } from "effect";

class Emails extends Hyperlink.Tag<Emails>()("app/Emails", {
  add: Hyperlink.effect(Schema.Void),
}) {}

// connect(tag, protocolHttp(port | ":port" | url))  ->  a client Layer<Self>
const a: Layer.Layer<Emails> = Hyperlink.connect(Emails, Hyperlink.protocolHttp(3001));
const b: Layer.Layer<Emails> = Hyperlink.connect(Emails, Hyperlink.protocolHttp(":3001"));
const c: Layer.Layer<Emails> = Hyperlink.connect(
  Emails,
  Hyperlink.protocolHttp("https://mail.internal/rpc"),
);
void a; void b; void c;
