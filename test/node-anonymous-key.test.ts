import { Effect, Layer, Schema } from "effect";
import { expect, it } from "vitest";
import * as Hyperlink from "../src/Hyperlink";
import { anonymousNodeKey } from "../src/internal/nodeListenCommon";

class Emails extends Hyperlink.Service<Emails>()("@app/Emails", {
  send: Hyperlink.effect(Schema.String),
}) {}

it("serve stamps its tag key on the layer (for anonymous node naming)", () => {
  const layer = Hyperlink.serve(Emails, { send: Effect.succeed("ok") });
  expect(Hyperlink.servedKeyOf(layer)).toBe("@app/Emails");
});

it("anonymous node key = full prefix + name from first served key (last segment) + random tail", () => {
  const stamped = Object.assign(Layer.effectDiscard(Effect.void), {
    [Hyperlink.servedKeySym]: "@app/Emails",
  });
  const key = Effect.runSync(anonymousNodeKey([stamped]));
  // @app/Emails -> Emails
  expect(key).toMatch(
    /^hyperlink-ts\/anonymous-node\/Emails#[a-z0-9]+$/,
  );
});
